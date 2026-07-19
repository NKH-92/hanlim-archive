import { createSetService } from "./application/service.js";
import * as repository from "./infrastructure/repository.js";

const service = createSetService(repository);
export const {
  getDocumentSets, getDocumentSet, getDocumentSetDocuments, upsertDocumentSet,
  deleteDocumentSet, addDocumentsToSet, removeDocumentFromSet, getDocumentSetLogs,
  setDocumentSetLock
} = service;
export { actorDisplayName, isSetLocked } from "./domain/policy.js";
export { setRowToReadModel } from "./web/presenters.js";
