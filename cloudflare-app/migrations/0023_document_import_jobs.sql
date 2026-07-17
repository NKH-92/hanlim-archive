-- CSV 원문은 저장하지 않고 검증·정규화한 행 payload만 작업 항목으로 보존한다.
CREATE TABLE IF NOT EXISTS document_import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_code TEXT NOT NULL UNIQUE,
  source_name TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'processing', 'completed', 'cancelled')),
  total_count INTEGER NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_import_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  created_document_id INTEGER,
  error_message TEXT,
  processing_token TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES document_import_jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_document_import_jobs_status
  ON document_import_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_import_items_job_status
  ON document_import_items(job_id, status, id);
CREATE INDEX IF NOT EXISTS idx_document_import_items_processing
  ON document_import_items(processing_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_import_items_created_document
  ON document_import_items(created_document_id)
  WHERE created_document_id IS NOT NULL;
