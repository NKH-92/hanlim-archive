import { clean } from "../utils.js";
import { uniqueViolationMessage } from "./sqlShared.js";
import { createSystemAuditStatement } from "./systemAuditData.js";

export async function getCategories(env) {
  const result = await env.DB.prepare(`
    SELECT id, name, description, sort_order, is_active
    FROM categories
    ORDER BY sort_order, name
  `).all();

  return result.results ?? [];
}

export async function getActiveCategories(env) {
  const result = await env.DB.prepare(`
    SELECT id, name
    FROM categories
    WHERE is_active = 1
    ORDER BY sort_order, name
  `).all();

  return result.results ?? [];
}

export async function getTags(env) {
  const result = await env.DB.prepare(`
    SELECT id, name, description, is_active
    FROM tags
    ORDER BY name
  `).all();

  return result.results ?? [];
}

export async function getActiveTags(env) {
  const result = await env.DB.prepare(`
    SELECT id, name
    FROM tags
    WHERE is_active = 1
    ORDER BY name
  `).all();

  return result.results ?? [];
}

// 카테고리/태그 공통 upsert. spec.update/insert가 이름 검증 통과 후의 SQL과 바인딩을 결정한다.
// (SQL 문자열 들여쓰기는 기존 인라인 버전과 바이트 동일하게 유지)
async function upsertMaster(env, values, actor, spec) {
  const name = clean(values.name);
  if (!name) {
    return { ok: false, message: `${spec.noun} 이름은 필수입니다.` };
  }

  try {
    if (values.id) {
      const before = await env.DB.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).bind(values.id).first();
      if (!before) return { ok: false, message: `${spec.noun}를 찾을 수 없습니다.` };
      const update = spec.update(name);
      const nextActive = values.isActive ? 1 : 0;
      const action = Number(before.is_active) !== nextActive
        ? (nextActive ? "reactivate" : "deactivate")
        : "update";
      const results = await env.DB.batch([
        createSystemAuditStatement(env, {
          entityType: spec.entityType,
          entityId: values.id,
          entityReference: before.name,
          action,
          actor,
          summary: `${spec.noun} ${action === "reactivate" ? "다시 사용" : action === "deactivate" ? "사용중지" : "수정"}`,
          details: { before: spec.snapshot(before), after: spec.nextSnapshot(values, name) }
        }, { guardSql: `FROM ${spec.table} WHERE id = ?`, guardBinds: [values.id] }),
        env.DB.prepare(update.sql).bind(...update.binds)
      ]);
      const result = results[1];

      return result.meta.changes > 0 ? { ok: true } : { ok: false, message: `${spec.noun}를 찾을 수 없습니다.` };
    }

    const insert = spec.insert(name);
    await env.DB.batch([
      env.DB.prepare(insert.sql).bind(...insert.binds),
      createSystemAuditStatement(env, {
        entityType: spec.entityType,
        entityReference: name,
        action: "create",
        actor,
        summary: `${spec.noun} 생성`,
        details: { after: spec.nextSnapshot({ ...values, isActive: true }, name) }
      }, { guardSql: `FROM ${spec.table} WHERE name = ?`, guardBinds: [name] })
    ]);

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: uniqueViolationMessage(error, spec.noun)
    };
  }
}

async function softDeleteMaster(env, id, actor, { table, noun, entityType, snapshot }) {
  const before = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!before) return { ok: false, message: `${noun}를 찾을 수 없습니다.` };
  if (Number(before.is_active) === 0) return { ok: true };
  const guardSql = `FROM ${table} WHERE id = ? AND is_active = 1`;
  const results = await env.DB.batch([
    createSystemAuditStatement(env, {
      entityType,
      entityId: id,
      entityReference: before.name,
      action: "deactivate",
      actor,
      summary: `${noun} 사용중지`,
      details: { before: snapshot(before), after: { ...snapshot(before), isActive: false } }
    }, { guardSql, guardBinds: [id] }),
    env.DB.prepare(`
      UPDATE ${table}
      SET is_active = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_active = 1
    `).bind(id)
  ]);
  const result = results[1];

  return result.meta.changes > 0 ? { ok: true } : { ok: false, message: `${noun}를 찾을 수 없습니다.` };
}

export async function upsertCategory(env, values, actor = {}) {
  const sortOrder = Number.isFinite(values.sortOrder) ? values.sortOrder : 0;

  return upsertMaster(env, values, actor, {
    noun: "카테고리",
    table: "categories",
    entityType: "category",
    snapshot: (row) => ({ name: row.name, description: row.description || "", sortOrder: Number(row.sort_order || 0), isActive: Boolean(row.is_active) }),
    nextSnapshot: (next, name) => ({ name, description: clean(next.description), sortOrder, isActive: Boolean(next.isActive) }),
    update: (name) => ({
      sql: `
        UPDATE categories
        SET name = ?,
            description = ?,
            sort_order = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      binds: [name, clean(values.description) || null, sortOrder, values.isActive ? 1 : 0, values.id]
    }),
    insert: (name) => ({
      sql: `
      INSERT INTO categories (name, description, sort_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    `,
      binds: [name, clean(values.description) || null, sortOrder]
    })
  });
}

export async function deleteCategory(env, id, actor = {}) {
  return softDeleteMaster(env, id, actor, {
    table: "categories",
    noun: "카테고리",
    entityType: "category",
    snapshot: (row) => ({ name: row.name, description: row.description || "", sortOrder: Number(row.sort_order || 0), isActive: Boolean(row.is_active) })
  });
}

export async function upsertTag(env, values, actor = {}) {
  return upsertMaster(env, values, actor, {
    noun: "태그",
    table: "tags",
    entityType: "tag",
    snapshot: (row) => ({ name: row.name, description: row.description || "", isActive: Boolean(row.is_active) }),
    nextSnapshot: (next, name) => ({ name, description: clean(next.description), isActive: Boolean(next.isActive) }),
    update: (name) => ({
      sql: `
        UPDATE tags
        SET name = ?,
            description = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      binds: [name, clean(values.description) || null, values.isActive ? 1 : 0, values.id]
    }),
    insert: (name) => ({
      sql: `
      INSERT INTO tags (name, description, is_active, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    `,
      binds: [name, clean(values.description) || null]
    })
  });
}

export async function deleteTag(env, id, actor = {}) {
  return softDeleteMaster(env, id, actor, {
    table: "tags",
    noun: "태그",
    entityType: "tag",
    snapshot: (row) => ({ name: row.name, description: row.description || "", isActive: Boolean(row.is_active) })
  });
}
