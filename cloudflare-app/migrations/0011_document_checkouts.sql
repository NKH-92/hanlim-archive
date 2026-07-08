CREATE TABLE IF NOT EXISTS document_checkouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  borrower TEXT NOT NULL,
  purpose TEXT,
  checked_out_by TEXT NOT NULL,
  checked_out_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_by TEXT,
  returned_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_checkouts_document ON document_checkouts(document_id, returned_at);

-- 문서당 활성 반출은 1건만 허용한다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_checkouts_one_active
  ON document_checkouts(document_id)
  WHERE returned_at IS NULL;
