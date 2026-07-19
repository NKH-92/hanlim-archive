import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { createBatchPlan } from "../../../platform/d1/batchPlan.js";

export function createDisposalPlan(action, statements, guard = action) {
  const plan = createBatchPlan(`disposal.${action}`).withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest);
  statements.forEach((statement, index) => plan.step(`${action}.${index + 1}`, statement, { guard }));
  return plan;
}
export function disposalStatements(action, statements, guard) {
  return createDisposalPlan(action, statements, guard).execution().statements;
}
