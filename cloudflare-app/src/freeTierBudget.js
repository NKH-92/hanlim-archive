// Cloudflare 공식 한도와 별개로 이 애플리케이션이 지키는 보수적 내부 예산이다.
// 대량 작업은 이 값을 넘기지 않고 여러 요청으로 나누며, UI와 테스트도 같은 값을 쓴다.
export const FREE_TIER_BUDGET = Object.freeze({
  // Cloudflare Free의 50 query/invocation보다 2개 낮춰 진단·정리 여유를 둔다.
  maxD1StatementsPerRequest: 48,
  maxD1MutationStatementsPerBatch: 40,
  maxD1BoundParametersPerStatement: 100,
  maxD1LikePatternBytes: 50,
  maxD1ValueBytes: 2_000_000,
  // JSON과 D1 내부 표현의 여유를 남긴 application payload 상한.
  maxD1ValuePayloadBytes: 1_900_000,
  legacyBulkDisposeMaxItems: 10,
  disposalBatchMaxItems: 5000,
  disposalBatchPreviewItems: 100,
  disposalProcessChunkSize: 25,
  csvImportMaxItems: 50,
  csvImportProcessChunkSize: 1,
  documentCapacityWarningCount: 11000,
  documentCapacityHardCount: 12000,
  excelSnapshotMaxItems: 12000,
  excelSnapshotDeltaMaxItems: 1000,
  excelSnapshotMembershipChunkSize: 1000,
  excelSnapshotStageChunkSize: 50,
  excelSnapshotExportPageSize: 250,
  excelSnapshotMaxFileBytes: 10 * 1024 * 1024,
  excelSnapshotMaxZipEntries: 500,
  excelSnapshotMaxZipUncompressedBytes: 50 * 1024 * 1024,
  documentPageSize: 30,
  searchCandidateMaxItems: 200,
  searchResponseMaxItems: 30,
  searchOutboxCronChunkSize: 25,
  searchRebuildChunkSize: 100,
  searchIndexWarningCount: 11000,
  searchIndexReviewCount: 12000,
  initialLoadDailyRowsWrittenStop: 70000
});
