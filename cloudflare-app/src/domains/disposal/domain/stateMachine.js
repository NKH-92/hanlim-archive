const BATCH_TRANSITIONS = Object.freeze({
  draft: Object.freeze(["frozen", "cancelled"]),
  frozen: Object.freeze(["processing", "cancelled"]),
  processing: Object.freeze(["completed", "cancelled"]),
  completed: Object.freeze([]),
  cancelled: Object.freeze([])
});
const ITEM_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["excluded", "completed", "changed", "failed"]),
  excluded: Object.freeze(["pending"]),
  completed: Object.freeze([]), changed: Object.freeze([]), failed: Object.freeze([])
});

export function canTransitionDisposalBatch(from, to) {
  return BATCH_TRANSITIONS[from]?.includes(to) === true;
}
export function canTransitionDisposalItem(from, to) {
  return ITEM_TRANSITIONS[from]?.includes(to) === true;
}
export const DISPOSAL_BATCH_STATUSES = Object.freeze(Object.keys(BATCH_TRANSITIONS));
export const DISPOSAL_ITEM_STATUSES = Object.freeze(Object.keys(ITEM_TRANSITIONS));
