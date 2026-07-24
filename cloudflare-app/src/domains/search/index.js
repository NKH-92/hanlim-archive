import * as repository from "./infrastructure/repository.js";
import {
  processPendingSearchOutboxImmediately,
  processSearchOutbox,
  processSearchOutboxForDocument,
  processSearchOutboxForDocuments,
  rebuildSearchIndexChunk
} from "./infrastructure/indexMaintenance.js";

export const {
  searchDocuments, searchDocumentsWithSuggestions, buildSearchSuggestions, getDidYouMeanSuggestions,
  getSearchIndexMeta, getSearchIndexDocuments, getSearchSuggestions, getSearchIndexStats,
  getViewerSearchPayload, parseDocumentFilters, recordSearchClick, recordSearchLog, getSearchReport
} = repository;
export { documentToViewerItem, buildViewerFacets } from "./web/presenters.js";
export { createSearchCore, sharedSearchCore } from "../../searchCore.js";
export { MAX_SEARCH_RESULTS, parseSearchQuery } from "../../data/searchData.js";
export { buildSearchIndexTerms } from "../../data/searchData.js";
export {
  cleanupRetiredSearchGenerations,
  getSearchOperationalState,
  processSearchOutboxForDocument
} from "./infrastructure/indexMaintenance.js";
export const {
  compactSearchText,
  levenshteinDistance,
  normalizeSearchText,
  scoreDocumentMatch,
  searchTokens
} = repository;

export function syncChangedSearchDocuments(env, documentIds) {
  return processSearchOutboxForDocuments(env, documentIds);
}

export function syncPendingSearchDocuments(env, { limit } = {}) {
  return processPendingSearchOutboxImmediately(env, { limit });
}

export async function runBoundedSearchMaintenance(env) {
  const outbox = await processSearchOutbox(env);
  const rebuild = await rebuildSearchIndexChunk(env);
  return { ok: outbox.ok !== false && rebuild.ok !== false, outbox, rebuild };
}

// Compatibility exports for domain-level tests and operational tooling.
export {
  processPendingSearchOutboxImmediately,
  processSearchOutbox,
  processSearchOutboxForDocuments,
  rebuildSearchIndexChunk
};
