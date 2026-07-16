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
