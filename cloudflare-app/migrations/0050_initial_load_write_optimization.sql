-- 실사용 10,000건 대장 투입 전에 D1 write amplification을 줄이고 검색 cursor 상태를
-- Core projection으로 이관하는 expand migration이다. 과거 migration은 수정하지 않는다.
--
-- 원칙
--   * 현재 업무 검색은 FTS MATCH -> document_id(PK) 조회이므로 projection 보조 index 4개는
--     실행계획에 사용되지 않는다. 제거해 전체 재색인의 rows_written을 줄인다.
--   * documents는 10,000건/동시 10명 규모에 필요한 current 목록·위치 index만 남긴다.
--     identity/excel_row_key/storage_code 유일성 index는 데이터 무결성이므로 유지한다.
--   * 연결 테이블은 중복 index를 제거하고 document_tags/membership은 WITHOUT ROWID로 압축한다.
--   * search_projection_state.generation을 새 cursor 세대로 추가하되, 이전 Worker rollback을 위해
--     search_index_state도 당분간 dual-write한다. search_index_state DROP은 별도 contract release다.

ALTER TABLE search_projection_state
ADD COLUMN generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1);

UPDATE search_projection_state
SET generation = COALESCE((SELECT generation FROM search_index_state WHERE id = 1), 1)
WHERE id = 1;

-- 동일하거나 PK/UNIQUE가 이미 보장하는 중복 index.
DROP INDEX IF EXISTS idx_rack_slots_rack_layout;
DROP INDEX IF EXISTS idx_document_set_items_set;
DROP INDEX IF EXISTS idx_document_snapshot_exclusions_snapshot;

-- documents의 범용/중복 index를 current 대장 실제 조회 패턴에 맞춘 두 partial index로 축소한다.
DROP INDEX IF EXISTS idx_documents_active_disposal_year;
DROP INDEX IF EXISTS idx_documents_category_status;
DROP INDEX IF EXISTS idx_documents_location;
DROP INDEX IF EXISTS idx_documents_number_revision;
DROP INDEX IF EXISTS idx_documents_number_upper;
DROP INDEX IF EXISTS idx_documents_search;
DROP INDEX IF EXISTS idx_documents_status;
DROP INDEX IF EXISTS idx_documents_sync_state;
DROP INDEX IF EXISTS idx_documents_updated;

CREATE INDEX idx_documents_current_status_updated
ON documents(status, updated_at DESC, id DESC)
WHERE sync_state = 'current';

-- 문서명 완전일치 확인은 모든 텍스트 검색에서 먼저 실행되므로 NOCASE equality index를 유지한다.
-- 초기 bootstrap에서 10,000 index write가 추가되지만 일상 검색의 10,000행 full scan을 반복하지 않는 편이
-- 무료 rows_read 예산과 응답 안정성에 유리하다. 위치 secondary index는 최대 12,000건 규모에서 생략한다.
CREATE INDEX idx_documents_current_name
ON documents(document_name COLLATE NOCASE, id DESC)
WHERE sync_state = 'current';

-- FTS가 먼저 후보 rowid를 만들고 projection은 INTEGER PRIMARY KEY로 조회한다.
-- 필터/정렬용 secondary index는 이 경로에서 사용되지 않으므로 재색인 write만 늘린다.
DROP INDEX IF EXISTS idx_search_projection_category;
DROP INDEX IF EXISTS idx_search_projection_location;
DROP INDEX IF EXISTS idx_search_projection_updated;
DROP INDEX IF EXISTS idx_search_projection_number;

-- document_tags의 (document_id, tag_id) PK는 모든 일상 문서 조회를 담당한다.
-- tag_id 역방향 전체 스캔은 기준정보 태그명 변경 때만 발생하므로 10,000건 규모에서는
-- 매 문서 등록 write를 늘리는 역방향 index보다 WITHOUT ROWID 단일 PK가 유리하다.
DROP TRIGGER IF EXISTS trg_document_tag_sync_version_insert;
DROP TRIGGER IF EXISTS trg_document_tag_sync_version_delete;
DROP TRIGGER IF EXISTS trg_search_projection_document_tag_insert;
DROP TRIGGER IF EXISTS trg_search_projection_document_tag_delete;
-- tags 테이블의 trigger지만 본문에서 document_tags를 참조하므로 테이블 교체 전에 함께 내린다.
DROP TRIGGER IF EXISTS trg_search_scope_tag_update;

CREATE TABLE document_tags_compact (
  document_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) WITHOUT ROWID;

INSERT INTO document_tags_compact (document_id, tag_id)
SELECT document_id, tag_id
FROM document_tags;

DROP TABLE document_tags;
ALTER TABLE document_tags_compact RENAME TO document_tags;

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

-- schema v2 membership 역시 PK와 UNIQUE만 필요하다. 별도 (snapshot_id,row_key) index는
-- UNIQUE와 동일했으므로 WITHOUT ROWID로 재작성하면서 자연스럽게 제거한다.
CREATE TABLE document_snapshot_membership_compact (
  snapshot_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  row_key TEXT NOT NULL,
  base_row_version INTEGER,
  base_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_id, row_number),
  UNIQUE (snapshot_id, row_key),
  FOREIGN KEY (snapshot_id) REFERENCES document_snapshots(id) ON DELETE CASCADE
) WITHOUT ROWID;

INSERT INTO document_snapshot_membership_compact (
  snapshot_id, row_number, row_key, base_row_version, base_hash, created_at
)
SELECT snapshot_id, row_number, row_key, base_row_version, base_hash, created_at
FROM document_snapshot_membership;

DROP TABLE document_snapshot_membership;
ALTER TABLE document_snapshot_membership_compact RENAME TO document_snapshot_membership;

-- 문서 자체가 바뀌어도 cursor generation을 올린다. 기존 R6에서는 reference 변경만 generation을
-- 올려 신규/수정 문서가 페이지 사이에 끼어들 때 오래된 cursor가 살아 있을 수 있었다.
DROP TRIGGER IF EXISTS trg_search_projection_document_insert;
DROP TRIGGER IF EXISTS trg_search_projection_document_update;
DROP TRIGGER IF EXISTS trg_search_projection_document_delete;

CREATE TRIGGER trg_search_projection_document_insert
AFTER INSERT ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  INSERT INTO search_projection_dirty (document_id, reason)
  VALUES (NEW.id, 'document')
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'document',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_projection_document_update
AFTER UPDATE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  INSERT INTO search_projection_dirty (document_id, reason)
  VALUES (NEW.id, 'document')
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'document',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_projection_document_delete
AFTER DELETE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  INSERT INTO search_projection_dirty (document_id, reason)
  VALUES (OLD.id, 'document')
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'document',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_projection_document_tag_insert
AFTER INSERT ON document_tags
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  INSERT INTO search_projection_dirty (document_id, reason)
  VALUES (NEW.document_id, 'tag')
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'tag',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_projection_document_tag_delete
AFTER DELETE ON document_tags
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;

  INSERT INTO search_projection_dirty (document_id, reason)
  VALUES (OLD.document_id, 'tag')
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'tag',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

-- 기준정보 변경 trigger도 새 projection generation과 기존 rollback generation을 함께 올린다.
DROP TRIGGER IF EXISTS trg_search_scope_category_update;
DROP TRIGGER IF EXISTS trg_search_scope_tag_update;
DROP TRIGGER IF EXISTS trg_search_scope_rack_update;
DROP TRIGGER IF EXISTS trg_search_scope_rack_slot_update;

CREATE TRIGGER trg_search_scope_category_update
AFTER UPDATE ON categories
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1 AND NEW.name IS NOT OLD.name;

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1 AND NEW.name IS NOT OLD.name;

  INSERT INTO search_projection_dirty (document_id, reason)
  SELECT d.id, 'reference'
  FROM documents d
  WHERE d.category_id = NEW.id
    AND d.sync_state = 'current'
    AND NEW.name IS NOT OLD.name
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'reference',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_scope_tag_update
AFTER UPDATE ON tags
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1 AND NEW.name IS NOT OLD.name;

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1 AND NEW.name IS NOT OLD.name;

  INSERT INTO search_projection_dirty (document_id, reason)
  SELECT d.id, 'reference'
  FROM documents d
  JOIN document_tags dt ON dt.document_id = d.id
  WHERE dt.tag_id = NEW.id
    AND d.sync_state = 'current'
    AND NEW.name IS NOT OLD.name
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'reference',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_scope_rack_update
AFTER UPDATE ON racks
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND (
      NEW.code IS NOT OLD.code
      OR NEW.zone_number IS NOT OLD.zone_number
      OR NEW.rack_number IS NOT OLD.rack_number
      OR NEW.is_single_sided IS NOT OLD.is_single_sided
    );

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND (
      NEW.code IS NOT OLD.code
      OR NEW.zone_number IS NOT OLD.zone_number
      OR NEW.rack_number IS NOT OLD.rack_number
      OR NEW.is_single_sided IS NOT OLD.is_single_sided
    );

  INSERT INTO search_projection_dirty (document_id, reason)
  SELECT d.id, 'reference'
  FROM documents d
  JOIN rack_slots rs ON rs.id = d.rack_slot_id
  WHERE rs.rack_id = NEW.id
    AND d.sync_state = 'current'
    AND (
      NEW.code IS NOT OLD.code
      OR NEW.zone_number IS NOT OLD.zone_number
      OR NEW.rack_number IS NOT OLD.rack_number
      OR NEW.is_single_sided IS NOT OLD.is_single_sided
    )
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'reference',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_scope_rack_slot_update
AFTER UPDATE ON rack_slots
BEGIN
  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND (
      NEW.rack_id IS NOT OLD.rack_id
      OR NEW.slot_code IS NOT OLD.slot_code
      OR NEW.column_number IS NOT OLD.column_number
      OR NEW.shelf_number IS NOT OLD.shelf_number
    );

  UPDATE search_projection_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND (
      NEW.rack_id IS NOT OLD.rack_id
      OR NEW.slot_code IS NOT OLD.slot_code
      OR NEW.column_number IS NOT OLD.column_number
      OR NEW.shelf_number IS NOT OLD.shelf_number
    );

  INSERT INTO search_projection_dirty (document_id, reason)
  SELECT d.id, 'reference'
  FROM documents d
  WHERE d.rack_slot_id = NEW.id
    AND d.sync_state = 'current'
    AND (
      NEW.rack_id IS NOT OLD.rack_id
      OR NEW.slot_code IS NOT OLD.slot_code
      OR NEW.column_number IS NOT OLD.column_number
      OR NEW.shelf_number IS NOT OLD.shelf_number
    )
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET
    reason = 'reference',
    event_version = search_projection_dirty.event_version + 1,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;
