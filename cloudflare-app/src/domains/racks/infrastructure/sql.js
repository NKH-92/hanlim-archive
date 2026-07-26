// 랙 상세에서 사용하는 위치 중심 문서 SQL shape.
export const DOCUMENT_LOCATION_COLUMNS = `c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided,`;

const DOCUMENT_JOIN_TABLES = `JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id`;

export const DOCUMENT_BASE_JOINS = `FROM documents d
    ${DOCUMENT_JOIN_TABLES}`;
