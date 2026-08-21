-- 엑셀 schema v4: 특이 문서는 개정번호를 NULL로 저장하고 N/A placeholder identity는 중복을 허용한다.
PRAGMA foreign_keys = OFF;

INSERT INTO categories (name, description, sort_order, is_active)
SELECT 'N/A', '엑셀 일괄등록에서 문서종류가 적용되지 않는 문서', 9999, 1
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE UPPER(name) = 'N/A');

UPDATE categories
SET is_active = 1, updated_at = CURRENT_TIMESTAMP
WHERE UPPER(name) = 'N/A';

CREATE TABLE documents_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_code TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL,
  document_number TEXT NOT NULL,
  revision_number TEXT,
  document_name TEXT NOT NULL,
  note TEXT,
  rack_slot_id INTEGER NOT NULL,
  rack_face TEXT NOT NULL CHECK (rack_face IN ('A', 'B')) DEFAULT 'A',
  status TEXT NOT NULL CHECK (status IN ('active', 'disposed')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revision_date TEXT CHECK (revision_date IS NULL OR revision_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  disposal_due_year INTEGER CHECK (disposal_due_year IS NULL OR disposal_due_year BETWEEN 1900 AND 9999),
  row_version INTEGER NOT NULL DEFAULT 1,
  excel_row_key TEXT,
  sync_state TEXT NOT NULL DEFAULT 'current' CHECK (sync_state IN ('current', 'excluded')),
  last_snapshot_id INTEGER,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (rack_slot_id) REFERENCES rack_slots(id)
);

INSERT INTO documents_new (
  id, storage_code, category_id, document_number, revision_number, document_name, note,
  rack_slot_id, rack_face, status, created_at, updated_at, revision_date,
  disposal_due_year, row_version, excel_row_key, sync_state, last_snapshot_id
)
SELECT
  id, storage_code, category_id, document_number, revision_number, document_name, note,
  rack_slot_id, rack_face, status, created_at, updated_at, revision_date,
  disposal_due_year, row_version, excel_row_key, sync_state, last_snapshot_id
FROM documents;

DROP TRIGGER trg_search_scope_category_update;
DROP TRIGGER trg_search_scope_rack_update;
DROP TRIGGER trg_search_scope_rack_slot_update;
DROP TRIGGER trg_search_scope_tag_update;
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;

CREATE UNIQUE INDEX idx_documents_current_identity
ON documents(UPPER(document_number), UPPER(revision_number))
WHERE sync_state = 'current' AND UPPER(document_number) <> 'N/A' AND revision_number IS NOT NULL;
CREATE INDEX idx_documents_current_name ON documents(sync_state, document_name COLLATE NOCASE, id DESC);
CREATE INDEX idx_documents_current_status_updated ON documents(sync_state, status, updated_at DESC, id DESC);
CREATE UNIQUE INDEX idx_documents_excel_row_key ON documents(excel_row_key) WHERE excel_row_key IS NOT NULL;
CREATE INDEX idx_documents_location_current_state ON documents(rack_slot_id, sync_state, rack_face, status);

CREATE TRIGGER trg_search_scope_category_update AFTER UPDATE ON categories
BEGIN
  UPDATE search_index_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND NEW.name IS NOT OLD.name;
  UPDATE search_projection_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND NEW.name IS NOT OLD.name;
  INSERT INTO search_projection_dirty (document_id, reason)
  SELECT d.id, 'reference' FROM documents d
  WHERE d.category_id = NEW.id AND d.sync_state = 'current' AND NEW.name IS NOT OLD.name
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET reason = 'reference', event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0, available_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_scope_rack_update AFTER UPDATE ON racks
BEGIN
  UPDATE search_index_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1
    AND (NEW.code IS NOT OLD.code OR NEW.zone_number IS NOT OLD.zone_number OR NEW.rack_number IS NOT OLD.rack_number OR NEW.is_single_sided IS NOT OLD.is_single_sided);
  UPDATE search_projection_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1
    AND (NEW.code IS NOT OLD.code OR NEW.zone_number IS NOT OLD.zone_number OR NEW.rack_number IS NOT OLD.rack_number OR NEW.is_single_sided IS NOT OLD.is_single_sided);
  INSERT INTO search_projection_dirty (document_id, reason)
  SELECT d.id, 'reference' FROM documents d JOIN rack_slots rs ON rs.id = d.rack_slot_id
  WHERE rs.rack_id = NEW.id AND d.sync_state = 'current'
    AND (NEW.code IS NOT OLD.code OR NEW.zone_number IS NOT OLD.zone_number OR NEW.rack_number IS NOT OLD.rack_number OR NEW.is_single_sided IS NOT OLD.is_single_sided)
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET reason = 'reference', event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0, available_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_scope_rack_slot_update AFTER UPDATE ON rack_slots
BEGIN
  UPDATE search_index_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1
    AND (NEW.rack_id IS NOT OLD.rack_id OR NEW.slot_code IS NOT OLD.slot_code OR NEW.column_number IS NOT OLD.column_number OR NEW.shelf_number IS NOT OLD.shelf_number);
  UPDATE search_projection_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1
    AND (NEW.rack_id IS NOT OLD.rack_id OR NEW.slot_code IS NOT OLD.slot_code OR NEW.column_number IS NOT OLD.column_number OR NEW.shelf_number IS NOT OLD.shelf_number);
  INSERT INTO search_projection_dirty (document_id, reason)
  SELECT d.id, 'reference' FROM documents d
  WHERE d.rack_slot_id = NEW.id AND d.sync_state = 'current'
    AND (NEW.rack_id IS NOT OLD.rack_id OR NEW.slot_code IS NOT OLD.slot_code OR NEW.column_number IS NOT OLD.column_number OR NEW.shelf_number IS NOT OLD.shelf_number)
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET reason = 'reference', event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0, available_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_scope_tag_update AFTER UPDATE ON tags
BEGIN
  UPDATE search_index_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND NEW.name IS NOT OLD.name;
  UPDATE search_projection_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND NEW.name IS NOT OLD.name;
  INSERT INTO search_projection_dirty (document_id, reason)
  SELECT d.id, 'reference' FROM documents d JOIN document_tags dt ON dt.document_id = d.id
  WHERE dt.tag_id = NEW.id AND d.sync_state = 'current' AND NEW.name IS NOT OLD.name
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET reason = 'reference', event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0, available_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_document_excel_row_key
AFTER INSERT ON documents WHEN NEW.excel_row_key IS NULL
BEGIN
  UPDATE documents SET excel_row_key = 'HLM-' || printf('%012d', NEW.id) WHERE id = NEW.id;
END;

CREATE TRIGGER trg_document_sync_version_insert AFTER INSERT ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN UPDATE document_sync_state SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1; END;
CREATE TRIGGER trg_document_sync_version_update AFTER UPDATE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN UPDATE document_sync_state SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1; END;
CREATE TRIGGER trg_document_sync_version_delete AFTER DELETE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN UPDATE document_sync_state SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1; END;

CREATE TRIGGER trg_revision_previous_no_restore BEFORE UPDATE OF status ON documents
WHEN OLD.status = 'disposed' AND NEW.status = 'active'
  AND EXISTS (SELECT 1 FROM document_revision_links link WHERE link.previous_document_id = OLD.id)
BEGIN SELECT RAISE(ABORT, '개정으로 대체된 이전본은 복원할 수 없습니다.'); END;
CREATE TRIGGER trg_revision_linked_identity_no_update BEFORE UPDATE OF document_number, revision_number ON documents
WHEN EXISTS (SELECT 1 FROM document_revision_links link WHERE link.previous_document_id = OLD.id OR link.new_document_id = OLD.id)
  AND (UPPER(NEW.document_number) IS NOT UPPER(OLD.document_number) OR UPPER(NEW.revision_number) IS NOT UPPER(OLD.revision_number))
BEGIN SELECT RAISE(ABORT, '개정 이력에 연결된 문서 identity는 변경할 수 없습니다.'); END;
CREATE TRIGGER trg_revision_linked_document_no_delete BEFORE DELETE ON documents
WHEN EXISTS (SELECT 1 FROM document_revision_links link WHERE link.previous_document_id = OLD.id OR link.new_document_id = OLD.id)
BEGIN SELECT RAISE(ABORT, '개정 이력에 연결된 문서는 삭제할 수 없습니다.'); END;

CREATE TRIGGER trg_document_capacity_insert BEFORE INSERT ON documents
WHEN COALESCE(NEW.sync_state, 'current') = 'current'
  AND (SELECT current_document_count FROM document_capacity_state WHERE id = 1) >= (SELECT hard_document_count FROM capacity_policy WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'DOCUMENT_CAPACITY_EXCEEDED'); END;
CREATE TRIGGER trg_document_capacity_reinclude BEFORE UPDATE OF sync_state ON documents
WHEN OLD.sync_state <> 'current' AND NEW.sync_state = 'current'
  AND (SELECT current_document_count FROM document_capacity_state WHERE id = 1) >= (SELECT hard_document_count FROM capacity_policy WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'DOCUMENT_CAPACITY_EXCEEDED'); END;
CREATE TRIGGER trg_document_capacity_state_insert AFTER INSERT ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_capacity_state SET
    current_document_count = current_document_count + CASE WHEN NEW.sync_state = 'current' THEN 1 ELSE 0 END,
    active_document_count = active_document_count + CASE WHEN NEW.sync_state = 'current' AND NEW.status = 'active' THEN 1 ELSE 0 END,
    disposed_document_count = disposed_document_count + CASE WHEN NEW.sync_state = 'current' AND NEW.status = 'disposed' THEN 1 ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_document_capacity_state_delete AFTER DELETE ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_capacity_state SET
    current_document_count = current_document_count - CASE WHEN OLD.sync_state = 'current' THEN 1 ELSE 0 END,
    active_document_count = active_document_count - CASE WHEN OLD.sync_state = 'current' AND OLD.status = 'active' THEN 1 ELSE 0 END,
    disposed_document_count = disposed_document_count - CASE WHEN OLD.sync_state = 'current' AND OLD.status = 'disposed' THEN 1 ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_document_capacity_state_update AFTER UPDATE OF sync_state, status ON documents
WHEN (SELECT suppress_capacity_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  AND (OLD.sync_state IS NOT NEW.sync_state OR OLD.status IS NOT NEW.status)
BEGIN
  UPDATE document_capacity_state SET
    current_document_count = current_document_count - CASE WHEN OLD.sync_state = 'current' THEN 1 ELSE 0 END + CASE WHEN NEW.sync_state = 'current' THEN 1 ELSE 0 END,
    active_document_count = active_document_count - CASE WHEN OLD.sync_state = 'current' AND OLD.status = 'active' THEN 1 ELSE 0 END + CASE WHEN NEW.sync_state = 'current' AND NEW.status = 'active' THEN 1 ELSE 0 END,
    disposed_document_count = disposed_document_count - CASE WHEN OLD.sync_state = 'current' AND OLD.status = 'disposed' THEN 1 ELSE 0 END + CASE WHEN NEW.sync_state = 'current' AND NEW.status = 'disposed' THEN 1 ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;

CREATE TRIGGER trg_search_projection_document_insert AFTER INSERT ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_index_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  UPDATE search_projection_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  INSERT INTO search_projection_dirty (document_id, reason) VALUES (NEW.id, 'document')
  ON CONFLICT(document_id) DO UPDATE SET reason = 'document', event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0, available_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP;
END;
CREATE TRIGGER trg_search_projection_document_update AFTER UPDATE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_index_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  UPDATE search_projection_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  INSERT INTO search_projection_dirty (document_id, reason) VALUES (NEW.id, 'document')
  ON CONFLICT(document_id) DO UPDATE SET reason = 'document', event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0, available_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP;
END;
CREATE TRIGGER trg_search_projection_document_delete AFTER DELETE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_index_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  UPDATE search_projection_state SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
  INSERT INTO search_projection_dirty (document_id, reason) VALUES (OLD.id, 'document')
  ON CONFLICT(document_id) DO UPDATE SET reason = 'document', event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0, available_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP;
END;

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

PRAGMA foreign_keys = ON;
