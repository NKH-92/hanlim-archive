// Cloudflare 공식 한도와 별개로 이 애플리케이션이 지키는 보수적 내부 예산이다.
// 대량 작업은 이 값을 넘기지 않고 여러 요청으로 나누며, UI와 테스트도 같은 값을 쓴다.
export const FREE_TIER_BUDGET = Object.freeze({
  // Cloudflare Free의 50 query/invocation보다 2개 낮춰 진단·정리 여유를 둔다.
  maxD1StatementsPerRequest: 48,
  maxD1MutationStatementsPerBatch: 40,
  // 로그인 실패 1건은 pair/account/ip/global을 한 원자 batch로 기록한다.
  loginFailureMutationStatementsPerBatch: 4,
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
  // 전체 재색인은 bootstrap/복구 때만 필요하다. 10,000건을 한 UTC 일자에 밀어 넣지 않고
  // 실제 rows_written을 관측하며 여러 Cron으로 분산하기 위해 의도적으로 작게 유지한다.
  searchRebuildChunkSize: 10,
  searchIndexWarningCount: 11000,
  searchIndexReviewCount: 12000,
  // 최초 10,000건 apply 전용 정지선. 문서명 exact index를 포함한 지배적 write 추정은 약 80,000행이므로
  // UTC 일자 시작 사용량이 5,000행 미만일 때만 수행하고 85,000행부터 추가 대량 write를 중지한다.
  initialLoadDailyRowsWrittenStop: 85000
});
