export const EXCEL_SNAPSHOT_SCHEMA_VERSION = 4;

export const EXCEL_SNAPSHOT_HEADERS = Object.freeze([
  "문서번호",
  "개정번호",
  "제/개정일",
  "폐기 예정 년도",
  "문서명",
  "문서종류",
  "랙 위치 (구역)",
  "랙 위치 (번호)",
  "랙 위치 (열)",
  "랙 위치 (선반)",
  "랙 위치 (단면)",
  "태그",
  "비고",
  "상태"
]);

// 검증 오류·변경 필드의 내부 키를 사용자가 엑셀에서 찾을 수 있는 열 이름으로 보여 준다.
// 내부 키와 오류 코드는 오류 CSV에만 남긴다.
export const EXCEL_SNAPSHOT_FIELD_LABELS = Object.freeze({
  documentNumber: "문서번호",
  revisionNumber: "개정번호",
  revisionDate: "제/개정일",
  disposalDueYear: "폐기 예정 년도",
  documentName: "문서명",
  categoryId: "문서종류",
  categoryName: "문서종류",
  zoneNumber: "랙 위치 (구역)",
  rackNumber: "랙 위치 (번호)",
  rackColumn: "랙 위치 (열)",
  shelfNumber: "랙 위치 (선반)",
  rackFace: "랙 위치 (단면)",
  rackSlotId: "랙 위치",
  location: "랙 위치",
  tagIds: "태그",
  tags: "태그",
  note: "비고",
  status: "상태",
  syncState: "대장 포함",
  sourceRowKey: "숨김 관리 ID",
  identity: "문서번호·개정번호",
  match: "행 대조",
  text: "셀 내용",
  record: "행 전체"
});
