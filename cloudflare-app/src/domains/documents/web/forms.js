import { normalizeRackFace } from "../../racks/index.js";
import { clean } from "../../../shared/text/normalize.js";

export function valuesFromDocumentForm(form) {
  const expectedUpdatedAt = clean(form.get("expectedUpdatedAt"));
  const expectedRowVersion = Number(form.get("expectedRowVersion"));
  return {
    documentNumber: clean(form.get("documentNumber")), revisionNumber: clean(form.get("revisionNumber")),
    revisionDate: clean(form.get("revisionDate")), disposalDueYear: clean(form.get("disposalDueYear")),
    documentName: clean(form.get("documentName")), categoryId: Number(form.get("categoryId")),
    rackSlotId: Number(form.get("rackSlotId")), rackFace: normalizeRackFace(form.get("rackFace")),
    note: clean(form.get("note")),
    tagIds: form.getAll("tagIds").map(Number).filter((id) => Number.isInteger(id) && id > 0),
    expectedUpdatedAt, expectedRowVersion, updatedAt: expectedUpdatedAt, rowVersion: expectedRowVersion
  };
}
