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
  buildSearchSuggestions,
  searchDocumentsWithSuggestions,
  recordSearchClick,
  recordSearchLog,
  getSearchReport,
  getDidYouMeanSuggestions,
  getSearchIndexMeta,
  getSearchIndexDocuments,
  getSearchIndexStats,
  getSearchSuggestions,
  documentToViewerItem,
  buildViewerFacets,
  getViewerSearchPayload
} from "./data/searchData.js";

export {
  parseDocumentFilters,
  buildDocumentFilterWhere
} from "./data/searchFilters.js";

export {
  getCategoryDocumentIndex,
  getDocumentQualitySummary,
  getDocumentPage,
  getDocumentCount,
  getDocumentsForExport,
  getDocument,
  findDuplicateDocument,
  getDocumentTags,
  getDisposalLogs,
  getDocumentAuditLogs,
  validateDocumentInput,
  validateDocumentInputDetails,
  parseDocumentNumberList,
  findDocumentsByNumbers,
  valuesFromDocumentForm,
  documentToFormValues,
  loadDocumentFormOptions,
  parseDisposalFilters,
  getDisposalDueYears,
  getDisposalCandidates
} from "./data/documentsData.js";

export {
  createDocument,
  updateDocument,
  disposeDocument,
  disposeDocumentsBulk,
  restoreDocument,
  permanentlyDeleteDocument
} from "./data/documentMutations.js";

export {
  DEFAULT_FLOOR_PLAN_REGIONS,
  getFloorPlanRegions,
  buildFloorPlanLayout,
  getRackSummaries,
  getRackDetails,
  getRackDocuments,
  getRackGrid,
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
  getAppUser,
  createSignupRequest,
  approveUser,
  rejectUser,
  disableUser,
  enableUser,
  updateUserPermissions
} from "./data/usersData.js";

export {
  getDocumentSets,
  getDocumentSet,
  getDocumentSetDocuments,
  upsertDocumentSet,
  deleteDocumentSet,
  addDocumentsToSet,
  removeDocumentFromSet,
  getDocumentSetLogs,
  setDocumentSetLock
} from "./data/setsData.js";

export {
  createSystemAuditStatement,
  getSystemAuditPage,
  normalizeAuditFilters
} from "./data/systemAuditData.js";

export {
  normalizeDisposalCriteria,
  validateDisposalBatchDraft,
  listDisposalBatches,
  getDisposalBatch,
  getDisposalBatchItems,
  previewDisposalCandidates,
  createDisposalBatch,
  createSelectedDisposalBatch,
  getDisposalHistoryPage,
  updateDisposalBatch,
  freezeDisposalBatch,
  setDisposalBatchItemExcluded,
  startDisposalBatch,
  processDisposalBatch,
  cancelDisposalBatch,
  getDisposalBatchExportRows
} from "./data/disposalBatchData.js";

export {
  listDocumentImportJobs,
  getDocumentImportJob,
  getDocumentImportItems,
  createDocumentImportJob,
  processDocumentImportJob,
  failDocumentImportItem,
  cancelDocumentImportJob,
  getDocumentImportFailureRows
} from "./data/importJobData.js";

export {
  moveDocument,
  getDocumentMovements,
  getDocumentMovementPage
} from "./data/movementData.js";

export {
  DATA_QUALITY_ISSUES,
  normalizeDataQualityIssue,
  getDataQualityPage
} from "./data/dataQualityData.js";
