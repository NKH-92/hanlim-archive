import { clean } from "../shared/text/normalize.js";

// 데이터 모듈들이 반복하던 공용 SQL 조각과 소형 헬퍼.
// D1로 보내는 SQL 텍스트가 기존과 바이트 단위로 동일해야 하므로
// 조각의 개행·들여쓰기를 원본 그대로 보존한다.

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

export const AUDIT_LOG_INSERT = `INSERT INTO document_audit_logs (
      document_id,
      storage_code,
      document_number,
      action,
      actor,
      actor_role,
      summary,
      details
    )`;

// 0021 이후 신규 변경 경로는 표시 이름뿐 아니라 안정적인 사용자 식별자도 함께 기록한다.
// 기존 호출부는 AUDIT_LOG_INSERT를 유지해 배치 문장 순서·바인딩 계약을 깨지 않는다.
export const AUDIT_LOG_INSERT_WITH_ACTOR = `INSERT INTO document_audit_logs (
      document_id,
      storage_code,
      document_number,
      action,
      actor,
      actor_role,
      actor_user_id,
      actor_username,
      summary,
      details
    )`;

export function hasChanged(result) {
  return Number(result?.meta?.changes ?? 0) > 0;
}

// 낙관적 잠금 절: 사용자가 화면을 연 시점의 updated_at/row_version과 현재가 다르면
// 가드에 걸려 no-op이 된다. 토큰 필수 여부는 이 헬퍼를 호출하는 도메인 함수가 결정한다.
export function optimisticLockClause(expectedUpdatedAt, expectedRowVersion) {
  const expected = clean(expectedUpdatedAt);
  const version = Number(expectedRowVersion);
  if (!expected && !(Number.isInteger(version) && version > 0)) {
    return { sql: "", binds: [] };
  }
  return {
    sql: `${expected ? " AND updated_at = ?" : ""}${Number.isInteger(version) && version > 0 ? " AND row_version = ?" : ""}`,
    binds: [...(expected ? [expected] : []), ...(Number.isInteger(version) && version > 0 ? [version] : [])]
  };
}

// UNIQUE 제약 위반을 친화 메시지로 변환. label 예: "카테고리", "태그", "세트".
export function uniqueViolationMessage(error, label) {
  return error.message.includes("UNIQUE") ? `같은 이름의 ${label}가 이미 있습니다.` : error.message;
}
