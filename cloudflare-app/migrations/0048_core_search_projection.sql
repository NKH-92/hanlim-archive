-- Core D1 안에 검색 projection과 FTS5 인덱스를 additive로 추가한다.
-- 목적: Core/Search 물리 분리를 없애고 크로스 DB 보상 계층(lease, watermark, tombstone,
-- shadow generation, cutover, rollback)을 제거하는 것이다. 이 migration은 읽기 경로를 바꾸지 않고
-- 스키마와 dirty 큐만 준비한다. 적용 직후 projection은 비어 있고
-- reindex_status = 'pending'이므로 재색인이 끝날 때까지 검색은 Core 퍼지 폴백으로 열화된다.
-- 이전 Worker는 이 테이블을 읽지 않으므로 rollback 호환이다.
--
-- 설계 요약
--   * projection과 dirty 큐가 같은 DB에 있으므로 "projection 최신 OR 문서가 dirty"가 트랜잭션으로 보장된다.
--     따라서 outbox lease, processor lease, source watermark, 삭제 tombstone이 필요하지 않다.
--   * physical shadow generation을 두지 않는다. 재색인은 in-place upsert로 진행하므로 재색인 중에도
--     검색이 비지 않고, 문서당 쓰기 행이 세대 사본만큼 늘지 않는다.
--   * cursor 무효화는 기존 search_index_state.generation 단일 카운터를 계속 사용한다.
--   * normalized_text는 JS(buildSearchIndexTerms)가 n-gram과 한글 초성을 만들어 넣는다.
--     SQL trigger로 재현할 수 없으므로 trigger는 "재색인 대상 표시"만 담당한다.

CREATE TABLE search_projection_documents (
  document_id INTEGER PRIMARY KEY,
  document_number TEXT NOT NULL DEFAULT '',
  revision_number TEXT NOT NULL DEFAULT '',
  document_name TEXT NOT NULL DEFAULT '',
  category_id INTEGER NOT NULL DEFAULT 0,
  category_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  rack_id INTEGER NOT NULL DEFAULT 0,
  rack_code TEXT NOT NULL DEFAULT '',
  zone_number INTEGER NOT NULL DEFAULT 0,
  rack_face TEXT NOT NULL DEFAULT '',
  column_number INTEGER NOT NULL DEFAULT 0,
  shelf_number INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  tag_names TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL DEFAULT '',
  document_updated_at TEXT NOT NULL DEFAULT '',
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_search_projection_category
ON search_projection_documents(category_id, status, document_id);

CREATE INDEX idx_search_projection_location
ON search_projection_documents(zone_number, rack_id, rack_face, column_number, shelf_number, document_id);

CREATE INDEX idx_search_projection_updated
ON search_projection_documents(document_updated_at DESC, document_id DESC);

CREATE INDEX idx_search_projection_number
ON search_projection_documents(document_number, revision_number, document_id);

-- external content FTS5: rowid가 곧 document_id이므로 색인 갱신·삭제가 전체 스캔 없이 rowid로 끝난다.
-- (legacy Search D1의 standalone FTS는 document_id UNINDEXED 컬럼을 비교해 문서 1건 갱신마다
--  전체 색인을 스캔했다. 같은 DB로 합치면서 rows read 비용을 함께 줄인다.)
CREATE VIRTUAL TABLE search_projection_fts USING fts5(
  normalized_text,
  content = 'search_projection_documents',
  content_rowid = 'document_id',
  tokenize = 'unicode61 remove_diacritics 2'
);

-- 재색인 대상 큐. 같은 DB이므로 lease 없이 (document_id, event_version) CAS만으로 안전하다.
CREATE TABLE search_projection_dirty (
  document_id INTEGER PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'document'
    CHECK (reason IN ('document', 'tag', 'reference', 'reindex', 'manual')),
  event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version >= 1),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_search_projection_dirty_available
ON search_projection_dirty(available_at, updated_at, document_id);

CREATE TABLE search_projection_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  indexed_document_count INTEGER NOT NULL DEFAULT 0 CHECK (indexed_document_count >= 0),
  reindex_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (reindex_status IN ('pending', 'building', 'ready')),
  reindex_cursor INTEGER NOT NULL DEFAULT 0 CHECK (reindex_cursor >= 0),
  last_reindexed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO search_projection_state (id) VALUES (1);

CREATE TRIGGER trg_search_projection_document_insert
AFTER INSERT ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
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

-- 0047의 범위 제한 trigger를 projection dirty 큐까지 채우도록 교체한다.
DROP TRIGGER trg_search_scope_category_update;
DROP TRIGGER trg_search_scope_tag_update;
DROP TRIGGER trg_search_scope_rack_update;
DROP TRIGGER trg_search_scope_rack_slot_update;

CREATE TRIGGER trg_search_scope_category_update
AFTER UPDATE ON categories
BEGIN
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1 AND NEW.name IS NOT OLD.name;

  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1 AND NEW.name IS NOT OLD.name;

  INSERT INTO search_index_outbox (document_id, operation, source_version)
  SELECT
    d.id,
    'upsert',
    (SELECT current_version FROM search_event_clock WHERE id = 1)
  FROM documents d
  WHERE d.category_id = NEW.id
    AND d.sync_state = 'current'
    AND NEW.name IS NOT OLD.name
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;

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
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1 AND NEW.name IS NOT OLD.name;

  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1 AND NEW.name IS NOT OLD.name;

  INSERT INTO search_index_outbox (document_id, operation, source_version)
  SELECT
    d.id,
    'upsert',
    (SELECT current_version FROM search_event_clock WHERE id = 1)
  FROM documents d
  JOIN document_tags dt ON dt.document_id = d.id
  WHERE dt.tag_id = NEW.id
    AND d.sync_state = 'current'
    AND NEW.name IS NOT OLD.name
    AND (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;

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
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND (
      NEW.code IS NOT OLD.code
      OR NEW.zone_number IS NOT OLD.zone_number
      OR NEW.rack_number IS NOT OLD.rack_number
      OR NEW.is_single_sided IS NOT OLD.is_single_sided
    );

  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND (
      NEW.code IS NOT OLD.code
      OR NEW.zone_number IS NOT OLD.zone_number
      OR NEW.rack_number IS NOT OLD.rack_number
      OR NEW.is_single_sided IS NOT OLD.is_single_sided
    );

  INSERT INTO search_index_outbox (document_id, operation, source_version)
  SELECT
    d.id,
    'upsert',
    (SELECT current_version FROM search_event_clock WHERE id = 1)
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
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;

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
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND (
      NEW.rack_id IS NOT OLD.rack_id
      OR NEW.slot_code IS NOT OLD.slot_code
      OR NEW.column_number IS NOT OLD.column_number
      OR NEW.shelf_number IS NOT OLD.shelf_number
    );

  UPDATE search_index_state
  SET generation = generation + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1
    AND (
      NEW.rack_id IS NOT OLD.rack_id
      OR NEW.slot_code IS NOT OLD.slot_code
      OR NEW.column_number IS NOT OLD.column_number
      OR NEW.shelf_number IS NOT OLD.shelf_number
    );

  INSERT INTO search_index_outbox (document_id, operation, source_version)
  SELECT
    d.id,
    'upsert',
    (SELECT current_version FROM search_event_clock WHERE id = 1)
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
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;

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
