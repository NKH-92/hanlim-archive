import { BatchPlan } from "./batchPlan.js";

export function createD1Gateway(database, { logger = null, requestId = "", onMetrics = null } = {}) {
  if (!database || typeof database.batch !== "function") throw new TypeError("D1 database binding이 필요합니다.");
  let statementCount = 0;

  async function execute(kind, statement, method) {
    if (!statement || typeof statement[method] !== "function") throw new TypeError(`D1 ${kind} statement가 올바르지 않습니다.`);
    const startedAt = performance.now();
    statementCount += 1;
    try {
      return await statement[method]();
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
    first(statement) { return execute("first", statement, "first"); },
    all(statement) { return execute("all", statement, "all"); },
    run(statement) { return execute("run", statement, "run"); },
    async batch(plan) {
      const execution = plan instanceof BatchPlan
        ? plan.execution()
        : { metadata: { id: null, steps: [] }, statements: Object.freeze([...plan]) };
      const startedAt = performance.now();
      statementCount += execution.statements.length;
      try {
        const results = await database.batch(execution.statements);
        for (const [index, step] of (execution.metadata.steps || []).entries()) {
          if (step.expectChanged && Number(results[index]?.meta?.changes || 0) < 1) {
            throw new D1ExpectedChangeError(execution.metadata.id, step.name);
          }
        }
        return results;
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
