import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";

export async function runDocumentSnapshotMaintenance(env) {
  const result = await env.DB.prepare(`
    DELETE FROM document_snapshot_membership
    WHERE (snapshot_id, row_number) IN (
      SELECT membership.snapshot_id, membership.row_number
      FROM document_snapshot_membership membership
      WHERE membership.snapshot_id IN (
        SELECT id
        FROM document_snapshots
        WHERE status = 'completed'
        ORDER BY applied_at DESC, id DESC
        LIMIT -1 OFFSET ?
      )
      ORDER BY membership.snapshot_id, membership.row_number
      LIMIT ?
    )
  `).bind(
    FREE_TIER_BUDGET.snapshotMembershipRetentionCount,
    FREE_TIER_BUDGET.snapshotMembershipCleanupChunkSize
  ).run();
  return { ok: true, deleted: Number(result?.meta?.changes || 0) };
}
