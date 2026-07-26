// 검색 read model이 사용하는 문서 조회 SQL shape. documents 내부 구현에 직접 의존하지 않는다.
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

export const DOCUMENT_BASE_JOINS = `FROM documents d
    ${DOCUMENT_JOIN_TABLES}`;

export const DOCUMENT_TAG_JOINS = `LEFT JOIN document_tags dt ON dt.document_id = d.id
    LEFT JOIN tags t ON t.id = dt.tag_id`;

export const DOCUMENT_TAG_CONCAT = `GROUP_CONCAT(t.name, '; ') AS tag_names`;
