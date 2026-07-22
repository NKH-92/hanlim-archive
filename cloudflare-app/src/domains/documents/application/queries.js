export function createDocumentQueries(repository) {
  return Object.freeze({
    getDocumentPage: repository.getDocumentPage,
    getDocumentCount: repository.getDocumentCount,
    getDocumentsForExport: repository.getDocumentsForExport,
    getDocument: repository.getDocument,
    getDocumentRevisionHistory: repository.getDocumentRevisionHistory,
    getDocumentRevisionLink: repository.getDocumentRevisionLink,
    findDuplicateDocument: repository.findDuplicateDocument,
    getDocumentTags: repository.getDocumentTags,
    getDisposalLogs: repository.getDisposalLogs,
    getDocumentAuditLogs: repository.getDocumentAuditLogs,
    getDocumentQualitySummary: repository.getDocumentQualitySummary,
    getDisposalCandidates: repository.getDisposalCandidates,
    getDisposalDueYears: repository.getDisposalDueYears,
    parseDisposalFilters: repository.parseDisposalFilters,
    parseDocumentNumberList: repository.parseDocumentNumberList,
    findDocumentsByNumbers: repository.findDocumentsByNumbers,
    loadDocumentFormOptions: repository.loadDocumentFormOptions
  });
}
