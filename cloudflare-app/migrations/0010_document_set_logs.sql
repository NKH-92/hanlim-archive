-- 세트 변경 이력. 세트 삭제 후에도 기록이 남도록 FK를 걸지 않고 set_name을 함께 저장한다.
CREATE TABLE IF NOT EXISTS document_set_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  set_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'add', 'remove')),
  actor TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_set_logs_set ON document_set_logs(set_id, created_at);
