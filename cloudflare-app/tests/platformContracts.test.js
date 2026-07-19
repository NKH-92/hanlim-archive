import assert from "node:assert/strict";
import test from "node:test";

import { createRequestContext } from "../src/app/requestContext.js";
import { createBatchPlan, D1BudgetExceededError } from "../src/platform/d1/batchPlan.js";
import { createD1Gateway, D1ExpectedChangeError } from "../src/platform/d1/gateway.js";
import { actorFromSession, serializeActor, systemActor } from "../src/shared/contracts/actor.js";
import { ERROR_CODES } from "../src/shared/contracts/errors.js";
import { err, ok } from "../src/shared/contracts/result.js";

test("RequestContext는 HTTP 경계 값과 session·actor를 구분해 고정한다", () => {
  const request = new Request("https://archive.example/documents?q=1", { method: "GET" });
  const context = createRequestContext({ request, env: {}, db: {}, config: {}, requestId: "req-1", logger: {} });
  assert.equal(context.path, "/documents");
  assert.equal(context.method, "GET");
  assert.equal(context.session, null);
  assert.equal(context.actor, null);
  assert.equal(Object.isFrozen(context), true);
});

test("Actor serializer와 Result 계약은 안정된 공개 shape를 제공한다", () => {
  const actor = actorFromSession({ userId: 7, username: "user", displayName: "사용자", role: "User" }, { can_manage_sets: true });
  assert.deepEqual(serializeActor(actor), actor);
  assert.equal(systemActor().role, "System");
  assert.deepEqual(ok(3), { ok: true, value: 3 });
  assert.deepEqual(err(ERROR_CODES.NOT_FOUND, "없음"), {
    ok: false,
    error: { code: "NOT_FOUND", message: "없음", fieldErrors: {}, meta: {} }
  });
});

test("BatchPlan은 순서·guard·audit id·statement budget을 실행 전에 고정한다", () => {
  const first = statement("first");
  const second = statement("second");
  const plan = createBatchPlan("documents.update")
    .step("document.audit", first, { guard: "version:3", auditEventId: "audit-1" })
    .step("document.update", second, { guard: "version:3" })
    .expectChanged("document.update")
    .withBudget(2);
  assert.deepEqual(plan.execution().statements, [first, second]);
  assert.deepEqual(plan.describe().steps, [
    { name: "document.audit", guard: "version:3", auditEventId: "audit-1", expectChanged: false },
    { name: "document.update", guard: "version:3", auditEventId: null, expectChanged: true }
  ]);
  assert.throws(() => plan.step("third", statement("third")).execution(), D1BudgetExceededError);
});

test("D1Gateway는 statement 수를 기록하고 기대 변경 실패를 구조화한다", async () => {
  const metrics = [];
  const database = {
    async batch(statements) {
      assert.equal(statements.length, 1);
      return [{ meta: { changes: 0 } }];
    }
  };
  const gateway = createD1Gateway(database, { requestId: "req-2", onMetrics: (metric) => metrics.push(metric) });
  const plan = createBatchPlan("documents.update").step("document.update", statement("update")).expectChanged("document.update");
  await assert.rejects(() => gateway.batch(plan), (error) => error instanceof D1ExpectedChangeError && error.code === "STALE_VERSION");
  assert.equal(gateway.metrics().statementCount, 1);
  assert.equal(metrics[0].planId, "documents.update");
});

function statement(name) {
  return Object.freeze({ name });
}
