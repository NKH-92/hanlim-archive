-- 엑셀 전체 대장 동기화 무결성: 전용 권한, exclusion 테이블, diff 저장, 기준정보 version bump, current identity 유일성.
-- 과거 migration은 수정하지 않으며 이 파일은 additive만 포함한다.

ALTER TABLE app_users
ADD COLUMN can_apply_document_snapshots INTEGER NOT NULL DEFAULT 0
  CHECK (can_apply_document_snapshots IN (0, 1));

-- release smoke 계정은 전용 반영 권한을 갖지 않는다.
UPDATE app_users
SET can_apply_document_snapshots = 0
WHERE username = 'release.smoke';

ALTER TABLE document_snapshots
ADD COLUMN mode TEXT NOT NULL DEFAULT 'managed'
  CHECK (mode IN ('managed', 'bootstrap'));

ALTER TABLE document_snapshots
ADD COLUMN export_manifest_id TEXT;

ALTER TABLE document_snapshots
ADD COLUMN apply_reason TEXT;

ALTER TABLE document_snapshots
ADD COLUMN approval_reference TEXT;

ALTER TABLE document_snapshots
ADD COLUMN required_permissions_json TEXT;

ALTER TABLE document_snapshots
ADD COLUMN canonical_rows_hash TEXT;

ALTER TABLE document_snapshots
ADD COLUMN metadata_count INTEGER NOT NULL DEFAULT 0 CHECK (metadata_count >= 0);

ALTER TABLE document_snapshots
ADD COLUMN move_count INTEGER NOT NULL DEFAULT 0 CHECK (move_count >= 0);

ALTER TABLE document_snapshots
ADD COLUMN dispose_count INTEGER NOT NULL DEFAULT 0 CHECK (dispose_count >= 0);

ALTER TABLE document_snapshots
ADD COLUMN restore_count INTEGER NOT NULL DEFAULT 0 CHECK (restore_count >= 0);

ALTER TABLE document_snapshots
ADD COLUMN tag_change_count INTEGER NOT NULL DEFAULT 0 CHECK (tag_change_count >= 0);

ALTER TABLE document_snapshots
ADD COLUMN reinclude_count INTEGER NOT NULL DEFAULT 0 CHECK (reinclude_count >= 0);

ALTER TABLE document_snapshot_rows
ADD COLUMN source_row_key TEXT;

ALTER TABLE document_snapshot_rows
ADD COLUMN before_json TEXT;

ALTER TABLE document_snapshot_rows
ADD COLUMN after_json TEXT;

ALTER TABLE document_snapshot_rows
ADD COLUMN changed_fields_json TEXT;

ALTER TABLE document_snapshot_rows
ADD COLUMN change_flags_json TEXT;

ALTER TABLE document_snapshot_rows
ADD COLUMN expected_row_version INTEGER;

CREATE TABLE document_snapshot_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  excel_row_key TEXT NOT NULL,
  expected_row_version INTEGER NOT NULL,
  before_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id) REFERENCES document_snapshots(id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, document_id)
);

CREATE INDEX idx_document_snapshot_exclusions_snapshot
ON document_snapshot_exclusions(snapshot_id, document_id);

-- 현재 대장 identity 유일성. 기존 중복이 있으면 migration replay가 실패하므로 배포 전 데이터 감사가 필요하다.
CREATE UNIQUE INDEX idx_documents_current_identity
ON documents (
  UPPER(document_number),
  UPPER(revision_number)
)
WHERE sync_state = 'current';

-- 기준정보·태그 변경도 엑셀 버전을 올려 stale 파일을 차단한다.
CREATE TRIGGER trg_category_sync_version_insert
AFTER INSERT ON categories
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_category_sync_version_update
AFTER UPDATE ON categories
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_category_sync_version_delete
AFTER DELETE ON categories
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_tag_sync_version_insert
AFTER INSERT ON tags
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_tag_sync_version_update
AFTER UPDATE ON tags
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_tag_sync_version_delete
AFTER DELETE ON tags
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_rack_sync_version_insert
AFTER INSERT ON racks
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_rack_sync_version_update
AFTER UPDATE ON racks
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_rack_sync_version_delete
AFTER DELETE ON racks
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_rack_slot_sync_version_insert
AFTER INSERT ON rack_slots
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_rack_slot_sync_version_update
AFTER UPDATE ON rack_slots
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_rack_slot_sync_version_delete
AFTER DELETE ON rack_slots
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_tag_sync_version_insert
AFTER INSERT ON document_tags
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;

CREATE TRIGGER trg_document_tag_sync_version_delete
AFTER DELETE ON document_tags
BEGIN
  UPDATE document_sync_state
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
END;
