// 세트 상세 read model에 필요한 문서 SQL shape만 이 도메인이 소유한다.
export const DOCUMENT_CORE_COLUMNS = `d.storage_code,
      d.document_number,
      d.revision_number,
      d.revision_date,
      d.disposal_due_year,
      d.document_name,
      d.note,
      d.rack_face,
      d.status,
      d.sync_state,
      d.last_snapshot_id,`;

export const DOCUMENT_LOCATION_COLUMNS = `c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided,`;

export const DOCUMENT_JOIN_TABLES = `JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id`;
