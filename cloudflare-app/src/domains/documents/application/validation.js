export function createDocumentValidation(referenceValidator) {
  return Object.freeze({
    validateDocumentInput: referenceValidator.validateDocumentInput,
    validateDocumentInputDetails: referenceValidator.validateDocumentInputDetails
  });
}
