-- 10,000행 Excel bootstrap staging의 write amplification을 줄인다.
--
-- document_snapshot_rows.id 제거도 검토했지만 직전 Worker가 snapshot 상세 조회에서 id를 SELECT하므로
-- expand/contract 없이 제거하면 Worker rollback 호환성을 깨뜨린다. 따라서 table shape는 그대로 유지한다.
--
-- idx_document_snapshot_rows_action(snapshot_id, action, row_number)은 staging 10,000행마다 갱신되지만
-- snapshot별 최대 12,000행이고 기존 UNIQUE(snapshot_id, row_number)가 snapshot 범위 탐색을 제공한다.
-- action 필터는 이 bounded 범위에서 후처리해도 충분하므로 secondary index만 제거한다.

DROP INDEX IF EXISTS idx_document_snapshot_rows_action;
