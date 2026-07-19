export class BatchPlan {
  #id;
  #steps = [];
  #budget = Number.POSITIVE_INFINITY;
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

  execution() {
    if (this.#steps.length > this.#budget) throw new D1BudgetExceededError(this.#id, this.#steps.length, this.#budget);
    return Object.freeze({ metadata: this.describe(), statements: Object.freeze(this.#steps.map((step) => step.statement)) });
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
