import { createBatchPlan } from "../../../platform/d1/batchPlan.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { isExpectedChangeAbort } from "../../../platform/d1/expectedChange.js";
import { createSystemAuditStatement } from "../../audit/index.js";
import { MASTER_TYPES, masterSnapshot } from "../domain/policy.js";

export async function listMasters(env, type, { activeOnly = false } = {}) {
  const table = tableFor(type);
  const columns = activeOnly ? "id, name" : type === "category" ? "id, name, description, sort_order, is_active, row_version" : "id, name, description, is_active, row_version";
  const where = activeOnly ? "\n    WHERE is_active = 1" : "";
  const order = type === "category" ? "sort_order, name" : "name";
  const result = await env.DB.prepare(`
    SELECT ${columns}
    FROM ${table}${where}
    ORDER BY ${order}
  `).all();
  return result.results ?? [];
}

export async function saveMaster(env, type, values, actor) {
  const spec = MASTER_TYPES[type];
  const table = tableFor(type);
  try {
    if (values.id) {
      const before = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(values.id).first();
      if (!before) return { ok: false, message: `${spec.noun}를 찾을 수 없습니다.` };
      if (Number(before.row_version) !== Number(values.expectedRowVersion)) return staleMasterResult(spec.noun);
      const action = auditAction(before, values);
      const update = updateStatement(env, type, values);
      const guardSql = `FROM ${table} WHERE id = ? AND row_version = ?`;
      const guardBinds = [values.id, values.expectedRowVersion];
      const plan = createBatchPlan(`masters.${type}.update`)
        .step(`${type}.audit.${action}`, createSystemAuditStatement(env, {
          entityType: spec.entityType,
          entityId: values.id,
          entityReference: before.name,
          action,
          actor,
          summary: `${spec.noun} ${actionLabel(action)}`,
          details: { before: masterSnapshot(type, before), after: masterSnapshot(type, values) }
        }, { guardSql, guardBinds }), { guard: `${table}.row_version`, auditEventId: `${type}.${action}` })
        .step(`${type}.update`, update, { guard: `${table}.row_version` })
        .expectChanged(`${type}.update`)
        .withBudget(2);
      const results = await executeMutationBatch(env, plan);
      return Number(results[1]?.meta?.changes || 0) > 0 ? { ok: true } : { ok: false, message: `${spec.noun}를 찾을 수 없습니다.` };
    }

    const insert = insertStatement(env, type, values);
    const plan = createBatchPlan(`masters.${type}.create`)
      .step(`${type}.insert`, insert, { guard: `${table}.name` })
      .step(`${type}.audit.create`, createSystemAuditStatement(env, {
        entityType: spec.entityType,
        entityReference: values.name,
        action: "create",
        actor,
        summary: `${spec.noun} 생성`,
        details: { after: masterSnapshot(type, values) }
      }, { guardSql: `FROM ${table} WHERE name = ?`, guardBinds: [values.name] }), { guard: `${table}.name`, auditEventId: `${type}.create` })
      .withBudget(2);
    await executeMutationBatch(env, plan);
    return { ok: true };
  } catch (error) {
    if (isExpectedChangeAbort(error)) return staleMasterResult(spec.noun);
    return { ok: false, message: uniqueViolationMessage(error, spec.noun) };
  }
}

export async function deactivateMaster(env, type, id, actor, expectedRowVersion = 0) {
  const spec = MASTER_TYPES[type];
  const table = tableFor(type);
  const before = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!before) return { ok: false, message: `${spec.noun}를 찾을 수 없습니다.` };
  if (Number(before.is_active) === 0) return { ok: true };
  if (!Number.isInteger(expectedRowVersion) || expectedRowVersion < 1 || Number(before.row_version) !== expectedRowVersion) {
    return staleMasterResult(spec.noun);
  }
  const guardSql = `FROM ${table} WHERE id = ? AND is_active = 1 AND row_version = ?`;
  const guardBinds = [id, expectedRowVersion];
  const plan = createBatchPlan(`masters.${type}.deactivate`)
    .step(`${type}.audit.deactivate`, createSystemAuditStatement(env, {
      entityType: spec.entityType,
      entityId: id,
      entityReference: before.name,
      action: "deactivate",
      actor,
      summary: `${spec.noun} 사용중지`,
      details: { before: masterSnapshot(type, before), after: { ...masterSnapshot(type, before), isActive: false } }
    }, { guardSql, guardBinds }), { guard: `${table}.row_version`, auditEventId: `${type}.deactivate` })
    .step(`${type}.deactivate`, env.DB.prepare(`
      UPDATE ${table}
      SET is_active = 0,
          updated_at = CURRENT_TIMESTAMP,
          row_version = row_version + 1
      WHERE id = ? AND is_active = 1 AND row_version = ?
    `).bind(id, expectedRowVersion), { guard: `${table}.row_version` })
    .expectChanged(`${type}.deactivate`)
    .withBudget(2);
  try {
    const results = await executeMutationBatch(env, plan);
    return Number(results[1]?.meta?.changes || 0) > 0 ? { ok: true } : staleMasterResult(spec.noun);
  } catch (error) {
    if (isExpectedChangeAbort(error)) return staleMasterResult(spec.noun);
    throw error;
  }
}

function updateStatement(env, type, values) {
  if (type === "category") return env.DB.prepare(`
        UPDATE categories
        SET name = ?,
            description = ?,
            sort_order = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP,
            row_version = row_version + 1
        WHERE id = ? AND row_version = ?
      `).bind(values.name, values.description || null, values.sortOrder, values.isActive ? 1 : 0, values.id, values.expectedRowVersion);
  return env.DB.prepare(`
        UPDATE tags
        SET name = ?,
            description = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP,
            row_version = row_version + 1
        WHERE id = ? AND row_version = ?
      `).bind(values.name, values.description || null, values.isActive ? 1 : 0, values.id, values.expectedRowVersion);
}

function insertStatement(env, type, values) {
  if (type === "category") return env.DB.prepare(`
      INSERT INTO categories (name, description, sort_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(values.name, values.description || null, values.sortOrder);
  return env.DB.prepare(`
      INSERT INTO tags (name, description, is_active, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(values.name, values.description || null);
}

function tableFor(type) {
  if (type === "category") return "categories";
  if (type === "tag") return "tags";
  throw new TypeError(`지원하지 않는 기준정보 유형: ${type}`);
}
function auditAction(before, values) {
  const nextActive = values.isActive ? 1 : 0;
  return Number(before.is_active) === nextActive ? "update" : nextActive ? "reactivate" : "deactivate";
}
function actionLabel(action) { return action === "reactivate" ? "다시 사용" : action === "deactivate" ? "사용중지" : "수정"; }
function uniqueViolationMessage(error, noun) { return error.message.includes("UNIQUE") ? `같은 이름의 ${noun}가 이미 있습니다.` : error.message; }
function staleMasterResult(noun) { return { ok: false, message: `${noun}가 다른 요청에서 변경되었습니다. 새로고침 후 다시 시도하세요.` }; }
