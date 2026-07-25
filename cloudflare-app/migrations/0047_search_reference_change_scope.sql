-- Reference-data(대분류·태그·랙·슬롯) 이름 변경이 전체 검색 인덱스 재구축을 유발하지 않게 한다.
-- 기존 trg_search_rebuild_* 는 categories/tags/racks/rack_slots 의 모든 INSERT·UPDATE·DELETE에서
-- search_index_state.rebuild_required = 1 을 세워 문서 1건 무관 변경에도 전체 재색인을 강제했다.
-- 이 migration은 영향 문서만 outbox에 넣는 범위 제한 trigger로 교체한다.
--   * INSERT: 신규 reference 행을 참조하는 문서가 존재할 수 없으므로 파생 작업이 없다.
--   * DELETE: documents FK(RESTRICT)가 참조된 행 삭제를 막고, tags 삭제는 document_tags CASCADE가
--     기존 trg_search_outbox_document_tag_delete 로 영향 문서를 이미 enqueue한다.
--   * UPDATE: 색인에 들어가는 컬럼이 실제로 바뀐 경우에만 generation을 올리고 영향 문서를 enqueue한다.
-- 전체 재구축이 필요한 대량 경로(엑셀 snapshot apply)는 계속 rebuild_required를 직접 세운다.

DROP TRIGGER trg_search_rebuild_category_insert;
DROP TRIGGER trg_search_rebuild_category_update;
DROP TRIGGER trg_search_rebuild_category_delete;
DROP TRIGGER trg_search_rebuild_tag_insert;
DROP TRIGGER trg_search_rebuild_tag_update;
DROP TRIGGER trg_search_rebuild_tag_delete;
DROP TRIGGER trg_search_rebuild_rack_insert;
DROP TRIGGER trg_search_rebuild_rack_update;
DROP TRIGGER trg_search_rebuild_rack_delete;
DROP TRIGGER trg_search_rebuild_rack_slot_insert;
DROP TRIGGER trg_search_rebuild_rack_slot_update;
DROP TRIGGER trg_search_rebuild_rack_slot_delete;

-- 대분류 이름 변경: 해당 대분류의 current 문서만 재색인 대상이다.
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
END;

-- 태그 이름 변경: 해당 태그가 붙은 current 문서만 재색인 대상이다.
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
END;

-- 랙 코드·구역·면 구성 변경: 그 랙에 보관된 current 문서만 재색인 대상이다.
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
END;

-- 슬롯 위치 변경: 그 슬롯에 보관된 current 문서만 재색인 대상이다.
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
END;
