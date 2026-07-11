import { clean } from "../utils.js";
import { uniqueViolationMessage } from "./sqlShared.js";

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
async function upsertMaster(env, values, spec) {
  const name = clean(values.name);
  if (!name) {
    return { ok: false, message: `${spec.noun} 이름은 필수입니다.` };
  }

  try {
    if (values.id) {
      const update = spec.update(name);
      const result = await env.DB.prepare(update.sql).bind(...update.binds).run();

      return result.meta.changes > 0 ? { ok: true } : { ok: false, message: `${spec.noun}를 찾을 수 없습니다.` };
    }

    const insert = spec.insert(name);
    await env.DB.prepare(insert.sql).bind(...insert.binds).run();

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: uniqueViolationMessage(error, spec.noun)
    };
  }
}

async function softDeleteMaster(env, id, table, noun) {
  const result = await env.DB.prepare(`
    UPDATE ${table}
    SET is_active = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(id).run();

  return result.meta.changes > 0 ? { ok: true } : { ok: false, message: `${noun}를 찾을 수 없습니다.` };
}

export async function upsertCategory(env, values) {
  const sortOrder = Number.isFinite(values.sortOrder) ? values.sortOrder : 0;

  return upsertMaster(env, values, {
    noun: "카테고리",
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

export async function deleteCategory(env, id) {
  return softDeleteMaster(env, id, "categories", "카테고리");
}

export async function upsertTag(env, values) {
  return upsertMaster(env, values, {
    noun: "태그",
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

export async function deleteTag(env, id) {
  return softDeleteMaster(env, id, "tags", "태그");
}
