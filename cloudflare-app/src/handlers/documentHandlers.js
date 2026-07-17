import { FREE_TIER_BUDGET } from "../config.js";
import {
  buildSearchSuggestions,
  buildFloorPlanLayout,
  createDisposalBatch,
  createDocument,
  disposeDocument,
  disposeDocumentsBulk,
  documentToFormValues,
  getDisposalLogs,
  getDocument,
  getDocumentAuditLogs,
  getDocumentCount,
  getDocumentMovements,
  getDocumentPage,
  getDocumentTags,
  getDisposalCandidates,
  getDisposalDueYears,
  getDocumentsForExport,
  getFloorPlanRegions,
  getRackSummaries,
  loadDocumentFormOptions,
  MAX_SEARCH_RESULTS,
  permanentlyDeleteDocument,
  parseDisposalFilters,
  restoreDocument,
  searchDocumentsWithSuggestions,
  updateDocument,
  validateDocumentInput,
  valuesFromDocumentForm
} from "../db.js";
import { buildDocumentCsv } from "../documentCsv.js";
import {
  documentDetailsPage,
  documentFormPage,
  disposalWorkspacePage,
  documentsPage,
  errorPage,
  notFoundPage
} from "../html.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";
import { clean, paginateSlice, redirect } from "../utils.js";
import { requireManageDisposals, requireManageDocuments } from "./permissionGuards.js";
import { resolveSearchOutcome, resolveSearchRequest } from "./searchRequest.js";

export async function handleDocuments(request, env, session) {
  const url = new URL(request.url);
  const search = await resolveSearchRequest(env, url);
  const { query, page, categories, tags, parsed, filters } = search;
  const pageSize = FREE_TIER_BUDGET.documentPageSize;
  if (!parsed.text) {
    // 필터 전용 브라우즈는 전체 후보를 Worker 메모리로 가져오지 않는다. COUNT 뒤 실제
    // 페이지를 SQL LIMIT/OFFSET으로 읽고, 자동완성은 그 30행에서만 만든다.
    const totalDocuments = await getDocumentCount(env, filters);
    const totalPages = Math.max(1, Math.ceil(totalDocuments / pageSize));
    const safePage = Math.min(page, totalPages);
    const documents = await getDocumentPage(env, filters, safePage, pageSize);
    const suggestions = filters.status === "disposed" ? [] : buildSearchSuggestions(documents, 10);
    const didYouMean = await resolveSearchOutcome(env, { ...search, page: safePage }, totalDocuments);

    return documentsPage({
      session,
      query,
      parsedQuery: parsed,
      documents,
      categories,
      tags,
      filters,
      suggestions,
      didYouMean,
      pagination: {
        page: safePage,
        pageSize,
        totalDocuments,
        totalPages
      }
    });
  }

  // 호환 필터면 검색 1회로 목록·자동완성을 함께 채운다(중복 D1·스코어링 제거).
  const { documents: allDocuments, suggestions } = await searchDocumentsWithSuggestions(
    env,
    parsed.text,
    MAX_SEARCH_RESULTS,
    filters,
    10
  );
  const sliced = paginateSlice(allDocuments, page, pageSize);
  const didYouMean = await resolveSearchOutcome(env, search, sliced.totalItems);

  return documentsPage({
    session,
    query,
    parsedQuery: parsed,
    documents: sliced.items,
    categories,
    tags,
    filters,
    suggestions: filters.status === "disposed" ? [] : suggestions,
    didYouMean,
    pagination: {
      page: sliced.page,
      pageSize: sliced.pageSize,
      totalDocuments: sliced.totalItems,
      totalPages: sliced.totalPages
    }
  });
}

export async function handleDisposalWorkspace(request, env, session) {
  const filters = parseDisposalFilters(new URL(request.url).searchParams);
  return renderDisposalWorkspace(env, session, filters);
}

async function renderDisposalWorkspace(env, session, filters, feedback = null) {
  const [{ categories }, racks, years, candidates] = await Promise.all([
    loadDocumentFormOptions(env, { activeOnly: true, includeSlots: false }),
    getRackSummaries(env),
    getDisposalDueYears(env),
    getDisposalCandidates(env, filters, FREE_TIER_BUDGET.legacyBulkDisposeMaxItems + 1)
  ]);
  return disposalWorkspacePage({
    session,
    categories,
    racks,
    years,
    filters,
    documents: candidates.slice(0, FREE_TIER_BUDGET.legacyBulkDisposeMaxItems),
    capped: candidates.length > FREE_TIER_BUDGET.legacyBulkDisposeMaxItems,
    legacyLimit: FREE_TIER_BUDGET.legacyBulkDisposeMaxItems,
    feedback
  });
}

export async function handleDocumentExport(env) {
  const documents = await getDocumentsForExport(env);
  const csv = buildDocumentCsv(documents);

  return new Response(csv.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
      "Cache-Control": "no-store"
    }
  });
}

export async function renderCreateDocument(env, session, values = {}, error = "") {
  const { categories, tags, slots } = await loadDocumentFormOptions(env, { activeOnly: true });
  const safeValues = { ...values, returnTo: safeDocumentReturn(values.returnTo) };

  return documentFormPage({
    session,
    title: "문서 등록",
    action: "/documents",
    values: safeValues,
    categories,
    tags,
    slots,
    selectedTags: safeValues.tagIds || [],
    error
  });
}

export async function handleCreateDocument(request, env, session) {
  const form = await request.formData();
  const values = valuesFromDocumentForm(form);
  values.returnTo = safeDocumentReturn(form.get("returnTo"));
  const validation = await validateDocumentInput(env, values);

  if (validation) {
    return renderCreateDocument(env, session, values, validation);
  }

  const id = await createDocument(env, values, session, session.role);
  return redirect(values.returnTo ? withToast(values.returnTo, "document-created") : `/documents/${id}?toast=created`);
}

async function renderEditDocumentForm(env, session, id, values, selectedTags, error = "") {
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
    error,
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
    const validation = await validateDocumentInput(env, values, {
      allowInactiveCategoryId: document.category_id,
      allowInactiveTagIds: currentTags.map((tag) => tag.id)
    });

    if (validation) {
      return renderEditDocumentForm(env, session, id, values, values.tagIds, validation);
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
    const denied = requireManageDisposals(session);
    if (denied) {
      return denied;
    }

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

export async function handleBulkDispose(request, env, session) {
  const form = await request.formData();
  const idsRaw = clean(form.get("ids"));
  const reason = clean(form.get("reason"));
  const returnTo = safeDisposalReturn(form.get("returnTo"));

  if (!idsRaw) {
    return renderDisposalWorkspace(env, session, disposalFiltersFromReturn(returnTo), {
      type: "error",
      message: "폐기할 문서를 하나 이상 선택해 주세요."
    });
  }

  if (!reason) {
    return renderDisposalWorkspace(env, session, disposalFiltersFromReturn(returnTo), {
      type: "error",
      message: "폐기 사유를 입력해 주세요."
    });
  }

  const ids = [...new Set(idsRaw.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0))];

  if (!ids.length) {
    return renderDisposalWorkspace(env, session, disposalFiltersFromReturn(returnTo), {
      type: "error",
      message: "유효한 폐기 대상을 선택해 주세요."
    });
  }

  if (ids.length > FREE_TIER_BUDGET.legacyBulkDisposeMaxItems) {
    return renderDisposalWorkspace(env, session, disposalFiltersFromReturn(returnTo), {
      type: "error",
      message: `소량 긴급 폐기는 한 번에 ${FREE_TIER_BUDGET.legacyBulkDisposeMaxItems}건 이하만 처리할 수 있습니다.`
    });
  }

  const result = await disposeInChunks(env, ids, session, reason);

  if (result.failures.length) {
    return renderDisposalWorkspace(env, session, disposalFiltersFromReturn(returnTo), {
      type: "warning",
      message: `폐기 ${result.disposed}건 완료, 건너뜀 ${result.skipped}건, 실패 ${result.failures.length}건: ${result.failures.join(" / ")}`
    });
  }

  return redirect(withToast(returnTo, "bulk-disposed", {
    disposed: result.disposed,
    skipped: result.skipped
  }));
}

export async function handleFilteredDispose(request, env, session) {
  const form = await request.formData();
  const filters = parseDisposalFilters({
    categoryId: form.get("categoryId"),
    rackId: form.get("rackId"),
    disposalDueYear: form.get("disposalDueYear")
  });
  const reason = clean(form.get("reason"));
  if (!reason || (!filters.categoryId && !filters.rackId && !filters.disposalDueYear)) {
    return errorPage("폐기 사유와 하나 이상의 필터가 필요합니다.", session, 400);
  }
  // 필터 전체 즉시 폐기는 금지한다. 같은 조건을 가진 캠페인 초안만 만들고,
  // 사용자가 후보 검토·동결을 마친 뒤 분할 처리하도록 넘긴다.
  const result = await createDisposalBatch(env, {
    title: "필터 기반 폐기 캠페인",
    disposalReason: reason,
    criteria: { ...filters, yearMode: "exact" }
  }, session);
  if (!result.ok) {
    return errorPage(result.message, session, 400);
  }
  return redirect(`/disposal-batches/${result.id}/edit`);
}

async function disposeInChunks(env, ids, session, reason) {
  return disposeDocumentsBulk(env, ids, session, reason, session.role);
}

function safeDisposalReturn(value) {
  const path = clean(value);
  try {
    const url = new URL(path || "/documents/disposal", "https://archive.local");
    return url.origin === "https://archive.local" && url.pathname === "/documents/disposal"
      ? `${url.pathname}${url.search}`
      : "/documents/disposal";
  } catch {
    return "/documents/disposal";
  }
}

function safeDocumentReturn(value) {
  const path = clean(value);
  return /^\/sets\/\d+$/.test(path) ? path : "";
}

function disposalFiltersFromReturn(path) {
  const url = new URL(path, "https://archive.local");
  return parseDisposalFilters(url.searchParams);
}

function withToast(path, toast, details = {}) {
  const url = new URL(path, "https://archive.local");
  url.searchParams.set("toast", toast);
  for (const [key, value] of Object.entries(details)) {
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}
