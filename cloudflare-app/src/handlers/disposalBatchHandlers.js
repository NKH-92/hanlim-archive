import {
  cancelDisposalBatch,
  createDisposalBatch,
  freezeDisposalBatch,
  getDisposalBatch,
  getDisposalBatchExportRows,
  getDisposalBatchItems,
  listDisposalBatches,
  previewDisposalCandidates,
  processDisposalBatch,
  setDisposalBatchItemExcluded,
  startDisposalBatch,
  updateDisposalBatch
} from "../domains/disposal/index.js";
import { loadDocumentFormOptions } from "../domains/documents/index.js";
import { getRackSummaries } from "../domains/racks/index.js";
import {
  disposalBatchDetailPage,
  disposalBatchFormPage,
  disposalBatchListPage
} from "../views/disposalBatchViews.js";
import { errorPage, notFoundPage } from "../views/authViews.js";
import { jsonResponse, redirect } from "../platform/http/responses.js";
import { csvEscape } from "../shared/csv/writer.js";
import { clean } from "../shared/text/normalize.js";
import { requireManageDisposals } from "./permissionGuards.js";
import { csvDownloadResponse } from "./responseHelpers.js";

export async function handleDisposalBatches(env, session) {
  const denied = requireManageDisposals(session);
  if (denied) return denied;
  return disposalBatchListPage({ session, batches: await listDisposalBatches(env) });
}

export async function renderNewDisposalBatch(env, session, values = {}, error = "") {
  const denied = requireManageDisposals(session);
  if (denied) return denied;
  const [{ categories }, racks] = await Promise.all([
    loadDocumentFormOptions(env, { activeOnly: true, includeSlots: false }),
    getRackSummaries(env)
  ]);
  return disposalBatchFormPage({ session, values, categories, racks, error });
}

export async function handleCreateDisposalBatch(request, env, session) {
  const denied = requireManageDisposals(session);
  if (denied) return denied;
  const values = disposalValues(await request.formData());
  const result = await createDisposalBatch(env, values, session);
  if (!result.ok) return renderNewDisposalBatch(env, session, values, result.message);
  return redirect(`/disposal-batches/${result.id}`);
}

// routes matcher가 { id, action, itemId }를 넘긴다. action 기본값은 details다.
export async function handleDisposalBatchRoute(request, env, session, routeInfo) {
  const denied = requireManageDisposals(session);
  if (denied) return denied;
  const { id, action = "details", itemId = 0 } = routeInfo;

  if (request.method === "GET" && action === "details") {
    return renderDisposalBatchDetails(request, env, session, id);
  }
  if (request.method === "GET" && action === "edit") {
    return renderDisposalBatchEdit(env, session, id);
  }
  if (request.method === "GET" && action === "export.csv") {
    return exportDisposalBatchCsv(env, id);
  }
  if (request.method !== "POST") return notFoundPage(session);

  if (action === "edit") {
    const form = await request.formData();
    const values = disposalValues(form);
    const result = await updateDisposalBatch(env, id, values, session, form.get("expectedUpdatedAt"));
    if (!result.ok) return renderDisposalBatchEdit(env, session, id, values, result.message);
  } else if (action === "freeze") {
    const form = await request.formData();
    const result = await freezeDisposalBatch(env, id, session, form.get("expectedUpdatedAt"), {
      confirmedTargetCount: form.get("confirmedTargetCount"),
      confirmPreview: form.get("confirmPreview")
    });
    if (!result.ok) return errorPage(result.message, session, 409);
  } else if (action === "start") {
    const form = await request.formData();
    const result = await startDisposalBatch(env, id, session, {
      confirmedTargetCount: form.get("confirmedTargetCount"),
      confirmStart: form.get("confirmStart")
    });
    if (!result.ok) return errorPage(result.message, session, 409);
  } else if (action === "process") {
    const result = await processDisposalBatch(env, id, session);
    if (wantsJson(request)) return jsonResponse(result, { status: result.ok ? 200 : 409 });
    if (!result.ok) return errorPage(result.message, session, 409);
  } else if (action === "cancel") {
    const result = await cancelDisposalBatch(env, id, session);
    if (!result.ok) return errorPage(result.message, session, 409);
  } else if ((action === "exclude" || action === "include") && itemId) {
    const form = await request.formData();
    const result = await setDisposalBatchItemExcluded(env, id, itemId, action === "exclude", form.get("reason"), session);
    if (!result.ok) return errorPage(result.message, session, 409);
  } else {
    return notFoundPage(session);
  }
  return redirect(`/disposal-batches/${id}`);
}

async function renderDisposalBatchDetails(request, env, session, id) {
  const batch = await getDisposalBatch(env, id);
  if (!batch) return notFoundPage(session);
  const status = clean(new URL(request.url).searchParams.get("status"));
  const [items, preview] = await Promise.all([
    getDisposalBatchItems(env, id, { status }),
    batch.status === "draft" ? previewDisposalCandidates(env, batch.criteria) : Promise.resolve([])
  ]);
  return disposalBatchDetailPage({
    session,
    batch,
    items,
    preview: preview.slice(0, 200),
    previewCapped: preview.length > 200,
    itemStatus: status
  });
}

async function renderDisposalBatchEdit(env, session, id, override = null, error = "") {
  const batch = await getDisposalBatch(env, id);
  if (!batch) return notFoundPage(session);
  if (batch.status !== "draft") return errorPage("초안 상태의 캠페인만 수정할 수 있습니다.", session, 409);
  const values = override || {
    title: batch.title,
    disposalReason: batch.disposal_reason,
    approvalReference: batch.approval_reference,
    criteria: batch.criteria
  };
  const [{ categories }, racks, preview] = await Promise.all([
    loadDocumentFormOptions(env, { activeOnly: true, includeSlots: false }),
    getRackSummaries(env),
    previewDisposalCandidates(env, values.criteria || values)
  ]);
  return disposalBatchFormPage({
    session, batch, values, categories, racks,
    preview: preview.slice(0, 200), capped: preview.length > 200, error
  });
}

async function exportDisposalBatchCsv(env, id) {
  const rows = await getDisposalBatchExportRows(env, id);
  if (!rows.length) return new Response("내보낼 동결 항목이 없습니다.", { status: 404 });
  const header = ["캠페인번호", "제목", "문서번호", "개정번호", "문서명", "대분류", "동결위치", "폐기예정연도", "처리결과", "사유", "처리시각"];
  const lines = rows.map((row) => [
    row.batch_code, row.title, row.document_number_snapshot, row.revision_number_snapshot,
    row.document_name_snapshot, row.category_snapshot, row.location_snapshot,
    row.disposal_due_year_snapshot, row.item_status,
    row.exclusion_reason || row.result_message || "", row.processed_at || ""
  ].map(csvEscape).join(","));
  const body = `\uFEFF${header.map(csvEscape).join(",")}\r\n${lines.join("\r\n")}`;
  return csvDownloadResponse(body, `${rows[0].batch_code}.csv`);
}

function disposalValues(form) {
  return {
    title: clean(form.get("title")),
    disposalReason: clean(form.get("disposalReason")),
    approvalReference: clean(form.get("approvalReference")),
    criteria: {
      disposalDueYear: form.get("disposalDueYear"), yearMode: form.get("yearMode"),
      categoryId: form.get("categoryId"), zoneNumber: form.get("zoneNumber"), rackId: form.get("rackId")
    }
  };
}

function wantsJson(request) {
  return request.headers.get("Accept")?.includes("application/json");
}
