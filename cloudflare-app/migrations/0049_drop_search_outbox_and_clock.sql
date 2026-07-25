-- R6 정리: 크로스 DB 보상 계층의 마지막 잔재인 검색 outbox와 전역 event clock을 제거한다.
--
-- 두 테이블은 Core와 Search가 서로 다른 D1이어서 한 트랜잭션으로 묶을 수 없던 시절의 장치다.
-- 검색 projection이 Core 안으로 들어온 뒤로는 projection 쓰기와 dirty 행 삭제가 같은
-- env.DB.batch()에서 끝나므로 outbox·source_version·lease가 필요하지 않다. R5에서 애플리케이션
-- 코드의 참조를 모두 제거했고 이 migration은 스키마에서 지운다.
--
-- rollback 호환성
--   * 현재 배포된 Worker는 search_index_outbox·search_event_clock을 읽지 않는다. trigger만
--     이 두 테이블에 썼으므로 trigger를 함께 제거하면 이전 Worker의 쓰기 경로도 그대로 동작한다.
--   * search_index_state는 남긴다. generation은 검색 cursor 무효화에 계속 쓰이고
--     (data/searchData.js) 엑셀 전체 반영이 같은 카운터를 올려 기존 cursor를 무효화한다.
--     이 테이블을 지우려면 cursor generation을 search_projection_state로 옮기는 expand 단계가
--     먼저 배포되어야 하므로 별도 release로 분리한다.
--
-- trg_search_scope_* 는 재생성한다. 남는 책임은 두 가지뿐이다.
--   1) 색인에 들어가는 reference 이름이 실제로 바뀐 경우에만 cursor generation을 올린다.
--   2) 영향 문서만 search_projection_dirty에 표시한다. 색인 본문은 JS(buildSearchIndexTerms)가
--      만들기 때문에 trigger는 대상 표시까지만 담당한다.

DROP TRIGGER trg_search_outbox_document_insert;
DROP TRIGGER trg_search_outbox_document_update;
DROP TRIGGER trg_search_outbox_document_delete;
DROP TRIGGER trg_search_outbox_document_tag_insert;
DROP TRIGGER trg_search_outbox_document_tag_delete;

DROP TRIGGER trg_search_clock_category_insert;
DROP TRIGGER trg_search_clock_category_update;
DROP TRIGGER trg_search_clock_category_delete;
DROP TRIGGER trg_search_clock_tag_insert;
DROP TRIGGER trg_search_clock_tag_update;
DROP TRIGGER trg_search_clock_tag_delete;
DROP TRIGGER trg_search_clock_rack_insert;
DROP TRIGGER trg_search_clock_rack_update;
DROP TRIGGER trg_search_clock_rack_delete;
DROP TRIGGER trg_search_clock_rack_slot_insert;
DROP TRIGGER trg_search_clock_rack_slot_update;
DROP TRIGGER trg_search_clock_rack_slot_delete;

DROP TRIGGER trg_search_scope_category_update;
DROP TRIGGER trg_search_scope_tag_update;
DROP TRIGGER trg_search_scope_rack_update;
DROP TRIGGER trg_search_scope_rack_slot_update;

DROP TABLE search_index_outbox;
DROP TABLE search_event_clock;

CREATE TRIGGER trg_search_scope_category_update
AFTER UPDATE ON categories
BEGIN
  UPDATE search_index_state
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
