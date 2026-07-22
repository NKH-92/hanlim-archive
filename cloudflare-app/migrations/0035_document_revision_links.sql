PRAGMA foreign_keys = ON;

-- 동일 바인더에서 이전본을 새 개정본으로 교체한 관계를 보존한다.
-- 과거 데이터는 자동 추정하지 않고, 이 기능으로 처리한 개정부터 명시적으로 연결한다.
CREATE TABLE document_revision_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  previous_document_id INTEGER NOT NULL UNIQUE,
  new_document_id INTEGER NOT NULL UNIQUE,
  previous_revision_number TEXT NOT NULL,
  new_revision_number TEXT NOT NULL,
  performed_by_user_id INTEGER,
  performed_by_username TEXT NOT NULL,
  performed_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (previous_document_id <> new_document_id),
  FOREIGN KEY (previous_document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  FOREIGN KEY (new_document_id) REFERENCES documents(id) ON DELETE RESTRICT
);

CREATE INDEX idx_document_revision_links_created
ON document_revision_links(created_at DESC, id DESC);

CREATE TRIGGER trg_document_revision_links_no_update
BEFORE UPDATE ON document_revision_links
BEGIN
  SELECT RAISE(ABORT, '문서 개정 이력은 수정할 수 없습니다(append-only).');
END;

CREATE TRIGGER trg_document_revision_links_no_delete
BEFORE DELETE ON document_revision_links
BEGIN
  SELECT RAISE(ABORT, '문서 개정 이력은 삭제할 수 없습니다(append-only).');
END;
