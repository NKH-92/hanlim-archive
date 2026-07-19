import { createSearchService } from "./application/service.js";
import * as repository from "./infrastructure/repository.js";

const service = createSearchService(repository);
export const {
  searchDocuments, searchDocumentsWithSuggestions, getSearchIndexMeta, getSearchIndexDocuments,
  getSearchSuggestions, recordSearchClick, recordSearchLog, getSearchReport
} = service;
export { documentToViewerItem, buildViewerFacets } from "./web/presenters.js";
export { createSearchCore, sharedSearchCore } from "../../searchCore.js";
