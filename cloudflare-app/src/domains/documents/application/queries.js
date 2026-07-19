export function createDocumentQueries(repository) {
  return Object.freeze({
    getDocumentPage: repository.getDocumentPage,
    getDocumentCount: repository.getDocumentCount,
    getDocumentsForExport: repository.getDocumentsForExport,
    getDocument: repository.getDocument,
    findDuplicateDocument: repository.findDuplicateDocument,
    getDocumentTags: repository.getDocumentTags,
    getDisposalLogs: repository.getDisposalLogs,
    getDocumentAuditLogs: repository.getDocumentAuditLogs,
    findDocumentsByNumbers: repository.findDocumentsByNumbers,
    loadDocumentFormOptions: repository.loadDocumentFormOptions
  });
}
