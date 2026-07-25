import { FREE_TIER_BUDGET } from "../../freeTierBudget.js";
import { BatchPlan, D1BudgetExceededError } from "./batchPlan.js";
import { isExpectedChangeAbort } from "./expectedChange.js";

const GLOBAL_STATEMENT_BUDGET = FREE_TIER_BUDGET.maxD1StatementsPerRequest;

export function createD1Gateway(database, {
  logger = null,
  requestId = "",
  onMetrics = null,
  requestBudget = null,
  unwrapStatement = (statement) => statement
} = {}) {
  if (!database || typeof database.batch !== "function") throw new TypeError("D1 database binding이 필요합니다.");
  let statementCount = 0;
  let rowsRead = 0;
  let rowsWritten = 0;
  const sharedBudget = requestBudget || { statementCount: 0 };

  function ensureRequestBudget(additional) {
    if (sharedBudget.statementCount + additional > GLOBAL_STATEMENT_BUDGET) {
      throw new D1BudgetExceededError(
        "request",
        sharedBudget.statementCount + additional,
        GLOBAL_STATEMENT_BUDGET
      );
    }
  }

  function consume(additional) {
    statementCount += additional;
    sharedBudget.statementCount += additional;
  }

  async function execute(kind, statement, method, args = []) {
    if (!statement || typeof statement[method] !== "function") throw new TypeError(`D1 ${kind} statement가 올바르지 않습니다.`);
    ensureRequestBudget(1);
    const startedAt = performance.now();
    consume(1);
    let result;
    try {
      result = await statement[method](...args);
      return result;
    } finally {
      record(kind, 1, startedAt, null, result);
    }
  }

  function record(kind, count, startedAt, planId = null, results = null) {
    const usage = d1Usage(results);
    rowsRead += usage.rowsRead;
    rowsWritten += usage.rowsWritten;
    const metric = Object.freeze({
      requestId,
      kind,
      planId,
      statements: count,
      bindingStatements: statementCount,
      totalStatements: sharedBudget.statementCount,
      rowsRead: usage.rowsRead,
      rowsWritten: usage.rowsWritten,
      bindingRowsRead: rowsRead,
      bindingRowsWritten: rowsWritten,
      durationMs: performance.now() - startedAt
    });
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
      consume(execution.statements.length);
      let results;
      try {
        results = await database.batch(execution.statements.map(unwrapStatement));
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
        record("batch", execution.statements.length, startedAt, execution.metadata.id, results);
      }
    },
    async rawBatch(statements) {
      if (!Array.isArray(statements)) throw new TypeError("D1 batch statements 배열이 필요합니다.");
      ensureRequestBudget(statements.length);
      const startedAt = performance.now();
      consume(statements.length);
      let results;
      try {
        results = await database.batch(statements);
        return results;
      } finally {
        record("raw-batch", statements.length, startedAt, null, results);
      }
    },
    metrics() {
      return Object.freeze({
        statementCount,
        totalStatementCount: sharedBudget.statementCount,
        rowsRead,
        rowsWritten
      });
    }
  });
}

function d1Usage(results) {
  const list = Array.isArray(results) ? results : results ? [results] : [];
  let rowsRead = 0;
  let rowsWritten = 0;
  for (const result of list) {
    const meta = result?.meta;
    const read = Number(meta?.rows_read ?? meta?.rowsRead ?? 0);
    const written = Number(meta?.rows_written ?? meta?.rowsWritten ?? 0);
    if (Number.isFinite(read) && read > 0) rowsRead += read;
    if (Number.isFinite(written) && written > 0) rowsWritten += written;
  }
  return { rowsRead, rowsWritten };
}

export class D1ExpectedChangeError extends Error {
  constructor(planId, stepName) {
    super(`${planId}: ${stepName} step이 행을 변경하지 않았습니다.`);
    this.name = "D1ExpectedChangeError";
    this.code = "STALE_VERSION";
  }
}

export { D1BudgetExceededError };
