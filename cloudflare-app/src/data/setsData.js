import { clean } from "../utils.js";
import {
  DOCUMENT_CORE_COLUMNS,
  DOCUMENT_JOIN_TABLES,
  DOCUMENT_LOCATION_COLUMNS,
  uniqueViolationMessage
} from "./sqlShared.js";

export async function getDocumentSets(env) {
  const result = await env.DB.prepare(`
    SELECT
      s.id,
      s.name,
      s.description,
      s.created_at,
      s.updated_at,
      COUNT(i.document_id) AS document_count,
      SUM(CASE WHEN d.status = 'disposed' THEN 1 ELSE 0 END) AS disposed_count
    FROM document_sets s
    LEFT JOIN document_set_items i ON i.set_id = s.id
    LEFT JOIN documents d ON d.id = i.document_id
    GROUP BY s.id
    ORDER BY s.name
  `).all();

  return result.results ?? [];
}

export async function getDocumentSet(env, id) {
  return env.DB.prepare(`
    SELECT id, name, description, created_by, created_at, updated_at
    FROM document_sets
    WHERE id = ?
  `).bind(id).first();
}

export async function getDocumentSetDocuments(env, setId) {
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      ${DOCUMENT_CORE_COLUMNS}
      ${DOCUMENT_LOCATION_COLUMNS}
      rs.column_number,
      rs.shelf_number,
      rs.slot_code
    FROM document_set_items i
    JOIN documents d ON d.id = i.document_id
    ${DOCUMENT_JOIN_TABLES}
    WHERE i.set_id = ?
    ORDER BY r.zone_number, r.rack_number, d.rack_face, rs.column_number, rs.shelf_number, d.document_number
  `).bind(setId).all();

  return result.results ?? [];
}

export async function upsertDocumentSet(env, values, actor = "") {
  const name = clean(values.name);
  if (!name) {
    return { ok: false, message: "세트 이름은 필수입니다." };
  }
  if (name.length > 100) {
    return { ok: false, message: "세트 이름은 100자 이하로 입력하세요." };
  }

  try {
    if (values.id) {
      const result = await env.DB.prepare(`
        UPDATE document_sets
        SET name = ?,
            description = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(name, clean(values.description) || null, values.id).run();

      if (result.meta.changes === 0) {
        return { ok: false, message: "세트를 찾을 수 없습니다." };
      }

      await logDocumentSetAction(env, values.id, name, "update", actor, "세트 정보 수정");
      return { ok: true, id: values.id };
    }

    const result = await env.DB.prepare(`
      INSERT INTO document_sets (name, description, created_by, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      RETURNING id
    `).bind(name, clean(values.description) || null, actor || null).first();

    await logDocumentSetAction(env, result.id, name, "create", actor, "세트 생성");
    return { ok: true, id: result.id };
  } catch (error) {
    return {
      ok: false,
      message: uniqueViolationMessage(error, "세트")
    };
  }
}

export async function deleteDocumentSet(env, id, actor = "") {
  const set = await getDocumentSet(env, id);
  if (!set) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }

  // 삭제 이력(document_set_logs)을 삭제와 하나의 batch로 원자화한다. 로그는 세트가 아직 존재할 때만
  // 기록되도록 가드하여, 세트만 사라지고 삭제 기록이 없는 이력 공백을 막는다.
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT ?, ?, 'delete', ?, ?
      FROM document_sets
      WHERE id = ?
    `).bind(id, set.name || "이름 없는 세트", actor || "알 수 없음", "세트 삭제", id),
    env.DB.prepare("DELETE FROM document_set_items WHERE set_id = ?").bind(id),
    env.DB.prepare("DELETE FROM document_sets WHERE id = ?").bind(id)
  ]);

  if (results[results.length - 1].meta.changes === 0) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }

  return { ok: true };
}

export async function addDocumentsToSet(env, setId, documentIds, actor = "") {
  const ids = [...new Set(documentIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return { added: 0 };
  }

  const statements = ids.map((documentId) => env.DB.prepare(`
    INSERT OR IGNORE INTO document_set_items (set_id, document_id)
    SELECT s.id, d.id
    FROM document_sets s
    JOIN documents d ON d.id = ?
    WHERE s.id = ?
  `).bind(documentId, setId));
  const results = await env.DB.batch(statements);
  const added = results.reduce((sum, result) => sum + (result.meta?.changes || 0), 0);

  if (added > 0) {
    await touchDocumentSet(env, setId);

    const addedIds = ids.filter((_, index) => (results[index]?.meta?.changes || 0) > 0);
    const [set, numbers] = await Promise.all([
      getDocumentSet(env, setId),
      getDocumentNumbersByIds(env, addedIds)
    ]);
    await logDocumentSetAction(env, setId, set?.name ?? "", "add", actor, `문서 ${added}건 추가: ${summarizeNumbers(numbers)}`);
  }

  return { added };
}

export async function removeDocumentFromSet(env, setId, documentId, actor = "") {
  const result = await env.DB.prepare(`
    DELETE FROM document_set_items
    WHERE set_id = ? AND document_id = ?
  `).bind(setId, documentId).run();

  if (result.meta.changes > 0) {
    await touchDocumentSet(env, setId);

    const [set, numbers] = await Promise.all([
      getDocumentSet(env, setId),
      getDocumentNumbersByIds(env, [documentId])
    ]);
    await logDocumentSetAction(env, setId, set?.name ?? "", "remove", actor, `문서 제외: ${numbers[0] ?? `문서 ID ${documentId}`}`);
    return { ok: true };
  }

  return { ok: false, message: "세트에서 해당 문서를 찾을 수 없습니다." };
}

async function logDocumentSetAction(env, setId, setName, action, actor, details = "") {
  await env.DB.prepare(`
    INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
    VALUES (?, ?, ?, ?, ?)
  `).bind(setId, setName || "이름 없는 세트", action, actor || "알 수 없음", details || null).run();
}

export async function getDocumentSetLogs(env, setId, limit = 50) {
  const result = await env.DB.prepare(`
    SELECT id, set_name, action, actor, details, created_at
    FROM document_set_logs
    WHERE set_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(setId, Math.max(1, Math.min(Number(limit) || 50, 200))).all();

  return result.results ?? [];
}

async function getDocumentNumbersByIds(env, documentIds) {
  const ids = [...new Set(documentIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT document_number
    FROM documents
    WHERE id IN (${placeholders})
    ORDER BY document_number
  `).bind(...ids).all();

  return (result.results ?? []).map((row) => row.document_number);
}

function summarizeNumbers(numbers, max = 30) {
  if (numbers.length <= max) {
    return numbers.join(", ");
  }
  return `${numbers.slice(0, max).join(", ")} 외 ${numbers.length - max}건`;
}

async function touchDocumentSet(env, setId) {
  await env.DB.prepare(`
    UPDATE document_sets
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(setId).run();
}
