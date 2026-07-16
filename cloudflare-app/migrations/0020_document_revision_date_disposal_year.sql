-- 문서 제·개정일과 폐기 예정 연도. 기존 문서는 알 수 없는 값을 추정하지 않고 NULL로 유지한다.
ALTER TABLE documents ADD COLUMN revision_date TEXT
  CHECK (revision_date IS NULL OR revision_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

ALTER TABLE documents ADD COLUMN disposal_due_year INTEGER
  CHECK (disposal_due_year IS NULL OR disposal_due_year BETWEEN 1900 AND 9999);

CREATE INDEX IF NOT EXISTS idx_documents_active_disposal_year
  ON documents(status, disposal_due_year);
