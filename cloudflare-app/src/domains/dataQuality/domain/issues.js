import { clean } from "../../../shared/text/normalize.js";

export const DATA_QUALITY_ISSUES = Object.freeze({
  "duplicate-number": Object.freeze({ label: "중복 문서번호·개정", condition: `d.id IN (
    SELECT duplicate_member.id
    FROM documents duplicate_member
    JOIN (
      SELECT UPPER(document_number) AS document_number_key, UPPER(revision_number) AS revision_number_key
      FROM documents
      WHERE sync_state = 'current'
      GROUP BY UPPER(document_number), UPPER(revision_number)
      HAVING COUNT(*) > 1
    ) duplicate_keys
      ON duplicate_keys.document_number_key = UPPER(duplicate_member.document_number)
      AND duplicate_keys.revision_number_key = UPPER(duplicate_member.revision_number)
    WHERE duplicate_member.sync_state = 'current'
  )` }),
  "missing-location": Object.freeze({ label: "누락·비활성 위치", condition: "rs.id IS NULL OR r.id IS NULL OR rs.is_active = 0 OR r.is_active = 0" }),
  "inactive-category": Object.freeze({ label: "누락·비활성 대분류", condition: "c.id IS NULL OR c.is_active = 0" }),
  "invalid-face": Object.freeze({ label: "단면 랙 2면 문서", condition: "r.is_single_sided = 1 AND d.rack_face = 'B'" }),
  "suspicious-text": Object.freeze({ label: "문자 깨짐 의심", condition: `d.document_name LIKE '%�%'
    OR d.document_name LIKE '%Ã%'
    OR d.document_name LIKE '%Â%'
    OR d.note LIKE '%�%'
    OR d.note LIKE '%Ã%'
    OR d.note LIKE '%Â%'` }),
  "missing-disposal-year": Object.freeze({ label: "폐기 예정 연도 누락", condition: "d.disposal_due_year IS NULL" })
});

export function normalizeDataQualityIssue(value) {
  const issue = clean(value);
  return Object.hasOwn(DATA_QUALITY_ISSUES, issue) ? issue : "duplicate-number";
}
