-- 폐기 캠페인: 조건을 동결 시점의 문서 스냅샷으로 고정하고 분할 처리한다.
CREATE TABLE IF NOT EXISTS disposal_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  disposal_reason TEXT NOT NULL,
  approval_reference TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'frozen', 'processing', 'completed', 'cancelled')),
  target_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER NOT NULL,
  created_by_name TEXT NOT NULL,
  frozen_by_user_id INTEGER,
  frozen_by_name TEXT,
  completed_by_user_id INTEGER,
  completed_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  frozen_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS disposal_batch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  document_id INTEGER,
  document_number_snapshot TEXT NOT NULL,
  revision_number_snapshot TEXT NOT NULL,
  document_name_snapshot TEXT NOT NULL,
  category_snapshot TEXT,
  location_snapshot TEXT,
  disposal_due_year_snapshot INTEGER,
  expected_updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'excluded', 'completed', 'changed', 'failed')),
  exclusion_reason TEXT,
  result_message TEXT,
  processing_token TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES disposal_batches(id) ON DELETE CASCADE,
  UNIQUE (batch_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_disposal_batches_status
  ON disposal_batches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disposal_items_batch_status
  ON disposal_batch_items(batch_id, status, id);
CREATE INDEX IF NOT EXISTS idx_disposal_items_document
  ON disposal_batch_items(document_id);
CREATE INDEX IF NOT EXISTS idx_disposal_items_processing
  ON disposal_batch_items(processing_token);

ALTER TABLE disposal_logs ADD COLUMN disposal_batch_id INTEGER;
ALTER TABLE disposal_logs ADD COLUMN disposal_batch_item_id INTEGER;
ALTER TABLE document_audit_logs ADD COLUMN disposal_batch_id INTEGER;
ALTER TABLE document_audit_logs ADD COLUMN disposal_batch_item_id INTEGER;

-- 캠페인 항목 하나가 업무 로그마다 한 번만 연결되게 해 재호출을 멱등하게 만든다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_disposal_logs_batch_item_unique
  ON disposal_logs(disposal_batch_item_id)
  WHERE disposal_batch_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_audit_batch_item_unique
  ON document_audit_logs(disposal_batch_item_id)
  WHERE disposal_batch_item_id IS NOT NULL;
