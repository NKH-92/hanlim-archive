import { BatchPlan } from "./batchPlan.js";
import { createD1Gateway } from "./gateway.js";
import { FREE_TIER_BUDGET } from "../../freeTierBudget.js";

const GATEWAYS = new WeakMap();
const REQUEST_SCOPES = new WeakSet();
const REQUEST_BUDGETS = new WeakMap();
const RAW_STATEMENTS = new WeakMap();

/**
 * Request-scoped D1 gateway. Reuses one cumulative statement counter for the env/request.
 * Production mutation batches must go through executeMutationBatch / gateway.batch(BatchPlan).
 */
export function ensureRequestD1Gateway(env, options = {}) {
  return ensureBindingD1Gateway(env, "DB", options);
}

function ensureBindingD1Gateway(env, binding, options = {}) {
  if (!env || typeof env !== "object") throw new TypeError("env가 필요합니다.");
  let gateways = GATEWAYS.get(env);
  if (!gateways) {
    gateways = new Map();
    GATEWAYS.set(env, gateways);
  }
  if (gateways.has(binding)) return gateways.get(binding);
  const database = env[binding];
  if (!database || typeof database.batch !== "function") {
    throw new TypeError("D1 database binding이 필요합니다.");
  }
  const requestBudget = REQUEST_BUDGETS.get(env) || { statementCount: 0 };
  if (!REQUEST_BUDGETS.has(env)) REQUEST_BUDGETS.set(env, requestBudget);
  const gateway = createD1Gateway(database, {
    requestId: options.requestId || env.__requestId || "",
    logger: options.logger || env.__logger || null,
    onMetrics: options.onMetrics || null,
    requestBudget,
    unwrapStatement
  });
  gateways.set(binding, gateway);
  return gateway;
}

/**
 * Cloudflare가 재사용하는 원본 env를 prototype으로 두고 요청마다 고유한 쓰기 경계를 만든다.
 * 요청 gateway는 이 wrapper 객체를 WeakMap key로 사용하므로 동시 요청끼리 상태를 공유하지 않는다.
 */
export function createRequestD1Environment(env, options = {}) {
  if (!env || typeof env !== "object") throw new TypeError("env가 필요합니다.");
  const requestEnv = Object.create(env);
  REQUEST_SCOPES.add(requestEnv);
  const inheritedBudget = options.requestScope
    ? REQUEST_BUDGETS.get(options.requestScope)
    : null;
  REQUEST_BUDGETS.set(requestEnv, inheritedBudget || { statementCount: 0 });
  for (const binding of ["DB", "SEARCH_DB"]) {
    if (!env[binding] || typeof env[binding].batch !== "function") continue;
    // gateway는 wrapper가 아니라 원본 binding을 잡아야 raw batch가 중복 집계되지 않는다.
    const gateway = ensureBindingD1Gateway(requestEnv, binding, options);
    Object.defineProperty(requestEnv, binding, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: createRequestDatabase(
        env[binding],
        () => gateway
      )
    });
  }
  return requestEnv;
}

/**
 * 요청 예산의 남은 statement 수. Cron처럼 여러 유지보수 단계를 한 invocation에 담을 때
 * 다음 단계를 시작해도 되는지 판정한다. 요청 경계가 없으면 전체 예산을 반환한다.
 */
export function remainingRequestD1Statements(env) {
  const budget = env ? REQUEST_BUDGETS.get(env) : null;
  const used = Number(budget?.statementCount || 0);
  return Math.max(0, FREE_TIER_BUDGET.maxD1StatementsPerRequest - used);
}

/** Reset gateway counter between tests or after a synthetic request boundary. */
export function resetRequestD1Gateway(env) {
  if (!env) return;
  GATEWAYS.delete(env);
  REQUEST_BUDGETS.delete(env);
}

/**
 * Only BatchPlan mutation batches are allowed. Counts toward the request-global budget
 * when env.__d1RequestScoped is set (Worker fetch). Otherwise each batch is isolated so
 * multi-step test flows are not falsely cumulative across separate units of work.
 */
export async function executeMutationBatch(env, plan, options = {}) {
  if (!(plan instanceof BatchPlan)) {
    throw new TypeError("D1 mutation batch는 BatchPlan만 허용합니다.");
  }
  if (!REQUEST_SCOPES.has(env) && env.__d1RequestScoped !== true) {
    resetRequestD1Gateway(env);
  }
  return ensureRequestD1Gateway(env, options).batch(plan);
}

export async function d1First(env, statement, options = {}) {
  return ensureRequestD1Gateway(env, options).first(unwrapStatement(statement));
}

export async function d1All(env, statement, options = {}) {
  return ensureRequestD1Gateway(env, options).all(unwrapStatement(statement));
}

export async function d1Run(env, statement, options = {}) {
  return ensureRequestD1Gateway(env, options).run(unwrapStatement(statement));
}

function createRequestDatabase(database, getGateway) {
  return new Proxy({}, {
    get(_target, property) {
      if (property === "prepare") return (sql) => wrapStatement(database.prepare(sql), getGateway);
      if (property === "batch") {
        return (statements) => getGateway().rawBatch(statements.map(unwrapStatement));
      }
      const value = Reflect.get(database, property, database);
      return typeof value === "function" ? value.bind(database) : value;
    }
  });
}

function wrapStatement(statement, getGateway) {
  if (!statement || typeof statement !== "object") return statement;
  if (RAW_STATEMENTS.has(statement)) return statement;
  const wrapped = new Proxy({}, {
    get(_target, property) {
      if (property === "bind") return (...args) => {
        if (args.length > FREE_TIER_BUDGET.maxD1BoundParametersPerStatement) {
          throw new RangeError(
            `D1 statement bind count ${args.length} exceeds ${FREE_TIER_BUDGET.maxD1BoundParametersPerStatement}`
          );
        }
        return wrapStatement(statement.bind(...args), getGateway);
      };
      if (property === "first") return (...args) => getGateway().first(statement, ...args);
      if (property === "all") return (...args) => getGateway().all(statement, ...args);
      if (property === "run") return (...args) => getGateway().run(statement, ...args);
      if (property === "raw") return (...args) => getGateway().raw(statement, ...args);
      const value = Reflect.get(statement, property, statement);
      return typeof value === "function" ? value.bind(statement) : value;
    }
  });
  RAW_STATEMENTS.set(wrapped, statement);
  return wrapped;
}

function unwrapStatement(statement) {
  return RAW_STATEMENTS.get(statement) || statement;
}
