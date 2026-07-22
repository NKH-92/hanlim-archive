import { FREE_TIER_BUDGET } from "../../freeTierBudget.js";
import { BatchPlan, D1BudgetExceededError } from "./batchPlan.js";
import { isExpectedChangeAbort } from "./expectedChange.js";

const GLOBAL_STATEMENT_BUDGET = FREE_TIER_BUDGET.maxD1StatementsPerRequest;

export function createD1Gateway(database, { logger = null, requestId = "", onMetrics = null } = {}) {
  if (!database || typeof database.batch !== "function") throw new TypeError("D1 database binding이 필요합니다.");
  let statementCount = 0;

  function ensureRequestBudget(additional) {
    if (statementCount + additional > GLOBAL_STATEMENT_BUDGET) {
      throw new D1BudgetExceededError("request", statementCount + additional, GLOBAL_STATEMENT_BUDGET);
    }
  }

  async function execute(kind, statement, method, args = []) {
    if (!statement || typeof statement[method] !== "function") throw new TypeError(`D1 ${kind} statement가 올바르지 않습니다.`);
    ensureRequestBudget(1);
    const startedAt = performance.now();
    statementCount += 1;
    try {
      return await statement[method](...args);
    } finally {
      record(kind, 1, startedAt);
    }
  }

  function record(kind, count, startedAt, planId = null) {
    const metric = Object.freeze({ requestId, kind, planId, statements: count, totalStatements: statementCount, durationMs: performance.now() - startedAt });
    if (onMetrics) onMetrics(metric);
    if (logger?.info) logger.info("d1.query", metric);
  }

  return Object.freeze({
    first(statement, ...args) { return execute("first", statement, "first", args); },
    all(statement, ...args) { return execute("all", statement, "all", args); },
    run(statement, ...args) { return execute("run", statement, "run", args); },
    raw(statement, ...args) { return execute("raw", statement, "raw", args); },
    async batch(plan) {
      if (!(plan instanceof BatchPlan)) {
        throw new TypeError("D1 mutation batch는 BatchPlan만 허용합니다.");
      }
      const prepare = typeof database.prepare === "function" ? (sql) => database.prepare(sql) : null;
      const execution = plan.execution(prepare);
      ensureRequestBudget(execution.statements.length);
      const startedAt = performance.now();
      statementCount += execution.statements.length;
      try {
        const results = await database.batch(execution.statements);
        // prepare가 없는 test double만 post-batch 검사로 보완한다.
        if (!prepare) {
          for (const [index, step] of (execution.metadata.steps || []).entries()) {
            if (step.expectChanged && Number(results[index]?.meta?.changes || 0) < 1) {
              throw new D1ExpectedChangeError(execution.metadata.id, step.name);
            }
          }
        }
        return results;
      } catch (error) {
        if (error instanceof D1ExpectedChangeError) throw error;
        if (isExpectedChangeAbort(error)) {
          const failed = (execution.metadata.steps || []).find((step) => step.expectChanged);
          throw new D1ExpectedChangeError(execution.metadata.id, failed?.name || "expected-change");
        }
        throw error;
      } finally {
        record("batch", execution.statements.length, startedAt, execution.metadata.id);
      }
    },
    metrics() { return Object.freeze({ statementCount }); }
  });
}

export class D1ExpectedChangeError extends Error {
  constructor(planId, stepName) {
    super(`${planId}: ${stepName} step이 행을 변경하지 않았습니다.`);
    this.name = "D1ExpectedChangeError";
    this.code = "STALE_VERSION";
  }
}

export { D1BudgetExceededError };
