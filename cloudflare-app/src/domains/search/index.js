import * as repository from "./infrastructure/repository.js";
import {
  drainSearchProjectionDirty,
  drainSearchProjectionDirtyForDocuments,
  reindexSearchProjectionChunk
} from "./infrastructure/projection.js";
import { FREE_TIER_BUDGET } from "../../freeTierBudget.js";

export const {
  searchDocuments, searchDocumentsWithSuggestions, buildSearchSuggestions, getDidYouMeanSuggestions,
  getSearchSuggestions, getViewerSearchPayload, parseDocumentFilters, recordSearchClick, recordSearchLog,
  getSearchReport
} = repository;
export { documentToViewerItem, buildViewerFacets } from "./web/presenters.js";
export { createSearchCore, sharedSearchCore } from "../../searchCore.js";
export { MAX_SEARCH_RESULTS, parseSearchQuery } from "../../data/searchData.js";
export { buildSearchIndexTerms } from "../../data/searchIndexTerms.js";
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
 * 변경 문서 색인 반영. projection 쓰기와 dirty 큐 삭제가 같은 Core batch에서 끝나므로
 * "projection 최신 OR 문서가 dirty"가 트랜잭션으로 보장된다.
 */
export function syncChangedSearchDocuments(env, documentIds) {
  return drainSearchProjectionDirtyForDocuments(env, documentIds);
}

export function syncPendingSearchDocuments(env, { limit } = {}) {
  const bounded = Number(limit) > 0 ? Number(limit) : FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems;
  return drainSearchProjectionDirty(env, { limit: bounded });
}

export async function runBoundedSearchMaintenance(env) {
  const projectionDirty = await drainSearchProjectionDirty(env);
  const projectionReindex = await reindexSearchProjectionChunk(env);
  return {
    ok: projectionDirty.ok !== false && projectionReindex.ok !== false,
    projectionDirty,
    projectionReindex
  };
}
