import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { createBatchPlan } from "../../../platform/d1/batchPlan.js";

export function createImportPlan(action, statements, guard = action) {
  const plan = createBatchPlan(`imports.${action}`).withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest);
  statements.forEach((statement, index) => plan.step(`${action}.${index + 1}`, statement, { guard }));
  return plan;
}
export function importStatements(action, statements, guard) {
  return createImportPlan(action, statements, guard).execution().statements;
}
