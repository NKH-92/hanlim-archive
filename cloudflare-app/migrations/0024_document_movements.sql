-- 문서 일반정보 수정과 물리적 위치 이동을 분리하고, 이동 당시의 위치를 영구 보존한다.
-- 문서가 나중에 완전삭제되어도 이동 이력이 남아야 하므로 documents FK/cascade는 사용하지 않는다.
CREATE TABLE IF NOT EXISTS document_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  document_number_snapshot TEXT NOT NULL,
  from_rack_slot_id INTEGER NOT NULL,
  from_rack_face TEXT NOT NULL CHECK (from_rack_face IN ('A', 'B')),
  to_rack_slot_id INTEGER NOT NULL,
  to_rack_face TEXT NOT NULL CHECK (to_rack_face IN ('A', 'B')),
  from_location_snapshot TEXT NOT NULL,
  to_location_snapshot TEXT NOT NULL,
  reason TEXT NOT NULL,
  performed_by_user_id INTEGER,
  performed_by_username TEXT NOT NULL,
  performed_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_movements_document
ON document_movements(document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_movements_created
ON document_movements(created_at DESC);

-- 이동 이력은 감사 증적이므로 애플리케이션 실수나 운영 SQL로 수정·삭제하지 못하게 한다.
CREATE TRIGGER IF NOT EXISTS trg_document_movements_no_update
BEFORE UPDATE ON document_movements
BEGIN
  SELECT RAISE(ABORT, 'document_movements is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_document_movements_no_delete
BEFORE DELETE ON document_movements
BEGIN
  SELECT RAISE(ABORT, 'document_movements is append-only');
END;
