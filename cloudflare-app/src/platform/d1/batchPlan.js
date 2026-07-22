import { FREE_TIER_BUDGET } from "../../freeTierBudget.js";
import { expectedChangeAssertionSql } from "./expectedChange.js";

const GLOBAL_STATEMENT_BUDGET = FREE_TIER_BUDGET.maxD1StatementsPerRequest;

export class BatchPlan {
  #id;
  #steps = [];
  /** @type {number} */
  #budget = GLOBAL_STATEMENT_BUDGET;
  #expectedChanged = new Set();

  constructor(id) {
    if (!String(id || "").trim()) throw new TypeError("BatchPlan id는 필수입니다.");
    this.#id = String(id);
  }

  step(name, statement, { guard = null, auditEventId = null } = {}) {
    if (!String(name || "").trim()) throw new TypeError("BatchPlan step 이름은 필수입니다.");
    if (!statement) throw new TypeError(`${name}: D1 statement가 필요합니다.`);
    if (this.#steps.some((step) => step.name === name)) throw new TypeError(`${name}: 중복 step 이름`);
    this.#steps.push(Object.freeze({ name: String(name), statement, guard, auditEventId }));
    return this;
  }

  expectChanged(name) {
    this.#expectedChanged.add(String(name));
    return this;
  }

  withBudget(value) {
    const budget = Number(value);
    if (!Number.isInteger(budget) || budget < 1) throw new TypeError("BatchPlan budget은 양의 정수여야 합니다.");
    // 호출자가 전역 요청 상한을 올릴 수 없다.
    if (budget > GLOBAL_STATEMENT_BUDGET) {
      throw new TypeError(`BatchPlan budget은 요청 상한 ${GLOBAL_STATEMENT_BUDGET}을 초과할 수 없습니다.`);
    }
    this.#budget = budget;
    return this;
  }

  describe() {
    return Object.freeze({
      id: this.#id,
      budget: this.#budget,
      statements: this.#steps.length,
      steps: Object.freeze(this.#steps.map((step) => Object.freeze({
        name: step.name,
        guard: step.guard,
        auditEventId: step.auditEventId,
        expectChanged: this.#expectedChanged.has(step.name)
      })))
    });
  }

  /**
   * @param {(sql: string) => unknown} [prepare]
   * prepare가 있으면 expectChanged step 직후에 트랜잭션 abort assertion을 삽입한다.
   * withBudget은 논리 step 수 기준이며, assertion 포함 실제 SQL은 전역 요청 상한만 본다.
   */
  execution(prepare = null) {
    if (this.#steps.length > this.#budget) {
      throw new D1BudgetExceededError(this.#id, this.#steps.length, this.#budget);
    }
    const assertionCount = prepare ? this.#expectedChanged.size : 0;
    const totalStatements = this.#steps.length + assertionCount;
    if (totalStatements > GLOBAL_STATEMENT_BUDGET) {
      throw new D1BudgetExceededError(this.#id, totalStatements, GLOBAL_STATEMENT_BUDGET);
    }

    const statements = [];
    for (const step of this.#steps) {
      statements.push(step.statement);
      if (prepare && this.#expectedChanged.has(step.name)) {
        statements.push(prepare(expectedChangeAssertionSql()));
      }
    }
    return Object.freeze({ metadata: this.describe(), statements: Object.freeze(statements) });
  }
}

export class D1BudgetExceededError extends Error {
  constructor(planId, statements, budget) {
    super(`${planId}: D1 statement ${statements}개가 budget ${budget}개를 초과했습니다.`);
    this.name = "D1BudgetExceededError";
    this.code = "BUDGET_EXCEEDED";
  }
}

export function createBatchPlan(id) {
  return new BatchPlan(id);
}
