// 데이터 계층 배럴: src/data/* 도메인 모듈의 공개 표면을 한 곳에서 재수출한다.
// 핸들러(index.js)와 테스트(tests/db.test.js)는 이 경로(./db.js)를 통해서만 임포트한다.

export {
  normalizeSearchText,
  compactSearchText,
  searchTokens,
  levenshteinDistance,
  scoreDocumentMatch,
  parseSearchQuery,
  MAX_SEARCH_RESULTS,
  searchDocuments,
  recordSearchClick,
  recordSearchLog,
  getSearchReport,
  getDidYouMeanSuggestions,
  getSearchIndexMeta,
  getSearchIndexDocuments,
  getSearchSuggestions,
  documentToViewerItem,
  buildViewerFacets,
  getViewerSearchPayload
} from "./data/searchData.js";

export {
  getCategoryDocumentIndex,
  getDocumentQualitySummary,
  getDocumentsForExport,
  getDocument,
  getDocumentTags,
  getDisposalLogs,
  getDocumentAuditLogs,
  validateDocumentInput,
  createDocument,
  updateDocument,
  disposeDocument,
  restoreDocument,
  permanentlyDeleteDocument,
  parseDocumentNumberList,
  findDocumentsByNumbers,
  valuesFromDocumentForm
} from "./data/documentsData.js";

export {
  DEFAULT_FLOOR_PLAN_REGIONS,
  getFloorPlanRegions,
  buildFloorPlanLayout,
  getRackSummaries,
  getRackDetails,
  getRackDocuments,
  getSlotOptions,
  upsertRack,
  configureRackCounts
} from "./data/racksData.js";

export {
  getCategories,
  getActiveCategories,
  getTags,
  getActiveTags,
  upsertCategory,
  deleteCategory,
  upsertTag,
  deleteTag
} from "./data/mastersData.js";

export {
  getAppUsers,
  createSignupRequest,
  approveUser,
  rejectUser
} from "./data/usersData.js";

export {
  getDocumentSets,
  getDocumentSet,
  getDocumentSetDocuments,
  upsertDocumentSet,
  deleteDocumentSet,
  addDocumentsToSet,
  removeDocumentFromSet,
  getDocumentSetLogs
} from "./data/setsData.js";
