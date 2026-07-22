export function createDocumentCommandService(repository) {
  return Object.freeze({
    createDocument: repository.createDocument,
    updateDocument: repository.updateDocument,
    reviseDocument: repository.reviseDocument,
    moveDocument: repository.moveDocument,
    disposeDocument: repository.disposeDocument,
    disposeDocumentsBulk: repository.disposeDocumentsBulk,
    restoreDocument: repository.restoreDocument,
    permanentlyDeleteDocument: repository.permanentlyDeleteDocument
  });
}
