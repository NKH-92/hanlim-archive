import assert from "node:assert/strict";
import test from "node:test";

import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";
import { countD1Statements, createD1BudgetHarness, hasLoopedD1Execution } from "./helpers/d1Budget.js";

test("D1 budget harness counts direct and batch statements separately", async () => {
  const env = createD1BudgetHarness();
  await env.DB.prepare("SELECT 1").first();
  const statements = [env.DB.prepare("UPDATE a SET x = 1"), env.DB.prepare("UPDATE b SET x = 1")];
  await env.DB.batch(statements);

  assert.equal(env.state.prepareCalls, 3);
  assert.equal(env.state.directExecutions, 1);
  assert.equal(env.state.batchStatements, 2);
  assert.equal(countD1Statements(env.state), 3);
  assert.equal(hasLoopedD1Execution(env.state, 1), false);
  assert.ok(countD1Statements(env.state) <= FREE_TIER_BUDGET.maxD1StatementsPerRequest);
});
