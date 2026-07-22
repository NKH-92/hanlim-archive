import assert from "node:assert/strict";
import test from "node:test";

import { createRequestContext } from "../src/app/requestContext.js";
import { createBatchPlan, D1BudgetExceededError } from "../src/platform/d1/batchPlan.js";
import { expectedChangeAssertionSql, exactChangeCountAssertionSql, isExpectedChangeAbort, STALE_VERSION_ABORT } from "../src/platform/d1/expectedChange.js";
import { createD1Gateway, D1ExpectedChangeError } from "../src/platform/d1/gateway.js";
import { actorFromSession, serializeActor, systemActor } from "../src/shared/contracts/actor.js";
import { ERROR_CODES } from "../src/shared/contracts/errors.js";
import { err, ok } from "../src/shared/contracts/result.js";
import { DatabaseSync } from "node:sqlite";
import { sqliteD1 } from "./helpers/sqliteD1.js";

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
  assert.throws(() => createBatchPlan("over").withBudget(41), /요청 상한/);
});

test("D1Gateway는 BatchPlan만 받고 기대 변경 실패를 구조화한다", async () => {
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
  await assert.rejects(() => gateway.batch([statement("raw")]), /BatchPlan만/);
});

test("expectedChangeAssertionSql은 STALE_VERSION abort SQL을 포함하며 1/0에 의존하지 않는다", () => {
  const sql = expectedChangeAssertionSql();
  assert.match(sql, new RegExp(STALE_VERSION_ABORT));
  assert.doesNotMatch(sql, /1\s*\/\s*0/);
  assert.match(sql, /abs\(-9223372036854775808\)/);
  assert.match(exactChangeCountAssertionSql("3"), new RegExp(STALE_VERSION_ABORT));
});

test("D1Gateway는 prepare가 있으면 expectChanged를 트랜잭션 abort SQL로 삽입한다", async () => {
  const prepared = [];
  const database = {
    prepare(sql) {
      prepared.push(sql);
      return { sql };
    },
    async batch(statements) {
      assert.equal(statements.length, 2);
      assert.match(prepared[0], new RegExp(STALE_VERSION_ABORT));
      assert.doesNotMatch(prepared[0], /1\s*\/\s*0/);
      throw new Error(`integer overflow: ${STALE_VERSION_ABORT}`);
    }
  };
  const gateway = createD1Gateway(database, { requestId: "req-3" });
  const plan = createBatchPlan("documents.update").step("document.update", statement("update")).expectChanged("document.update");
  await assert.rejects(() => gateway.batch(plan), (error) => error instanceof D1ExpectedChangeError);
});

test("실제 CHECK constraint 오류는 stale-write로 오분류하지 않는다", async () => {
  const checkError = new Error("CHECK constraint failed: documents_status");
  assert.equal(isExpectedChangeAbort(checkError), false);
  const database = {
    prepare(sql) { return statement(sql); },
    async batch() { throw checkError; }
  };
  const gateway = createD1Gateway(database);
  const plan = createBatchPlan("documents.check")
    .step("document.update", statement("update"))
    .expectChanged("document.update");
  await assert.rejects(() => gateway.batch(plan), (error) => error === checkError);
});

test("expected-change abort는 선행 INSERT를 포함한 트랜잭션 전체를 rollback한다", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE probe_audit (id INTEGER PRIMARY KEY, note TEXT);
    CREATE TABLE probe_docs (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
    INSERT INTO probe_docs (id, version) VALUES (1, 1);
  `);
  const db = sqliteD1(database);
  const gateway = createD1Gateway(db, { requestId: "req-rollback" });
  const plan = createBatchPlan("probe.stale")
    .step("audit.insert", db.prepare("INSERT INTO probe_audit (note) VALUES ('should-roll-back')"))
    .step("doc.update", db.prepare("UPDATE probe_docs SET version = version + 1 WHERE id = 1 AND version = 999"))
    .expectChanged("doc.update");

  await assert.rejects(() => gateway.batch(plan), (error) => error instanceof D1ExpectedChangeError);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM probe_audit").get().n, 0);
  assert.equal(database.prepare("SELECT version FROM probe_docs WHERE id = 1").get().version, 1);
  database.close();
});

test("expected-change 성공 시에만 선행 INSERT가 commit된다", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE probe_audit (id INTEGER PRIMARY KEY, note TEXT);
    CREATE TABLE probe_docs (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
    INSERT INTO probe_docs (id, version) VALUES (1, 1);
  `);
  const db = sqliteD1(database);
  const gateway = createD1Gateway(db, { requestId: "req-commit" });
  const plan = createBatchPlan("probe.ok")
    .step("audit.insert", db.prepare("INSERT INTO probe_audit (note) VALUES ('keep')"))
    .step("doc.update", db.prepare("UPDATE probe_docs SET version = version + 1 WHERE id = 1 AND version = 1"))
    .expectChanged("doc.update");

  await gateway.batch(plan);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM probe_audit").get().n, 1);
  assert.equal(database.prepare("SELECT version FROM probe_docs WHERE id = 1").get().version, 2);
  database.close();
});

test("request-global D1 budget는 여러 BatchPlan에 누적되며 DB 실행 전에 거부한다", async () => {
  const { FREE_TIER_BUDGET } = await import("../src/freeTierBudget.js");
  const { executeMutationBatch, resetRequestD1Gateway } = await import("../src/platform/d1/requestGateway.js");
  let batchCalls = 0;
  const database = {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      batchCalls += 1;
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
  const env = { DB: database, __d1RequestScoped: true };
  resetRequestD1Gateway(env);

  const half = Math.ceil(FREE_TIER_BUDGET.maxD1StatementsPerRequest / 2);
  const firstPlan = createBatchPlan("budget.first").withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest);
  for (let index = 0; index < half; index += 1) firstPlan.step(`s${index}`, statement(`first-${index}`));
  await executeMutationBatch(env, firstPlan);
  assert.equal(batchCalls, 1);

  const secondPlan = createBatchPlan("budget.second").withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest);
  for (let index = 0; index < half + 1; index += 1) secondPlan.step(`t${index}`, statement(`second-${index}`));
  await assert.rejects(() => executeMutationBatch(env, secondPlan), D1BudgetExceededError);
  assert.equal(batchCalls, 1, "budget 초과 시 database.batch를 호출하지 않는다");

  await assert.rejects(
    () => executeMutationBatch(env, [statement("raw")]),
    /BatchPlan만 허용/
  );
});

test("공유 Cloudflare env에서 만든 동시 요청 gateway는 예산을 서로 오염시키지 않는다", async () => {
  const { createRequestD1Environment, ensureRequestD1Gateway, executeMutationBatch } = await import("../src/platform/d1/requestGateway.js");
  let batchCalls = 0;
  const database = {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      batchCalls += 1;
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
  const sharedEnv = { DB: database };
  const requestA = createRequestD1Environment(sharedEnv, { requestId: "request-a" });
  const requestB = createRequestD1Environment(sharedEnv, { requestId: "request-b" });
  assert.notEqual(requestA, requestB);
  assert.notEqual(ensureRequestD1Gateway(requestA), ensureRequestD1Gateway(requestB));

  const firstPlan = createBatchPlan("request-a.plan");
  for (let index = 0; index < 30; index += 1) firstPlan.step(`a${index}`, statement(`a-${index}`));
  const secondPlan = createBatchPlan("request-b.plan");
  for (let index = 0; index < 11; index += 1) secondPlan.step(`b${index}`, statement(`b-${index}`));

  await executeMutationBatch(requestA, firstPlan);
  await executeMutationBatch(requestB, secondPlan);
  assert.equal(batchCalls, 2);
  assert.equal(ensureRequestD1Gateway(requestA).metrics().statementCount, 30);
  assert.equal(ensureRequestD1Gateway(requestB).metrics().statementCount, 11);
  assert.equal(Object.hasOwn(sharedEnv, "__d1Gateway"), false);
});

test("request DB 직접 실행과 BatchPlan은 하나의 40-statement 예산을 공유한다", async () => {
  const { FREE_TIER_BUDGET } = await import("../src/freeTierBudget.js");
  const { createRequestD1Environment, d1First, ensureRequestD1Gateway, executeMutationBatch } = await import("../src/platform/d1/requestGateway.js");
  let directCalls = 0;
  let batchCalls = 0;
  const database = {
    prepare(sql) {
      const make = (args = []) => ({
        sql,
        args,
        bind: (...nextArgs) => make(nextArgs),
        first: async () => { directCalls += 1; return { ok: 1 }; },
        all: async () => { directCalls += 1; return { results: [] }; },
        run: async () => { directCalls += 1; return { meta: { changes: 1 } }; },
        raw: async () => { directCalls += 1; return []; }
      });
      return make();
    },
    async batch(statements) {
      batchCalls += 1;
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
  const requestEnv = createRequestD1Environment({ DB: database }, { requestId: "raw-plus-batch" });

  const firstWrapped = requestEnv.DB.prepare("first-through-helper");
  await d1First(requestEnv, firstWrapped);
  assert.equal(ensureRequestD1Gateway(requestEnv).metrics().statementCount, 1, "helper가 wrapped statement를 중복 집계하지 않는다");
  await requestEnv.DB.prepare("raw-api").raw();

  for (let index = 2; index < FREE_TIER_BUDGET.maxD1StatementsPerRequest; index += 1) {
    await requestEnv.DB.prepare(`raw-${index}`).first();
  }
  assert.equal(directCalls, FREE_TIER_BUDGET.maxD1StatementsPerRequest);
  assert.equal(ensureRequestD1Gateway(requestEnv).metrics().statementCount, FREE_TIER_BUDGET.maxD1StatementsPerRequest);

  const plan = createBatchPlan("raw-plus-batch.overflow").step("mutation", requestEnv.DB.prepare("mutation"));
  await assert.rejects(() => executeMutationBatch(requestEnv, plan), D1BudgetExceededError);
  assert.equal(batchCalls, 0, "초과 batch는 원본 DB에 전달되지 않는다");
});

test("production request DB wrapper는 D1 100개 초과 bind를 원본 호출 전에 거부한다", async () => {
  const { FREE_TIER_BUDGET } = await import("../src/freeTierBudget.js");
  const { createRequestD1Environment } = await import("../src/platform/d1/requestGateway.js");
  let bindCalls = 0;
  const rawStatement = {
    bind() {
      bindCalls += 1;
      return rawStatement;
    },
    async first() { return null; }
  };
  const requestEnv = createRequestD1Environment({
    DB: {
      prepare() { return rawStatement; },
      async batch() { return []; }
    }
  });

  const allowed = Array.from({ length: FREE_TIER_BUDGET.maxD1BoundParametersPerStatement }, (_, index) => index);
  requestEnv.DB.prepare("allowed").bind(...allowed);
  assert.equal(bindCalls, 1);

  const rejected = [...allowed, "overflow"];
  assert.throws(
    () => requestEnv.DB.prepare("rejected").bind(...rejected),
    /D1 statement bind count 101 exceeds 100/
  );
  assert.equal(bindCalls, 1, "초과 bind는 원본 D1 statement에 전달하지 않는다");
});

function statement(name) {
  return Object.freeze({ name, async first() { return null; }, async all() { return { results: [] }; }, async run() { return { meta: { changes: 1 } }; } });
}
