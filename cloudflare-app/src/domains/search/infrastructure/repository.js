export {
  compactSearchText,
  levenshteinDistance,
  normalizeSearchText,
  scoreDocumentMatch,
  searchTokens,
  searchDocuments,
  searchDocumentsWithSuggestions,
  buildSearchSuggestions,
  getDidYouMeanSuggestions,
  getSearchIndexMeta,
  getSearchIndexDocuments,
  getSearchIndexStats,
  getSearchSuggestions,
  getViewerSearchPayload,
  recordSearchClick,
  recordSearchLog,
  getSearchReport
} from "../../../data/searchData.js";

export { parseDocumentFilters } from "../../../data/searchFilters.js";
