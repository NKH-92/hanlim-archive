import { createSearchService } from "./application/service.js";
import * as repository from "./infrastructure/repository.js";

const service = createSearchService(repository);
export const {
  searchDocuments, searchDocumentsWithSuggestions, buildSearchSuggestions, getDidYouMeanSuggestions,
  getSearchIndexMeta, getSearchIndexDocuments, getSearchSuggestions, getSearchIndexStats,
  getViewerSearchPayload, parseDocumentFilters, recordSearchClick, recordSearchLog, getSearchReport
} = service;
export { documentToViewerItem, buildViewerFacets } from "./web/presenters.js";
export { createSearchCore, sharedSearchCore } from "../../searchCore.js";
export { MAX_SEARCH_RESULTS, parseSearchQuery } from "../../data/searchData.js";
export { buildSearchIndexTerms } from "../../data/searchData.js";
export {
  cleanupRetiredSearchGenerations,
  getSearchOperationalState,
  processPendingSearchOutboxImmediately,
  processSearchOutbox,
  processSearchOutboxForDocument,
  processSearchOutboxForDocuments,
  rebuildSearchIndexChunk
} from "./infrastructure/indexMaintenance.js";
export const {
  compactSearchText,
  levenshteinDistance,
  normalizeSearchText,
  scoreDocumentMatch,
  searchTokens
} = service;
