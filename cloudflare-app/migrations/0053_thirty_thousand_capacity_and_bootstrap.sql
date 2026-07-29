-- 30,000건 문서고 전환: 용량 검사를 O(1) 카운터로 바꾸고, 최초 대량등록을 일 단위로
-- 자동 분할할 수 있는 진행 상태를 추가한다. 과거 migration은 수정하지 않는다.

UPDATE capacity_policy
SET warning_document_count = 27000,
    hard_document_count = 30000,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

ALTER TABLE bootstrap_runtime_control
ADD COLUMN suppress_capacity_triggers INTEGER NOT NULL DEFAULT 0
  CHECK (suppress_capacity_triggers IN (0, 1));

CREATE TABLE document_capacity_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_document_count INTEGER NOT NULL DEFAULT 0 CHECK (current_document_count >= 0),
  active_document_count INTEGER NOT NULL DEFAULT 0 CHECK (active_document_count >= 0),
  disposed_document_count INTEGER NOT NULL DEFAULT 0 CHECK (disposed_document_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO document_capacity_state (
  id, current_document_count, active_document_count, disposed_document_count
)
SELECT
  1,
  COALESCE(SUM(CASE WHEN sync_state = 'current' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN sync_state = 'current' AND status = 'active' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN sync_state = 'current' AND status = 'disposed' THEN 1 ELSE 0 END), 0)
FROM documents;

DROP TRIGGER IF EXISTS trg_document_capacity_insert;
DROP TRIGGER IF EXISTS trg_document_capacity_reinclude;

CREATE TRIGGER trg_document_capacity_insert
BEFORE INSERT ON documents
WHEN COALESCE(NEW.sync_state, 'current') = 'current'
  AND (SELECT current_document_count FROM document_capacity_state WHERE id = 1) >=
      (SELECT hard_document_count FROM capacity_policy WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_CAPACITY_EXCEEDED');
END;

CREATE TRIGGER trg_document_capacity_reinclude
BEFORE UPDATE OF sync_state ON documents
WHEN OLD.sync_state <> 'current' AND NEW.sync_state = 'current'
  AND (SELECT current_document_count FROM document_capacity_state WHERE id = 1) >=
      (SELECT hard_document_count FROM capacity_policy WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_CAPACITY_EXCEEDED');
END;

CREATE TRIGGER trg_document_capacity_state_insert
AFTER INSERT ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_capacity_state
  SET current_document_count = current_document_count + CASE WHEN NEW.sync_state = 'current' THEN 1 ELSE 0 END,
      active_document_count = active_document_count + CASE WHEN NEW.sync_state = 'current' AND NEW.status = 'active' THEN 1 ELSE 0 END,
      disposed_document_count = disposed_document_count + CASE WHEN NEW.sync_state = 'current' AND NEW.status = 'disposed' THEN 1 ELSE 0 END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_capacity_state_delete
AFTER DELETE ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_capacity_state
  SET current_document_count = current_document_count - CASE WHEN OLD.sync_state = 'current' THEN 1 ELSE 0 END,
      active_document_count = active_document_count - CASE WHEN OLD.sync_state = 'current' AND OLD.status = 'active' THEN 1 ELSE 0 END,
      disposed_document_count = disposed_document_count - CASE WHEN OLD.sync_state = 'current' AND OLD.status = 'disposed' THEN 1 ELSE 0 END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_capacity_state_update
AFTER UPDATE OF sync_state, status ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  AND (OLD.sync_state IS NOT NEW.sync_state OR OLD.status IS NOT NEW.status)
BEGIN
  UPDATE document_capacity_state
  SET current_document_count = current_document_count
        - CASE WHEN OLD.sync_state = 'current' THEN 1 ELSE 0 END
        + CASE WHEN NEW.sync_state = 'current' THEN 1 ELSE 0 END,
      active_document_count = active_document_count
        - CASE WHEN OLD.sync_state = 'current' AND OLD.status = 'active' THEN 1 ELSE 0 END
        + CASE WHEN NEW.sync_state = 'current' AND NEW.status = 'active' THEN 1 ELSE 0 END,
      disposed_document_count = disposed_document_count
        - CASE WHEN OLD.sync_state = 'current' AND OLD.status = 'disposed' THEN 1 ELSE 0 END
        + CASE WHEN NEW.sync_state = 'current' AND NEW.status = 'disposed' THEN 1 ELSE 0 END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

-- 분할 bootstrap 중 제외 상태로 먼저 적재해도 매 chunk에서 목록 정렬 index write를
-- 분산할 수 있도록 current 전용 partial index를 sync_state 선두 일반 index로 바꾼다.
DROP INDEX IF EXISTS idx_documents_current_status_updated;
CREATE INDEX idx_documents_current_status_updated
ON documents(sync_state, status, updated_at DESC, id DESC);

DROP INDEX IF EXISTS idx_documents_current_name;
CREATE INDEX idx_documents_current_name
ON documents(sync_state, document_name COLLATE NOCASE, id DESC);

-- staging 행은 PK와 관리ID UNIQUE만 유지하는 WITHOUT ROWID 구조로 압축한다.
-- id는 직전 Worker의 SELECT 호환을 위해 row_number 기반 가상열로 남긴다.
CREATE TABLE document_snapshot_rows_compact (
  id INTEGER GENERATED ALWAYS AS (row_number) VIRTUAL,
  snapshot_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  row_key TEXT NOT NULL,
  source_json TEXT NOT NULL,
  normalized_json TEXT,
  action TEXT NOT NULL DEFAULT 'staged'
    CHECK (action IN ('staged', 'create', 'update', 'unchanged')),
  matched_document_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_row_key TEXT,
  before_json TEXT,
  after_json TEXT,
  changed_fields_json TEXT,
  change_flags_json TEXT,
  expected_row_version INTEGER,
  PRIMARY KEY (snapshot_id, row_number),
  UNIQUE (snapshot_id, row_key),
  FOREIGN KEY (snapshot_id) REFERENCES document_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (matched_document_id) REFERENCES documents(id) ON DELETE SET NULL
) WITHOUT ROWID;

INSERT INTO document_snapshot_rows_compact (
  snapshot_id, row_number, row_key, source_json, normalized_json, action,
  matched_document_id, created_at, source_row_key, before_json, after_json,
  changed_fields_json, change_flags_json, expected_row_version
)
SELECT
  snapshot_id, row_number, row_key, source_json, normalized_json, action,
  matched_document_id, created_at, source_row_key, before_json, after_json,
  changed_fields_json, change_flags_json, expected_row_version
FROM document_snapshot_rows;

DROP TABLE document_snapshot_rows;
ALTER TABLE document_snapshot_rows_compact RENAME TO document_snapshot_rows;

ALTER TABLE document_snapshots ADD COLUMN bootstrap_progress_count INTEGER NOT NULL DEFAULT 0
  CHECK (bootstrap_progress_count >= 0);
ALTER TABLE document_snapshots ADD COLUMN bootstrap_next_run_at TEXT;
ALTER TABLE document_snapshots ADD COLUMN bootstrap_processing_token TEXT;
ALTER TABLE document_snapshots ADD COLUMN bootstrap_apply_actor_json TEXT;
ALTER TABLE document_snapshots ADD COLUMN bootstrap_apply_details_json TEXT;
ALTER TABLE document_snapshots ADD COLUMN bootstrap_apply_role TEXT;
ALTER TABLE document_snapshots ADD COLUMN bootstrap_apply_started_at TEXT;
ALTER TABLE document_snapshots ADD COLUMN bootstrap_last_processed_at TEXT;

CREATE INDEX idx_document_snapshots_bootstrap_due
ON document_snapshots(status, mode, bootstrap_next_run_at, id);

ALTER TABLE document_snapshot_export_pages ADD COLUMN cursor_rack_number INTEGER;
ALTER TABLE document_snapshot_export_pages ADD COLUMN cursor_rack_face TEXT;
ALTER TABLE document_snapshot_export_pages ADD COLUMN cursor_column_number INTEGER;
ALTER TABLE document_snapshot_export_pages ADD COLUMN cursor_shelf_number INTEGER;
ALTER TABLE document_snapshot_export_pages ADD COLUMN cursor_document_number TEXT;
ALTER TABLE document_snapshot_export_pages ADD COLUMN cursor_document_id INTEGER;

-- 여러 날에 걸친 bootstrap 도중 일반 문서·기준정보 변경을 DB에서 차단한다.
-- 새 Worker가 저장한 actor 정보가 있는 작업만 잠그므로 이전 Worker rollback과 양립한다.
CREATE TRIGGER trg_bootstrap_lock_documents_insert BEFORE INSERT ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  AND EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;

CREATE TRIGGER trg_bootstrap_lock_documents_update BEFORE UPDATE ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  AND EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;

CREATE TRIGGER trg_bootstrap_lock_documents_delete BEFORE DELETE ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  AND EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;

CREATE TRIGGER trg_bootstrap_lock_document_tags_insert BEFORE INSERT ON document_tags
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  AND EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;

CREATE TRIGGER trg_bootstrap_lock_document_tags_delete BEFORE DELETE ON document_tags
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  AND EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;

CREATE TRIGGER trg_bootstrap_lock_categories_insert BEFORE INSERT ON categories
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
CREATE TRIGGER trg_bootstrap_lock_categories_update BEFORE UPDATE ON categories
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
CREATE TRIGGER trg_bootstrap_lock_categories_delete BEFORE DELETE ON categories
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;

CREATE TRIGGER trg_bootstrap_lock_tags_insert BEFORE INSERT ON tags
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
CREATE TRIGGER trg_bootstrap_lock_tags_update BEFORE UPDATE ON tags
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
CREATE TRIGGER trg_bootstrap_lock_tags_delete BEFORE DELETE ON tags
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;

CREATE TRIGGER trg_bootstrap_lock_racks_insert BEFORE INSERT ON racks
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
CREATE TRIGGER trg_bootstrap_lock_racks_update BEFORE UPDATE ON racks
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
CREATE TRIGGER trg_bootstrap_lock_racks_delete BEFORE DELETE ON racks
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;

CREATE TRIGGER trg_bootstrap_lock_rack_slots_insert BEFORE INSERT ON rack_slots
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
CREATE TRIGGER trg_bootstrap_lock_rack_slots_update BEFORE UPDATE ON rack_slots
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
CREATE TRIGGER trg_bootstrap_lock_rack_slots_delete BEFORE DELETE ON rack_slots
WHEN EXISTS (SELECT 1 FROM document_snapshots WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS'); END;
