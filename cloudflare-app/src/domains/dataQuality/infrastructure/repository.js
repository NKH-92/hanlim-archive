// 관리자 데이터 품질 작업목록. 집계 숫자와 동일한 조건으로 실제 수정 대상을 페이지 처리한다.

import { DATA_QUALITY_ISSUES, normalizeDataQualityIssue } from "../domain/issues.js";

export async function getDataQualityPage(env, issueValue, page = 1, pageSize = 30) {
  const issue = normalizeDataQualityIssue(issueValue);
  const definition = DATA_QUALITY_ISSUES[issue];
  const parsedPage = Math.floor(Number(page));
  const parsedPageSize = Math.floor(Number(pageSize));
  // Infinity 같은 비유한 값이 LIMIT/OFFSET bind로 전달되면 D1이 요청 자체를 거부한다.
  const safePage = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
  const safePageSize = Number.isFinite(parsedPageSize) ? Math.max(1, Math.min(parsedPageSize, 100)) : 30;
  const joins = `FROM documents d
    LEFT JOIN categories c ON c.id = d.category_id
    LEFT JOIN rack_slots rs ON rs.id = d.rack_slot_id
    LEFT JOIN racks r ON r.id = rs.rack_id`;
  const results = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS count ${joins} WHERE ${definition.condition}`),
    env.DB.prepare(`
      SELECT
        d.id,
        d.document_number,
        d.revision_number,
        d.document_name,
        d.disposal_due_year,
        d.rack_face,
        d.status,
        c.name AS category_name,
        c.is_active AS category_is_active,
        r.code AS rack_code,
        r.zone_number,
        r.rack_number,
        r.is_single_sided,
        r.is_active AS rack_is_active,
        rs.column_number,
        rs.shelf_number,
        rs.is_active AS slot_is_active
      ${joins}
      WHERE ${definition.condition}
      ORDER BY d.document_number, d.revision_number, d.id
      LIMIT ? OFFSET ?
    `).bind(safePageSize, (safePage - 1) * safePageSize)
  ]);
  const totalItems = Number(results[0]?.results?.[0]?.count || 0);
  return {
    issue,
    label: definition.label,
    issues: Object.entries(DATA_QUALITY_ISSUES).map(([key, value]) => ({ key, label: value.label })),
    items: results[1]?.results ?? [],
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / safePageSize))
  };
}
