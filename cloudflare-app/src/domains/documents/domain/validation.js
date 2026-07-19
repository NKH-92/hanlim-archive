import { clean } from "../../../shared/text/normalize.js";

export const DOCUMENT_FIELD_LIMITS = Object.freeze({ documentNumber: 100, revisionNumber: 50, documentName: 300, note: 2000 });

export function validateDocumentTextFields(values = {}) {
  const documentNumber = clean(values.documentNumber);
  const revisionNumber = clean(values.revisionNumber);
  const documentName = clean(values.documentName);
  const note = clean(values.note);
  if (!documentNumber || !revisionNumber || !documentName) return "문서번호, 개정번호, 문서명은 필수입니다.";
  if (documentNumber.length > DOCUMENT_FIELD_LIMITS.documentNumber) return `문서번호는 ${DOCUMENT_FIELD_LIMITS.documentNumber}자 이하로 입력하세요.`;
  if (revisionNumber.length > DOCUMENT_FIELD_LIMITS.revisionNumber) return `개정번호는 ${DOCUMENT_FIELD_LIMITS.revisionNumber}자 이하로 입력하세요.`;
  if (documentName.length > DOCUMENT_FIELD_LIMITS.documentName) return `문서명은 ${DOCUMENT_FIELD_LIMITS.documentName}자 이하로 입력하세요.`;
  if (note.length > DOCUMENT_FIELD_LIMITS.note) return `비고는 ${DOCUMENT_FIELD_LIMITS.note}자 이하로 입력하세요.`;
  return "";
}

export function collectDocumentFieldErrors(values = {}) {
  const errors = {};
  const documentNumber = clean(values.documentNumber);
  const revisionNumber = clean(values.revisionNumber);
  const documentName = clean(values.documentName);
  const note = clean(values.note);
  const revisionDate = clean(values.revisionDate);
  const disposalDueYearText = clean(values.disposalDueYear);
  if (!documentNumber) errors.documentNumber = "문서번호를 입력하세요.";
  else if (documentNumber.length > DOCUMENT_FIELD_LIMITS.documentNumber) errors.documentNumber = `문서번호는 ${DOCUMENT_FIELD_LIMITS.documentNumber}자 이하로 입력하세요.`;
  if (!revisionNumber) errors.revisionNumber = "개정번호를 입력하세요.";
  else if (revisionNumber.length > DOCUMENT_FIELD_LIMITS.revisionNumber) errors.revisionNumber = `개정번호는 ${DOCUMENT_FIELD_LIMITS.revisionNumber}자 이하로 입력하세요.`;
  if (!documentName) errors.documentName = "문서명을 입력하세요.";
  else if (documentName.length > DOCUMENT_FIELD_LIMITS.documentName) errors.documentName = `문서명은 ${DOCUMENT_FIELD_LIMITS.documentName}자 이하로 입력하세요.`;
  if (!revisionDate) errors.revisionDate = "제/개정일을 입력하세요.";
  else if (!isValidIsoDate(revisionDate)) errors.revisionDate = "제/개정일은 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.";
  if (!disposalDueYearText) errors.disposalDueYear = "폐기 예정 년도를 입력하세요.";
  else if (!validYear(disposalDueYearText)) errors.disposalDueYear = "폐기 예정 년도는 1900년부터 9999년 사이의 정수여야 합니다.";
  if (note.length > DOCUMENT_FIELD_LIMITS.note) errors.note = `비고는 ${DOCUMENT_FIELD_LIMITS.note}자 이하로 입력하세요.`;
  if (!positiveInteger(values.categoryId)) errors.categoryId = "대분류를 선택하세요.";
  if (!positiveInteger(values.rackSlotId)) errors.rackSlotId = "보관 위치를 선택하세요.";
  if (!["A", "B"].includes(values.rackFace)) errors.rackFace = "보관 면은 1면 또는 2면만 선택할 수 있습니다.";
  return errors;
}

export function validateDocumentRecordFields(values = {}, { required = false } = {}) {
  const revisionDate = clean(values.revisionDate);
  const disposalDueYearText = clean(values.disposalDueYear);
  if (required && (!revisionDate || !disposalDueYearText)) return "제/개정일과 폐기 예정 년도는 필수입니다.";
  if (revisionDate && !isValidIsoDate(revisionDate)) return "제/개정일은 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.";
  if (disposalDueYearText && !validYear(disposalDueYearText)) return "폐기 예정 년도는 1900년부터 9999년 사이의 정수여야 합니다.";
  return "";
}

function positiveInteger(value) { const number = Number(value); return Number.isInteger(number) && number > 0; }
function validYear(value) { const year = Number(value); return Number.isInteger(year) && year >= 1900 && year <= 9999; }
function isValidIsoDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
