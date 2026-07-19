import { createDocumentQueries } from "./application/queries.js";
import * as repository from "./infrastructure/queries.js";

const queries = createDocumentQueries(repository);
export const {
  getDocumentPage, getDocumentCount, getDocumentsForExport, getDocument, findDuplicateDocument,
  getDocumentTags, getDisposalLogs, getDocumentAuditLogs, findDocumentsByNumbers, loadDocumentFormOptions
} = queries;
