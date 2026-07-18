import {
  buildFloorPlanLayout,
  createDocument,
  disposeDocument,
  documentToFormValues,
  findDuplicateDocument,
  getDisposalLogs,
  getDocument,
  getDocumentAuditLogs,
  getDocumentMovements,
  getDocumentTags,
  getFloorPlanRegions,
  getRackSummaries,
  loadDocumentFormOptions,
  permanentlyDeleteDocument,
  restoreDocument,
  updateDocument,
  validateDocumentInputDetails,
  valuesFromDocumentForm
} from "../../db.js";
import {
  accessDeniedPage,
  documentDetailsPage,
  documentFormPage,
  errorPage,
  notFoundPage
} from "../../html.js";
import { hasPermission, PERMISSIONS } from "../../permissions.js";
import { clean, jsonResponse, redirect } from "../../utils.js";
import { requireManageDisposals, requireManageDocuments } from "../permissionGuards.js";

export async function renderCreateDocument(env, session, values = {}, validation = null, title = "문서 등록") {
  const { categories, tags, slots } = await loadDocumentFormOptions(env, { activeOnly: true });
  const safeValues = { ...values, returnTo: safeDocumentReturn(values.returnTo) };

  return documentFormPage({
    session,
    title,
    action: "/documents",
    values: safeValues,
    categories,
    tags,
    slots,
    selectedTags: safeValues.tagIds || [],
    error: typeof validation === "string" ? validation : "",
    validation: typeof validation === "object" ? validation : null
  });
}

export async function handleDuplicateDocumentCheck(env, documentNumber, revisionNumber, excludeId = 0) {
  return jsonResponse(await findDuplicateDocument(env, documentNumber, revisionNumber, excludeId));
}

export async function handleCreateDocument(request, env, session) {
  const form = await request.formData();
  const values = valuesFromDocumentForm(form);
  values.returnTo = safeDocumentReturn(form.get("returnTo"));
  const validation = await validateDocumentInputDetails(env, values);

  if (!validation.ok) {
    return renderCreateDocument(env, session, values, validation);
  }

  const duplicate = await findDuplicateDocument(env, values.documentNumber, values.revisionNumber);
  if (duplicate.exists) return renderCreateDocument(env, session, values, duplicateValidation(duplicate));

  try {
    const id = await createDocument(env, values, session, session.role);
    return redirect(values.returnTo ? withToast(values.returnTo, "document-created") : `/documents/${id}?toast=created`);
  } catch (error) {
    if (error?.code !== "DUPLICATE_DOCUMENT") throw error;
    const latestDuplicate = await findDuplicateDocument(env, values.documentNumber, values.revisionNumber);
    return renderCreateDocument(env, session, values, duplicateValidation(latestDuplicate));
  }
}

async function renderEditDocumentForm(env, session, id, values, selectedTags, validation = null) {
  const { categories, tags, slots } = await loadDocumentFormOptions(env, { includeSlots: false });
  return documentFormPage({
    session,
    title: "문서 수정",
    action: `/documents/${id}/edit`,
    values,
    categories,
    tags,
    slots,
    selectedTags,
    error: typeof validation === "string" ? validation : "",
    validation: typeof validation === "object" ? validation : null,
    showLocation: false
  });
}

export async function handleDocumentRoute(request, env, session, routeInfo) {
  const { id, action } = routeInfo;

  if (request.method === "GET" && action === "details") {
    // 404면 태그·이력·도면 조회를 건너 불필요한 D1 왕복을 막는다.
    const document = await getDocument(env, id);
    if (!document) {
      return notFoundPage(session);
    }

    const canViewAudit = hasPermission(session, PERMISSIONS.VIEW_AUDIT);
    const canViewMovements = canViewAudit || hasPermission(session, PERMISSIONS.MOVE_DOCUMENTS);
    const [tags, disposalLogs, auditLogs, movements, racks, regions] = await Promise.all([
      getDocumentTags(env, id),
      getDisposalLogs(env, id),
      canViewAudit ? getDocumentAuditLogs(env, id) : Promise.resolve([]),
      canViewMovements ? getDocumentMovements(env, id) : Promise.resolve([]),
      getRackSummaries(env),
      getFloorPlanRegions(env)
    ]);

    return documentDetailsPage({
      session,
      document,
      tags,
      disposalLogs,
      auditLogs,
      movements,
      floorPlan: buildFloorPlanLayout(racks, regions)
    });
  }

  if (request.method === "GET" && action === "edit") {
    const denied = requireManageDocuments(session);
    if (denied) {
      return denied;
    }

    const [document, tags] = await Promise.all([
      getDocument(env, id),
      getDocumentTags(env, id)
    ]);

    if (!document) {
      return notFoundPage(session);
    }

    if (document.status === "disposed") {
      return errorPage("폐기 상태 문서는 폐기를 해제하기 전까지 수정할 수 없습니다.", session, 400);
    }

    return renderEditDocumentForm(
      env,
      session,
      id,
      documentToFormValues(document),
      tags.map((tag) => tag.id)
    );
  }

  if (request.method === "GET" && action === "revise") {
    const denied = requireManageDocuments(session);
    if (denied) return denied;
    const [document, tags] = await Promise.all([getDocument(env, id), getDocumentTags(env, id)]);
    if (!document) return notFoundPage(session);
    if (document.status !== "active") return errorPage("폐기 문서는 새 개정을 등록할 수 없습니다.", session, 400);

    return renderCreateDocument(env, session, {
      ...documentToFormValues(document),
      revisionNumber: "",
      revisionDate: "",
      disposalDueYear: "",
      note: "",
      tagIds: tags.map((tag) => tag.id),
      revisionSourceId: id
    }, null, "새 개정 등록");
  }

  if (request.method === "POST" && action === "edit") {
    const denied = requireManageDocuments(session);
    if (denied) {
      return denied;
    }

    const [document, currentTags] = await Promise.all([
      getDocument(env, id),
      getDocumentTags(env, id)
    ]);
    if (!document) {
      return notFoundPage(session);
    }

    const values = valuesFromDocumentForm(await request.formData());
    // 일반정보 수정에서는 위치 입력을 받지 않는다. 기존 위치를 검증·저장 값에 다시
    // 결합해 위치 변경이 반드시 전용 이동 흐름을 거치도록 한다.
    values.rackSlotId = Number(document.rack_slot_id);
    values.rackFace = document.rack_face;
    const validation = await validateDocumentInputDetails(env, values, {
      allowInactiveCategoryId: document.category_id,
      allowInactiveTagIds: currentTags.map((tag) => tag.id)
    });

    if (!validation.ok) {
      return renderEditDocumentForm(env, session, id, values, values.tagIds, validation);
    }

    const pairChanged = values.documentNumber.toUpperCase() !== String(document.document_number).toUpperCase() ||
      values.revisionNumber.toUpperCase() !== String(document.revision_number).toUpperCase();
    if (pairChanged) {
      const duplicate = await findDuplicateDocument(env, values.documentNumber, values.revisionNumber, id);
      if (duplicate.exists) return renderEditDocumentForm(env, session, id, values, values.tagIds, duplicateValidation(duplicate));
    }

    const result = await updateDocument(env, id, values, session, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }

    return redirect(`/documents/${id}?toast=updated`);
  }

  if (request.method === "POST" && action === "dispose") {
    const denied = requireManageDisposals(session);
    if (denied) {
      return denied;
    }

    const form = await request.formData();
    const result = await disposeDocument(env, id, session, clean(form.get("reason")), session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect(`/documents/${id}?toast=disposed`);
  }

  if (request.method === "POST" && action === "restore") {
    if (session.role !== "Admin") return accessDeniedPage(session);

    const form = await request.formData();
    const result = await restoreDocument(env, id, session, clean(form.get("reason")), session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect(`/documents/${id}?toast=restored`);
  }

  if (request.method === "POST" && action === "delete-permanent") {
    const denied = requireManageDisposals(session);
    if (denied) {
      return denied;
    }

    const result = await permanentlyDeleteDocument(env, id, session, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect("/documents?toast=deleted");
  }

  return notFoundPage(session);
}

function duplicateValidation(duplicate) {
  return {
    ok: false,
    fieldErrors: { documentNumber: "문서번호와 개정번호가 이미 등록되어 있습니다." },
    formErrors: [],
    duplicate: duplicate?.document ? duplicate : null
  };
}

function safeDocumentReturn(value) {
  const path = clean(value);
  return /^\/sets\/\d+$/.test(path) ? path : "";
}

function withToast(path, toast) {
  const url = new URL(path, "https://archive.local");
  url.searchParams.set("toast", toast);
  return `${url.pathname}${url.search}`;
}
