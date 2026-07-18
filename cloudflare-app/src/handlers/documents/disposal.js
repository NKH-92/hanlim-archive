import { FREE_TIER_BUDGET } from "../../config.js";
import {
  createSelectedDisposalBatch,
  createDisposalBatch,
  disposeDocumentsBulk,
  getDisposalCandidates,
  getDisposalDueYears,
  getDisposalHistoryPage,
  getRackSummaries,
  loadDocumentFormOptions,
  parseDisposalFilters,
  processDisposalBatch,
  startDisposalBatch
} from "../../db.js";
import { disposalWorkspacePage, errorPage } from "../../html.js";
import { clean, redirect } from "../../utils.js";

export async function handleDisposalWorkspace(request, env, session) {
  const params = new URL(request.url).searchParams;
  const filters = { ...parseDisposalFilters(params), query: clean(params.get("q")) };
  const tab = params.get("tab") === "history" ? "history" : "targets";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const feedback = feedbackFromParams(params);
  return renderDisposalWorkspace(env, session, filters, feedback, { tab, page });
}

async function renderDisposalWorkspace(env, session, filters, feedback = null, { tab = "targets", page = 1 } = {}) {
  const historyPromise = tab === "history"
    ? getDisposalHistoryPage(env, { query: filters.query, page })
    : Promise.resolve({ items: [], pagination: { page: 1, totalPages: 1, totalItems: 0 } });
  const [{ categories }, racks, years, candidates, history] = await Promise.all([
    loadDocumentFormOptions(env, { activeOnly: true, includeSlots: false }),
    getRackSummaries(env),
    getDisposalDueYears(env),
    tab === "targets"
      ? getDisposalCandidates(env, filters, FREE_TIER_BUDGET.disposalProcessChunkSize + 1)
      : Promise.resolve([]),
    historyPromise
  ]);
  return disposalWorkspacePage({
    session,
    categories,
    racks,
    years,
    filters,
    documents: candidates.slice(0, FREE_TIER_BUDGET.disposalProcessChunkSize),
    capped: candidates.length > FREE_TIER_BUDGET.disposalProcessChunkSize,
    legacyLimit: FREE_TIER_BUDGET.disposalProcessChunkSize,
    history: history.items,
    pagination: history.pagination,
    tab,
    feedback
  });
}

export async function handleSelectedDisposal(request, env, session) {
  const form = await request.formData();
  const ids = clean(form.get("ids")).split(",").map(Number);
  const filters = {
    ...parseDisposalFilters({
      categoryId: form.get("categoryId"),
      rackId: form.get("rackId"),
      disposalDueYear: form.get("disposalDueYear")
    }),
    query: clean(form.get("q"))
  };
  let created;
  try {
    created = await createSelectedDisposalBatch(env, {
      documentIds: ids,
      disposalReason: form.get("reason"),
      approvalReference: form.get("approvalReference")
    }, session);
  } catch (error) {
    console.error("selected disposal batch failed", error);
    return renderDisposalWorkspace(env, session, filters, {
      type: "error",
      message: "선택 문서 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요."
    });
  }
  if (!created.ok) {
    return renderDisposalWorkspace(env, session, filters, { type: "error", message: created.message });
  }
  const started = await startDisposalBatch(env, created.id, session);
  if (!started.ok) return errorPage(started.message, session, 409);
  const processed = await processDisposalBatch(env, created.id, session);
  if (!processed.ok) return errorPage(processed.message, session, 409);
  const completed = Number(processed.batch?.completed_count || 0);
  const skipped = Number(processed.batch?.changed_count || 0) + Number(processed.batch?.failed_count || 0);
  return redirect(`/documents/disposal?tab=history&toast=bulk-disposed&disposed=${completed}&skipped=${skipped}`);
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

function feedbackFromParams(params) {
  if (params.get("toast") !== "bulk-disposed") return null;
  const disposed = Math.max(0, Number(params.get("disposed")) || 0);
  const skipped = Math.max(0, Number(params.get("skipped")) || 0);
  return {
    type: skipped ? "warning" : "success",
    message: skipped
      ? `폐기 ${disposed}건 완료, 상태 변경으로 ${skipped}건을 건너뛰었습니다.`
      : `문서 ${disposed}건을 폐기했습니다.`
  };
}
