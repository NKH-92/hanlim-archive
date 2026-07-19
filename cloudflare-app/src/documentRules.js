// deprecated compatibility façade: 순수 입력 규칙은 documents domain이 소유한다.
export {
  DOCUMENT_FIELD_LIMITS,
  collectDocumentFieldErrors,
  validateDocumentRecordFields,
  validateDocumentTextFields
} from "./domains/documents/domain/validation.js";
