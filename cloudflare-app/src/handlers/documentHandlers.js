import { getAppConfig } from "../config.js";
import {
  buildFloorPlanLayout,
  createDocument,
  disposeDocument,
  disposeDocumentsBulk,
  documentToFormValues,
  getDisposalLogs,
  getDocument,
  getDocumentAuditLogs,
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
import { buildDocumentCsv, prepareDocumentImportRows, readDocumentImportRows } from "../documentCsv.js";
import {
  documentDetailsPage,
  documentFormPage,
  documentImportPage,
  disposalWorkspacePage,
  documentsPage,
  errorPage,
  notFoundPage
} from "../html.js";
import { clean, logError, paginateSlice, redirect } from "../utils.js";
import { requireAdmin } from "./guards.js";
import { resolveSearchOutcome, resolveSearchRequest } from "./searchRequest.js";

export async function handleDocuments(request, env, session) {
  const url = new URL(request.url);
  const search = await resolveSearchRequest(env, url);
  const { query, page, categories, tags, parsed, filters } = search;
  const pageSize = 30;
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
    suggestions,
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
  const [{ categories }, racks, years, candidates] = await Promise.all([
    loadDocumentFormOptions(env, { activeOnly: true, includeSlots: false }),
    getRackSummaries(env),
    getDisposalDueYears(env),
    getDisposalCandidates(env, filters, 201)
  ]);
  return disposalWorkspacePage({
    session,
    categories,
    racks,
    years,
    filters,
    documents: candidates.slice(0, 200),
    capped: candidates.length > 200
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

export function renderDocumentImport(session) {
  return documentImportPage({ session });
}

export async function handleDocumentImport(request, env, session) {
  const config = getAppConfig(env);
  const form = await request.formData();
  const importRows = await readDocumentImportRows(form, config.csvImport);

  if (!importRows.ok) {
    return documentImportPage({ session, error: importRows.error });
  }

  const formOptions = await loadDocumentFormOptions(env, { activeOnly: true });
  const prepared = prepareDocumentImportRows(importRows.rows, formOptions);
  if (prepared.errors.length) {
    return documentImportPage({
      session,
      error: `가져오기 전 검증 오류가 있습니다: ${prepared.errors.slice(0, 8).join(" / ")}${prepared.errors.length > 8 ? " ..." : ""}`
    });
  }

  let created = 0;
  let disposed = 0;
  const failures = [];

  // 행별로 독립 처리하고 실패를 집계한다. 중간 한 행이 실패해도 일반 500 대신
  // "생성 N · 폐기반영 M · 실패 K" 요약을 돌려줘 운영자가 후속 조치할 수 있게 한다.
  for (let index = 0; index < prepared.items.length; index += 1) {
    const item = prepared.items[index];
    const rowNumber = index + 2; // 헤더(1행) 다음부터
    try {
      const id = await createDocument(env, item.values, session.displayName, session.role);
      created += 1;

      if (item.status === "disposed") {
        const result = await disposeDocument(env, id, session.displayName, "CSV 가져오기 폐기 상태 반영", session.role);
        if (!result.ok) {
          throw new Error(`문서는 등록되었지만 폐기 상태를 반영하지 못했습니다: ${result.message}`);
        }
        disposed += 1;
      }
    } catch (error) {
      logError("import.row", error, { row: rowNumber });
      failures.push(`${rowNumber}행: ${error.message || "등록 실패"}`);
    }
  }

  return documentImportPage({ session, result: { created, disposed, failures } });
}

export async function renderCreateDocument(env, session, values = {}, error = "") {
  const { categories, tags, slots } = await loadDocumentFormOptions(env, { activeOnly: true });

  return documentFormPage({
    session,
    title: "문서 등록",
    action: "/documents",
    values,
    categories,
    tags,
    slots,
    selectedTags: values.tagIds || [],
    error
  });
}

export async function handleCreateDocument(request, env, session) {
  const values = valuesFromDocumentForm(await request.formData());
  const validation = await validateDocumentInput(env, values);

  if (validation) {
    return renderCreateDocument(env, session, values, validation);
  }

  const id = await createDocument(env, values, session.displayName, session.role);
  return redirect(`/documents/${id}?toast=created`);
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

    const [tags, disposalLogs, auditLogs, racks, regions] = await Promise.all([
      getDocumentTags(env, id),
      getDisposalLogs(env, id),
      getDocumentAuditLogs(env, id),
      getRackSummaries(env),
      getFloorPlanRegions(env)
    ]);

    return documentDetailsPage({
      session,
      document,
      tags,
      disposalLogs,
      auditLogs,
      floorPlan: buildFloorPlanLayout(racks, regions)
    });
  }

  if (request.method === "GET" && action === "edit") {
    const denied = requireAdmin(session);
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
    const denied = requireAdmin(session);
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
    values.rackSlotId = document.rack_slot_id;
    values.rackFace = document.rack_face;
    const validation = await validateDocumentInput(env, values, {
      allowInactiveCategoryId: document.category_id,
      allowInactiveTagIds: currentTags.map((tag) => tag.id)
    });

    if (validation) {
      return renderEditDocumentForm(env, session, id, values, values.tagIds, validation);
    }

    const result = await updateDocument(env, id, values, session.displayName, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }

    return redirect(`/documents/${id}?toast=updated`);
  }

  if (request.method === "POST" && action === "dispose") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const form = await request.formData();
    const result = await disposeDocument(env, id, session.displayName, clean(form.get("reason")), session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect(`/documents/${id}?toast=disposed`);
  }

  if (request.method === "POST" && action === "restore") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const result = await restoreDocument(env, id, session.displayName, session.role);
    if (!result.ok) {
      return errorPage(result.message, session, 400);
    }
    return redirect(`/documents/${id}?toast=restored`);
  }

  if (request.method === "POST" && action === "delete-permanent") {
    const denied = requireAdmin(session);
    if (denied) {
      return denied;
    }

    const result = await permanentlyDeleteDocument(env, id, session.displayName, session.role);
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

  if (!idsRaw || !reason) {
    return redirect(withToast(returnTo, "error"));
  }

  const ids = [...new Set(idsRaw.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0))];

  if (ids.length > 200) {
    return errorPage("일괄 폐기는 한 번에 200건 이하로 처리해 주세요.", session, 400);
  }

  const result = await disposeInChunks(env, ids, session, reason);

  if (result.failures.length) {
    return errorPage(
      `일괄 폐기 중 ${result.disposed}건 완료, ${result.failures.length}건 실패: ${result.failures.join(" / ")}`,
      session,
      409
    );
  }

  return redirect(withToast(returnTo, "bulk-disposed"));
}

export async function handleFilteredDispose(request, env, session) {
  const form = await request.formData();
  const filters = parseDisposalFilters({
    categoryId: form.get("categoryId"),
    rackId: form.get("rackId"),
    disposalDueYear: form.get("disposalDueYear")
  });
  const reason = clean(form.get("reason"));
  const returnTo = safeDisposalReturn(form.get("returnTo"));
  if (!reason || (!filters.categoryId && !filters.rackId && !filters.disposalDueYear)) {
    return errorPage("폐기 사유와 하나 이상의 필터가 필요합니다.", session, 400);
  }
  const candidates = await getDisposalCandidates(env, filters, 201);
  if (candidates.length > 200) {
    return errorPage("대상이 200건을 초과합니다. 필터를 더 좁혀 주세요.", session, 400);
  }
  const result = await disposeInChunks(env, candidates.map((item) => Number(item.id)), session, reason);
  if (result.failures.length) {
    return errorPage(`일괄 폐기 중 ${result.disposed}건 완료, ${result.failures.length}건 실패: ${result.failures.join(" / ")}`, session, 409);
  }
  return redirect(withToast(returnTo, "bulk-disposed"));
}

async function disposeInChunks(env, ids, session, reason) {
  const total = { disposed: 0, skipped: 0, failures: [] };
  for (let offset = 0; offset < ids.length; offset += 20) {
    const result = await disposeDocumentsBulk(env, ids.slice(offset, offset + 20), session.displayName, reason, session.role);
    total.disposed += result.disposed;
    total.skipped += result.skipped;
    total.failures.push(...result.failures);
  }
  return total;
}

function safeDisposalReturn(value) {
  const path = clean(value);
  return path.startsWith("/documents/disposal") ? path : "/documents";
}

function withToast(path, toast) {
  return `${path}${path.includes("?") ? "&" : "?"}toast=${encodeURIComponent(toast)}`;
}
