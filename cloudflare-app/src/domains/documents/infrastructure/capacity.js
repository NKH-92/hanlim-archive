import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";

export async function getDocumentCapacity(env) {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM documents WHERE sync_state = 'current') AS current_count,
      warning_document_count,
      hard_document_count
    FROM capacity_policy
    WHERE id = 1
  `).first();
  const currentCount = Number(row?.current_count || 0);
  const warningCount = Number(row?.warning_document_count || FREE_TIER_BUDGET.documentCapacityWarningCount);
  const hardCount = Number(row?.hard_document_count || FREE_TIER_BUDGET.documentCapacityHardCount);
  return {
    currentCount,
    warningCount,
    hardCount,
    remainingCount: Math.max(0, hardCount - currentCount),
    level: currentCount >= hardCount ? "blocked" : currentCount >= warningCount ? "warning" : "ok"
  };
}

export function isDocumentCapacityError(error) {
  return /DOCUMENT_CAPACITY_EXCEEDED/.test(String(error?.message || error || ""));
}
