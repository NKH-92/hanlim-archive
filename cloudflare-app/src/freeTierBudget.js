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
  directBulkDisposeMaxItems: 10,
  disposalBatchMaxItems: 5000,
  disposalBatchPreviewItems: 100,
  disposalProcessChunkSize: 25,
  csvImportMaxItems: 50,
  csvImportProcessChunkSize: 1,
  documentCapacityWarningCount: 27000,
  documentCapacityHardCount: 30000,
  excelSnapshotMaxItems: 30000,
  excelSnapshotDeltaMaxItems: 1000,
  excelSnapshotMembershipChunkSize: 1000,
  excelSnapshotStageChunkSize: 50,
  excelSnapshotExportPageSize: 250,
  excelSnapshotMaxFileBytes: 20 * 1024 * 1024,
  excelSnapshotMaxZipEntries: 500,
  excelSnapshotMaxZipUncompressedBytes: 100 * 1024 * 1024,
  bootstrapApplyChunkSize: 5000,
  bootstrapApplyScheduleThreshold: 5000,
  snapshotMembershipRetentionCount: 3,
  snapshotMembershipCleanupChunkSize: 500,
  documentPageSize: 30,
  searchCandidateMaxItems: 200,
  searchResponseMaxItems: 30,
  searchOutboxCronChunkSize: 25,
  // 전체 재색인은 bootstrap/복구 때만 필요하다. 3만건도 약 5시간 안에 회복하도록
  // Cron마다 500건씩 전진하되, JSON payload는 projection 계층에서 D1 값 상한에 맞춰 재분할한다.
  searchRebuildChunkSize: 500,
  // 운영 지표용 일일 정지선. 최초 등록은 5,000건씩 날짜를 나누며 실제 Cloudflare 지표가 최종 권위값이다.
  initialLoadDailyRowsWrittenStop: 95000
});
