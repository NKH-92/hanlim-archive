import { createDocumentCommandService } from "./application/commandService.js";
import * as repository from "./infrastructure/commands.js";

const commands = createDocumentCommandService(repository);
export const {
  createDocument, updateDocument, moveDocument, disposeDocument, disposeDocumentsBulk,
  restoreDocument, permanentlyDeleteDocument
} = commands;
