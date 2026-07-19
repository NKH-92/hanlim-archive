export function createDocumentCommandService(repository) {
  return Object.freeze({
    createDocument: repository.createDocument,
    updateDocument: repository.updateDocument,
    moveDocument: repository.moveDocument,
    disposeDocument: repository.disposeDocument,
    disposeDocumentsBulk: repository.disposeDocumentsBulk,
    restoreDocument: repository.restoreDocument,
    permanentlyDeleteDocument: repository.permanentlyDeleteDocument
  });
}
