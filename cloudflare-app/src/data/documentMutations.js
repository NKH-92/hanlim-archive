// deprecated compatibility façade: 구현은 documents infrastructure가 소유한다.
export {
  createDocument,
  updateDocument,
  moveDocument,
  disposeDocument,
  disposeDocumentsBulk,
  restoreDocument,
  permanentlyDeleteDocument
} from "../domains/documents/commands.js";
