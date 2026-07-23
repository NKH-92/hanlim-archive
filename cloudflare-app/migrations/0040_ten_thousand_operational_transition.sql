-- 최초 10,000건 운영전환을 위한 용량, 대장 membership, 검색 outbox, bootstrap 재개 구조.
-- 0001~0039 이력은 변경하지 않으며 Search D1의 파생 인덱스는 별도 search-migrations에서 관리한다.

CREATE TABLE capacity_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  warning_document_count INTEGER NOT NULL CHECK (warning_document_count >= 1),
  hard_document_count INTEGER NOT NULL CHECK (hard_document_count > warning_document_count),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO capacity_policy (id, warning_document_count, hard_document_count)
VALUES (1, 11000, 12000);

CREATE TABLE bootstrap_runtime_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  suppress_derived_triggers INTEGER NOT NULL DEFAULT 0
    CHECK (suppress_derived_triggers IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO bootstrap_runtime_control (id) VALUES (1);

-- 최초 승인 대장의 원자 반영에서는 문서별 version/outbox write amplification을 억제하고
-- 완료 시 version 1회 증가와 Search 전체 재구축 신호로 대체한다.
DROP TRIGGER trg_document_sync_version_insert;
DROP TRIGGER trg_document_sync_version_update;
DROP TRIGGER trg_document_sync_version_delete;
DROP TRIGGER trg_document_tag_sync_version_insert;
DROP TRIGGER trg_document_tag_sync_version_delete;

CREATE TRIGGER trg_document_sync_version_insert
AFTER INSERT ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_sync_version_update
AFTER UPDATE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_sync_version_delete
AFTER DELETE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_tag_sync_version_insert
AFTER INSERT ON document_tags
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_tag_sync_version_delete
AFTER DELETE ON document_tags
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_capacity_insert
BEFORE INSERT ON documents
WHEN COALESCE(NEW.sync_state, 'current') = 'current'
  AND (SELECT COUNT(*) FROM documents WHERE sync_state = 'current') >=
      (SELECT hard_document_count FROM capacity_policy WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_CAPACITY_EXCEEDED');
END;

CREATE TRIGGER trg_document_capacity_reinclude
BEFORE UPDATE OF sync_state ON documents
WHEN OLD.sync_state <> 'current' AND NEW.sync_state = 'current'
  AND (SELECT COUNT(*) FROM documents WHERE sync_state = 'current') >=
      (SELECT hard_document_count FROM capacity_policy WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_CAPACITY_EXCEEDED');
END;

CREATE TABLE document_snapshot_membership (
  snapshot_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  row_key TEXT NOT NULL,
  base_row_version INTEGER,
  base_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_id, row_number),
  UNIQUE (snapshot_id, row_key),
  FOREIGN KEY (snapshot_id) REFERENCES document_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX idx_document_snapshot_membership_key
ON document_snapshot_membership(snapshot_id, row_key);

ALTER TABLE document_snapshot_export_manifests
ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('building', 'completed', 'invalidated'));

ALTER TABLE document_snapshot_export_manifests
ADD COLUMN page_size INTEGER NOT NULL DEFAULT 250 CHECK (page_size BETWEEN 1 AND 250);

ALTER TABLE document_snapshot_export_manifests
ADD COLUMN finalized_at TEXT;

UPDATE document_snapshot_export_manifests
SET finalized_at = COALESCE(finalized_at, created_at)
WHERE status = 'completed';

CREATE TABLE document_snapshot_export_pages (
  manifest_id TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  row_offset INTEGER NOT NULL CHECK (row_offset >= 0),
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 250),
  page_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (manifest_id, page_number),
  FOREIGN KEY (manifest_id) REFERENCES document_snapshot_export_manifests(manifest_id) ON DELETE CASCADE
);

CREATE TABLE bootstrap_runs (
  run_id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  expected_document_count INTEGER NOT NULL CHECK (expected_document_count BETWEEN 1 AND 12000),
  target_database_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging', 'core_complete', 'search_complete', 'completed', 'failed')),
  rows_written_estimate INTEGER NOT NULL DEFAULT 0 CHECK (rows_written_estimate >= 0),
  created_by_name TEXT NOT NULL,
  approval_reference TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE bootstrap_chunks (
  run_id TEXT NOT NULL,
  chunk_number INTEGER NOT NULL CHECK (chunk_number >= 1),
  first_row_number INTEGER NOT NULL CHECK (first_row_number >= 2),
  last_row_number INTEGER NOT NULL CHECK (last_row_number >= first_row_number),
  source_hash TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  document_count INTEGER NOT NULL CHECK (document_count >= 1),
  rows_written_estimate INTEGER NOT NULL DEFAULT 0 CHECK (rows_written_estimate >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, chunk_number),
  FOREIGN KEY (run_id) REFERENCES bootstrap_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE search_index_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  rebuild_required INTEGER NOT NULL DEFAULT 1 CHECK (rebuild_required IN (0, 1)),
  indexed_document_count INTEGER NOT NULL DEFAULT 0 CHECK (indexed_document_count >= 0),
  last_rebuilt_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO search_index_state (id) VALUES (1);

CREATE TABLE search_index_outbox (
  document_id INTEGER PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version >= 1),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_search_index_outbox_available
ON search_index_outbox(available_at, updated_at, document_id);

CREATE TRIGGER trg_search_outbox_document_insert
AFTER INSERT ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  INSERT INTO search_index_outbox (document_id, operation)
  VALUES (NEW.id, 'upsert')
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_outbox_document_update
AFTER UPDATE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  INSERT INTO search_index_outbox (document_id, operation)
  VALUES (NEW.id, CASE WHEN NEW.sync_state = 'current' THEN 'upsert' ELSE 'delete' END)
  ON CONFLICT(document_id) DO UPDATE SET
    operation = excluded.operation,
    event_version = search_index_outbox.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_outbox_document_delete
AFTER DELETE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  INSERT INTO search_index_outbox (document_id, operation)
  VALUES (OLD.id, 'delete')
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'delete',
    event_version = search_index_outbox.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_outbox_document_tag_insert
AFTER INSERT ON document_tags
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  INSERT INTO search_index_outbox (document_id, operation)
  VALUES (NEW.document_id, 'upsert')
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_outbox_document_tag_delete
AFTER DELETE ON document_tags
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  INSERT INTO search_index_outbox (document_id, operation)
  VALUES (OLD.document_id, 'upsert')
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_rebuild_category_insert
AFTER INSERT ON categories
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_category_update
AFTER UPDATE ON categories
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_category_delete
AFTER DELETE ON categories
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_tag_insert
AFTER INSERT ON tags
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_tag_update
AFTER UPDATE ON tags
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_tag_delete
AFTER DELETE ON tags
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_rack_insert
AFTER INSERT ON racks
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_rack_update
AFTER UPDATE ON racks
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_rack_delete
AFTER DELETE ON racks
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_rack_slot_insert
AFTER INSERT ON rack_slots
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_rack_slot_update
AFTER UPDATE ON rack_slots
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_search_rebuild_rack_slot_delete
AFTER DELETE ON rack_slots
BEGIN
  UPDATE search_index_state
  SET rebuild_required = 1, generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE INDEX idx_documents_number_upper
ON documents(UPPER(document_number), revision_number DESC, id DESC);
