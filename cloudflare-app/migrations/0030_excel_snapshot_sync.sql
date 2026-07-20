-- 엑셀 파일 한 건을 문서고의 현재 대장으로 동기화하기 위한 스냅샷 구조.
-- 기존 문서는 삭제하지 않고 sync_state로 현재 대장 포함 여부를 구분해 이력과 세트 연결을 보존한다.

ALTER TABLE documents ADD COLUMN excel_row_key TEXT;
ALTER TABLE documents ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'current'
  CHECK (sync_state IN ('current', 'excluded'));
ALTER TABLE documents ADD COLUMN last_snapshot_id INTEGER;

-- 기존 문서에도 안정적인 내부 행 키를 부여한다. 이후 시스템에서 추출한 엑셀의 숨김 열에만 들어간다.
UPDATE documents
SET excel_row_key = 'HLM-' || printf('%012d', id)
WHERE excel_row_key IS NULL;

CREATE UNIQUE INDEX idx_documents_excel_row_key
ON documents(excel_row_key)
WHERE excel_row_key IS NOT NULL;

CREATE INDEX idx_documents_sync_state
ON documents(sync_state, status, updated_at DESC);

CREATE TABLE document_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  current_snapshot_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO document_sync_state (id, current_version) VALUES (1, 1);

CREATE TABLE document_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_code TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  base_version INTEGER NOT NULL,
  previous_snapshot_id INTEGER,
  status TEXT NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging', 'ready', 'applying', 'completed', 'cancelled', 'failed')),
  has_row_keys INTEGER NOT NULL DEFAULT 0 CHECK (has_row_keys IN (0, 1)),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  staged_count INTEGER NOT NULL DEFAULT 0 CHECK (staged_count >= 0),
  create_count INTEGER NOT NULL DEFAULT 0 CHECK (create_count >= 0),
  update_count INTEGER NOT NULL DEFAULT 0 CHECK (update_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  exclude_count INTEGER NOT NULL DEFAULT 0 CHECK (exclude_count >= 0),
  error_summary TEXT,
  created_by_user_id INTEGER,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  prepared_at TEXT,
  applied_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_document_snapshots_status
ON document_snapshots(status, created_at DESC);

CREATE TABLE document_snapshot_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  row_key TEXT NOT NULL,
  source_json TEXT NOT NULL,
  normalized_json TEXT,
  action TEXT NOT NULL DEFAULT 'staged'
    CHECK (action IN ('staged', 'create', 'update', 'unchanged')),
  matched_document_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id) REFERENCES document_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (matched_document_id) REFERENCES documents(id) ON DELETE SET NULL,
  UNIQUE (snapshot_id, row_number),
  UNIQUE (snapshot_id, row_key)
);

CREATE INDEX idx_document_snapshot_rows_action
ON document_snapshot_rows(snapshot_id, action, row_number);

CREATE TRIGGER trg_document_excel_row_key
AFTER INSERT ON documents
WHEN NEW.excel_row_key IS NULL
BEGIN
  UPDATE documents
  SET excel_row_key = 'HLM-' || printf('%012d', NEW.id)
  WHERE id = NEW.id;
END;

-- 개별 등록·수정·이동 등 엑셀 밖의 변경도 파일 버전 충돌 검사에 반영한다.
CREATE TRIGGER trg_document_sync_version_insert
AFTER INSERT ON documents
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_sync_version_update
AFTER UPDATE ON documents
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_sync_version_delete
AFTER DELETE ON documents
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;
