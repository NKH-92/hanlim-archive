import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { clean } from "../../../shared/text/normalize.js";
import { ROW_ACTIONS } from "./support.js";

export async function getDocumentSyncState(env) {
  const row = await env.DB.prepare(`
    SELECT current_version, current_snapshot_id, updated_at
    FROM document_sync_state
    WHERE id = 1
  `).first();
  return {
    currentVersion: Number(row?.current_version || 1),
    currentSnapshotId: Number(row?.current_snapshot_id || 0),
    updatedAt: clean(row?.updated_at)
  };
}

export async function listDocumentSnapshots(env, { limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const result = await env.DB.prepare(`
    SELECT *
    FROM document_snapshots
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return result.results ?? [];
}

export async function getDocumentSnapshot(env, id) {
  return env.DB.prepare(`
    SELECT *
    FROM document_snapshots
    WHERE id = ?
  `).bind(id).first();
}

export async function getDocumentSnapshotRows(env, snapshotId, { action = "", limit = 1000 } = {}) {
  const safeAction = ROW_ACTIONS.has(action) ? action : "";
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, FREE_TIER_BUDGET.excelSnapshotMaxItems));
  const result = await env.DB.prepare(`
    SELECT
      id, snapshot_id, row_number, row_key, source_row_key, source_json, normalized_json,
      before_json, after_json, changed_fields_json, change_flags_json,
      action, matched_document_id, expected_row_version
    FROM document_snapshot_rows
    WHERE snapshot_id = ? AND (? = '' OR action = ?)
    ORDER BY row_number
    LIMIT ?
  `).bind(snapshotId, safeAction, safeAction, safeLimit).all();
  return result.results ?? [];
}

export async function getDocumentSnapshotExclusions(env, snapshotId) {
  const result = await env.DB.prepare(`
    SELECT
      ex.id, ex.snapshot_id, ex.document_id, ex.excel_row_key, ex.expected_row_version,
      ex.before_json, ex.created_at,
      (SELECT COUNT(*) FROM document_set_items item WHERE item.document_id = ex.document_id) AS set_count,
      (SELECT MAX(movement.created_at) FROM document_movements movement WHERE movement.document_id = ex.document_id) AS recent_movement_at
    FROM document_snapshot_exclusions ex
    WHERE ex.snapshot_id = ?
    ORDER BY ex.document_id
  `).bind(snapshotId).all();
  return result.results ?? [];
}
