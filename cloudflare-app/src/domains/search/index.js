import * as repository from "./infrastructure/repository.js";
import {
  processPendingSearchOutboxImmediately,
  processSearchOutbox,
  processSearchOutboxForDocument,
  processSearchOutboxForDocuments,
  rebuildSearchIndexChunk
} from "./infrastructure/indexMaintenance.js";
import {
  drainSearchProjectionDirty,
  drainSearchProjectionDirtyForDocuments,
  reindexSearchProjectionChunk
} from "./infrastructure/projection.js";
import { FREE_TIER_BUDGET } from "../../freeTierBudget.js";
import { remainingRequestD1Statements } from "../../platform/d1/requestGateway.js";

export const {
  searchDocuments, searchDocumentsWithSuggestions, buildSearchSuggestions, getDidYouMeanSuggestions,
  getSearchIndexMeta, getSearchIndexDocuments, getSearchSuggestions, getSearchIndexStats,
  getViewerSearchPayload, parseDocumentFilters, recordSearchClick, recordSearchLog, getSearchReport
} = repository;
export { documentToViewerItem, buildViewerFacets } from "./web/presenters.js";
export { createSearchCore, sharedSearchCore } from "../../searchCore.js";
export { MAX_SEARCH_RESULTS, parseSearchQuery, resolveSearchReadMode } from "../../data/searchData.js";
export { buildSearchIndexTerms } from "../../data/searchIndexTerms.js";
export {
  cleanupRetiredSearchGenerations,
  getSearchOperationalState,
  processSearchOutboxForDocument
} from "./infrastructure/indexMaintenance.js";
export {
  drainSearchProjectionDirty,
  getSearchProjectionState,
  markSearchProjectionReindexRequired,
  reindexSearchProjectionChunk
} from "./infrastructure/projection.js";
export const {
  compactSearchText,
  levenshteinDistance,
  normalizeSearchText,
  scoreDocumentMatch,
  searchTokens
} = repository;

/**
 * 변경 문서 색인 반영. Core projection은 같은 DB batch에서 원자적으로 갱신되고,
 * legacy Search D1은 SEARCH_DB binding이 남아 있는 동안에만 함께 반영한다.
 */
export async function syncChangedSearchDocuments(env, documentIds) {
  const projection = await drainSearchProjectionDirtyForDocuments(env, documentIds);
  const legacy = env.SEARCH_DB ? await processSearchOutboxForDocuments(env, documentIds) : null;
  return { ok: projection.ok !== false, projection, legacy };
}

export async function syncPendingSearchDocuments(env, { limit } = {}) {
  const bounded = Number(limit) > 0 ? Number(limit) : FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems;
  const projection = await drainSearchProjectionDirty(env, { limit: bounded });
  const legacy = env.SEARCH_DB
    ? await processPendingSearchOutboxImmediately(env, { limit })
    : null;
  return { ok: projection.ok !== false, projection, legacy };
}

// Cron 한 invocation은 Cloudflare Free의 요청당 query 상한(내부 예산 48)을 공유한다.
// legacy Search D1 유지보수가 아직 read 권한을 가질 수 있으므로 먼저 실행하고,
// Core projection 유지보수는 남은 예산이 한 chunk를 담을 수 있을 때만 진행한다.
// SEARCH_DB binding이 제거되면 projection이 예산 전체를 사용한다.
const MAINTENANCE_RESERVE = Object.freeze({
  projectionDirty: 8,
  projectionReindex: 11
});

export async function runBoundedSearchMaintenance(env) {
  const outbox = env.SEARCH_DB ? await processSearchOutbox(env) : null;
  const rebuild = env.SEARCH_DB ? await rebuildSearchIndexChunk(env) : null;
  const projectionDirty = remainingRequestD1Statements(env) >= MAINTENANCE_RESERVE.projectionDirty
    ? await drainSearchProjectionDirty(env)
    : null;
  const projectionReindex = remainingRequestD1Statements(env) >= MAINTENANCE_RESERVE.projectionReindex
    ? await reindexSearchProjectionChunk(env)
    : null;
  return {
    ok: (projectionDirty === null || projectionDirty.ok !== false)
      && (projectionReindex === null || projectionReindex.ok !== false)
      && (outbox === null || outbox.ok !== false)
      && (rebuild === null || rebuild.ok !== false),
    projectionDirty,
    projectionReindex,
    outbox,
    rebuild
  };
}

// Compatibility exports for domain-level tests and operational tooling.
export {
  processPendingSearchOutboxImmediately,
  processSearchOutbox,
  processSearchOutboxForDocuments,
  rebuildSearchIndexChunk
};
