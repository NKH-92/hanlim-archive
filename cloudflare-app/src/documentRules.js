import { clean } from "./utils.js";

export const DOCUMENT_FIELD_LIMITS = Object.freeze({
  documentNumber: 100,
  revisionNumber: 50,
  documentName: 300,
  note: 2000
});

export function validateDocumentTextFields(values = {}) {
  const documentNumber = clean(values.documentNumber);
  const revisionNumber = clean(values.revisionNumber);
  const documentName = clean(values.documentName);
  const note = clean(values.note);

  if (!documentNumber || !revisionNumber || !documentName) {
    return "문서번호, 개정번호, 문서명은 필수입니다.";
  }

  if (documentNumber.length > DOCUMENT_FIELD_LIMITS.documentNumber) {
    return `문서번호는 ${DOCUMENT_FIELD_LIMITS.documentNumber}자 이하로 입력하세요.`;
  }
  if (revisionNumber.length > DOCUMENT_FIELD_LIMITS.revisionNumber) {
    return `개정번호는 ${DOCUMENT_FIELD_LIMITS.revisionNumber}자 이하로 입력하세요.`;
  }
  if (documentName.length > DOCUMENT_FIELD_LIMITS.documentName) {
    return `문서명은 ${DOCUMENT_FIELD_LIMITS.documentName}자 이하로 입력하세요.`;
  }
  if (note.length > DOCUMENT_FIELD_LIMITS.note) {
    return `비고는 ${DOCUMENT_FIELD_LIMITS.note}자 이하로 입력하세요.`;
  }

  return "";
}

export function validateDocumentRecordFields(values = {}, { required = false } = {}) {
  const revisionDate = clean(values.revisionDate);
  const disposalDueYearText = clean(values.disposalDueYear);

  if (required && (!revisionDate || !disposalDueYearText)) {
    return "제/개정일과 폐기 예정 년도는 필수입니다.";
  }

  if (revisionDate && !isValidIsoDate(revisionDate)) {
    return "제/개정일은 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.";
  }

  if (disposalDueYearText) {
    const year = Number(disposalDueYearText);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      return "폐기 예정 년도는 1900년부터 9999년 사이의 정수여야 합니다.";
    }
  }

  return "";
}

function isValidIsoDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}
