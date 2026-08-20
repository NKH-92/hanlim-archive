-- Excel schema v3 export는 구역을 첫 번째 위치 정렬 키로 사용한다.
-- 기존 page 행은 완료되거나 새 schema에서 거부되므로 NULL을 허용한다.
ALTER TABLE document_snapshot_export_pages
ADD COLUMN cursor_zone_number INTEGER
  CHECK (cursor_zone_number BETWEEN 1 AND 3);
