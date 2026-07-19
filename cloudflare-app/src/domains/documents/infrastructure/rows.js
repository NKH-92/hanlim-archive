/**
 * D1에서 반환하는 문서 행의 저장소 표현이다.
 * snake_case는 이 경계 안에서만 사용하고 웹 계층에는 presenter를 거쳐 전달한다.
 *
 * @typedef {object} DocumentRow
 * @property {number} id
 * @property {string} storage_code
 * @property {number} category_id
 * @property {string} document_number
 * @property {string} revision_number
 * @property {string|null} revision_date
 * @property {number|null} disposal_due_year
 * @property {string} document_name
 * @property {string|null} note
 * @property {number|null} rack_slot_id
 * @property {"A"|"B"} rack_face
 * @property {"active"|"disposed"} status
 * @property {string} updated_at
 * @property {number} row_version
 */

export {};
