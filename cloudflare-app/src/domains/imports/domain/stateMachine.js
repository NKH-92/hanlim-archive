const JOB_TRANSITIONS = Object.freeze({
  ready: Object.freeze(["processing", "completed", "cancelled"]),
  processing: Object.freeze(["processing", "completed", "cancelled"]),
  completed: Object.freeze([]),
  cancelled: Object.freeze([])
});
const ITEM_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["completed", "failed"]),
  completed: Object.freeze([]), failed: Object.freeze([])
});

export function canTransitionImportJob(from, to) {
  return JOB_TRANSITIONS[from]?.includes(to) === true;
}
export function canTransitionImportItem(from, to) {
  return ITEM_TRANSITIONS[from]?.includes(to) === true;
}
export const IMPORT_JOB_STATUSES = Object.freeze(Object.keys(JOB_TRANSITIONS));
export const IMPORT_ITEM_STATUSES = Object.freeze(Object.keys(ITEM_TRANSITIONS));

export function normalizeStagedImportPayload(payload = {}) {
  return Object.freeze({
    documentNumber: String(payload.documentNumber || "").trim(),
    revisionNumber: String(payload.revisionNumber || "").trim(),
    documentName: String(payload.documentName || "").trim(),
    categoryId: Number(payload.categoryId || 0),
    rackSlotId: Number(payload.rackSlotId || 0),
    rackFace: payload.rackFace === "B" ? "B" : "A",
    tagIds: Object.freeze([...(payload.tagIds || [])].map(Number).filter((id) => Number.isInteger(id) && id > 0))
  });
}
