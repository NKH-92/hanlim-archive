import { createDocumentValidation } from "./application/validation.js";
import * as referenceValidator from "./infrastructure/referenceValidation.js";

const validation = createDocumentValidation(referenceValidator);
export const { validateDocumentInput, validateDocumentInputDetails } = validation;
