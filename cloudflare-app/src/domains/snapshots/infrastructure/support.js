import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { createBatchPlan } from "../../../platform/d1/batchPlan.js";

export const SNAPSHOT_STATUSES = new Set(["staging", "ready", "applying", "completed", "cancelled", "failed"]);
export const ROW_ACTIONS = new Set(["staged", "create", "update", "unchanged"]);
export const BOOTSTRAP_CONFIRMATION = "BOOTSTRAP";

export function readBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function optionalPositiveInteger(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function systemSnapshotAuditStatement(env, snapshotId, action, summary, actor, details, requiredStatus) {
  return env.DB.prepare(`
    INSERT INTO system_audit_logs (
      entity_type, entity_id, entity_reference, action, actor_user_id,
      actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
      summary, details_json
    )
    SELECT 'document_snapshot', CAST(id AS TEXT), snapshot_code, ?, ?, ?, ?, ?, ?, ?
    FROM document_snapshots
    WHERE id = ? AND status = ?
  `).bind(
    action,
    actor.userId,
    actor.username,
    actor.displayName,
    JSON.stringify(actor.permissions),
    summary,
    JSON.stringify(details),
    snapshotId,
    requiredStatus
  );
}

export function createSnapshotPlan(action, statements) {
  const plan = createBatchPlan(`snapshots.${action}`).withBudget(FREE_TIER_BUDGET.maxD1MutationStatementsPerBatch);
  statements.forEach((statement, index) => plan.step(`${action}.${index + 1}`, statement, { guard: "snapshot-state" }));
  return plan;
}
