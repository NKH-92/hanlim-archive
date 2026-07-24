import { FREE_TIER_BUDGET } from "../../config.js";
import {
  countDisposalCandidates,
  createSelectedDisposalBatch,
  createDisposalBatch,
  freezeDisposalBatch,
  getDisposalBatch,
  getDisposalHistoryPage,
  listDisposalBatches,
  processDisposalBatch,
  startDisposalBatch
} from "../../domains/disposal/index.js";
import {
  disposeDocumentsBulk,
  getDisposalCandidates,
  getDisposalDueYears,
  loadDocumentFormOptions,
  parseDisposalFilters
} from "../../domains/documents/index.js";
import { getRackSummaries } from "../../domains/racks/index.js";
import { disposalWorkspacePage } from "../../views/documentViews.js";
import { errorPage } from "../../views/authViews.js";
import { redirect } from "../../platform/http/responses.js";
import { clean } from "../../shared/text/normalize.js";
import { readBoolean } from "../../shared/coercion.js";

export async function handleDisposalWorkspace(request, env, session) {
  const params = new URL(request.url).searchParams;
  const filters = { ...parseDisposalFilters(params), query: clean(params.get("q")) };
  const requestedTab = clean(params.get("tab"));
  const tab = requestedTab === "history" || requestedTab === "documents" ? requestedTab : "active";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const feedback = feedbackFromParams(params);
  return renderDisposalWorkspace(env, session, filters, feedback, { tab, page });
}

async function renderDisposalWorkspace(env, session, filters, feedback = null, { tab = "active", page = 1 } = {}) {
  const historyPromise = tab === "documents"
    ? getDisposalHistoryPage(env, { query: filters.query, page })
    : Promise.resolve({ items: [], pagination: { page: 1, totalPages: 1, totalItems: 0 } });
  const campaignsPromise = tab === "history" ? listDisposalBatches(env) : Promise.resolve([]);
  const [{ categories }, racks, years, candidates, history, campaigns] = await Promise.all([
    loadDocumentFormOptions(env, { activeOnly: true, includeSlots: false }),
    getRackSummaries(env),
    getDisposalDueYears(env),
    tab === "active"
      ? getDisposalCandidates(env, filters, FREE_TIER_BUDGET.disposalProcessChunkSize + 1)
      : Promise.resolve([]),
    historyPromise,
    campaignsPromise
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
    campaigns,
    pagination: history.pagination,
    tab,
    feedback
  });
}

export async function handleSelectedDisposal(request, env, session) {
  const form = await request.formData();
  const ids = [...new Set(clean(form.get("ids")).split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const returnTo = safeSelectedDisposalReturn(form.get("returnTo"));
  const filters = {
    ...parseDisposalFilters({
      categoryId: form.get("categoryId"),
      rackId: form.get("rackId"),
      disposalDueYear: form.get("disposalDueYear")
    }),
    query: clean(form.get("q"))
  };
  if (!ids.length || ids.length > FREE_TIER_BUDGET.legacyBulkDisposeMaxItems) {
    if (returnTo) return redirect(withToast(returnTo, "error"));
    return renderDisposalWorkspace(env, session, filters, {
      type: "error",
      message: `선택 폐기는 한 번에 ${FREE_TIER_BUDGET.legacyBulkDisposeMaxItems}건 이하만 처리할 수 있습니다.`
    });
  }
  let created;
  try {
    created = await createSelectedDisposalBatch(env, {
      documentIds: ids,
      disposalReason: form.get("reason"),
      approvalReference: form.get("approvalReference"),
      confirmedTargetCount: form.get("confirmedTargetCount"),
      confirmDisposal: form.get("confirmDisposal")
    }, session);
  } catch (error) {
    console.error("selected disposal batch failed", error);
    if (returnTo) return redirect(withToast(returnTo, "error"));
    return renderDisposalWorkspace(env, session, filters, {
      type: "error",
      message: "선택 문서 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요."
    });
  }
  if (!created.ok) {
    if (returnTo) return redirect(withToast(returnTo, "error"));
    return renderDisposalWorkspace(env, session, filters, { type: "error", message: created.message });
  }
  const started = await startDisposalBatch(env, created.id, session, {
    confirmedTargetCount: created.count,
    confirmStart: true
  });
  if (!started.ok) return errorPage(started.message, session, 409);
  const processed = await processDisposalBatch(env, created.id, session);
  if (!processed.ok) return errorPage(processed.message, session, 409);
  const completed = Number(processed.batch?.completed_count || 0);
  const skipped = Number(processed.batch?.changed_count || 0) + Number(processed.batch?.failed_count || 0);
  if (returnTo) return redirect(withToast(returnTo, "bulk-disposed", { disposed: completed, skipped }));
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

  const confirmedTargetCount = Number(form.get("confirmedTargetCount"));
  if (
    !readBoolean(form.get("confirmDisposal"))
    || !Number.isInteger(confirmedTargetCount)
    || confirmedTargetCount !== ids.length
  ) {
    return errorPage(`현재 선택한 폐기 대상은 ${ids.length}건입니다. 정확한 건수를 다시 확인해 주세요.`, session, 409);
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
  const approvalReference = clean(form.get("approvalReference"));
  if (!reason || (!filters.categoryId && !filters.rackId && !filters.disposalDueYear)) {
    return errorPage("폐기 사유와 하나 이상의 필터가 필요합니다.", session, 400);
  }
  const criteria = { ...filters, yearMode: "exact" };
  const targetCount = await countDisposalCandidates(env, criteria);
  const confirmedTargetCount = Number(form.get("confirmedTargetCount"));
  if (
    !readBoolean(form.get("confirmDisposal"))
    || !Number.isInteger(confirmedTargetCount)
    || confirmedTargetCount !== targetCount
  ) {
    return errorPage(`현재 필터 전체 대상은 ${targetCount}건입니다. 총 폐기 문서 수를 다시 확인해 주세요.`, session, 409);
  }
  if (!targetCount) {
    return errorPage("현재 조건에 맞는 보관중 문서가 없습니다.", session, 409);
  }
  if (targetCount > FREE_TIER_BUDGET.disposalBatchMaxItems) {
    return errorPage(
      `정기폐기 한 캠페인의 안전 상한은 ${FREE_TIER_BUDGET.disposalBatchMaxItems}건입니다. 연도 또는 대분류 조건을 더 좁혀 주세요.`,
      session,
      409
    );
  }

  const result = await createDisposalBatch(env, {
    title: clean(form.get("title")) || (filters.disposalDueYear ? `${filters.disposalDueYear}년 정기폐기` : "정기폐기"),
    disposalReason: reason,
    approvalReference,
    criteria
  }, session);
  if (!result.ok) {
    return errorPage(result.message, session, 400);
  }
  const batch = await getDisposalBatch(env, result.id);
  const frozen = await freezeDisposalBatch(env, result.id, session, batch?.updated_at, {
    confirmedTargetCount: targetCount,
    confirmPreview: true
  });
  if (!frozen.ok) {
    return errorPage(
      `${frozen.message} 생성된 캠페인 초안은 캠페인 이력에서 다시 검토할 수 있습니다.`,
      session,
      409
    );
  }
  const started = await startDisposalBatch(env, result.id, session, {
    confirmedTargetCount: frozen.count,
    confirmStart: true
  });
  if (!started.ok) return errorPage(started.message, session, 409);
  return redirect(`/disposal-batches/${result.id}?autostart=1`);
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

function safeSelectedDisposalReturn(value) {
  const path = clean(value);
  try {
    const url = new URL(path, "https://archive.local");
    return url.origin === "https://archive.local" && url.pathname === "/app"
      ? `${url.pathname}${url.search}`
      : "";
  } catch {
    return "";
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
