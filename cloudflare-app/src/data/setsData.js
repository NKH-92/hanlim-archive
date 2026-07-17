import { clean } from "../utils.js";
import { createSystemAuditStatement } from "./systemAuditData.js";
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
      s.is_locked,
      s.locked_at,
      s.locked_by_name,
      s.lock_reason,
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
    SELECT id, name, description, created_by, created_at, updated_at,
      is_locked, locked_at, locked_by_user_id, locked_by_name, lock_reason
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
        WHERE id = ? AND is_locked = 0
      `).bind(name, clean(values.description) || null, values.id).run();

      if (result.meta.changes === 0) {
        const current = await getDocumentSet(env, values.id);
        return { ok: false, message: current?.is_locked ? "잠긴 세트는 정보를 수정할 수 없습니다." : "세트를 찾을 수 없습니다." };
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
  if (Number(set.is_locked) === 1) {
    return { ok: false, message: "잠긴 세트는 삭제할 수 없습니다." };
  }

  // 삭제 이력(document_set_logs)을 삭제와 하나의 batch로 원자화한다. 로그는 세트가 아직 존재할 때만
  // 기록되도록 가드하여, 세트만 사라지고 삭제 기록이 없는 이력 공백을 막는다.
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT ?, ?, 'delete', ?, ?
      FROM document_sets
      WHERE id = ? AND is_locked = 0
    `).bind(id, set.name || "이름 없는 세트", actor || "알 수 없음", "세트 삭제", id),
    env.DB.prepare(`
      DELETE FROM document_set_items
      WHERE set_id = ?
        AND EXISTS (SELECT 1 FROM document_sets WHERE id = ? AND is_locked = 0)
    `).bind(id, id),
    env.DB.prepare("DELETE FROM document_sets WHERE id = ? AND is_locked = 0").bind(id)
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

  const requestedRows = ids.map(() => "(?)").join(", ");
  // 최대 200개 ID도 한 INSERT statement로 처리해 요청당 D1 statement 예산을 지킨다.
  const results = await env.DB.batch([env.DB.prepare(`
    WITH requested(document_id) AS (VALUES ${requestedRows})
    INSERT OR IGNORE INTO document_set_items (set_id, document_id)
    SELECT s.id, d.id
    FROM requested requested
    JOIN documents d ON d.id = requested.document_id
    JOIN document_sets s ON s.id = ? AND s.is_locked = 0
    RETURNING document_id
  `).bind(...ids, setId)]);
  const insertResult = results[0] || {};
  const added = Number(insertResult.meta?.changes || insertResult.results?.length || 0);
  const returnedIds = (insertResult.results || [])
    .map((row) => Number(row.document_id))
    .filter((id) => Number.isInteger(id) && id > 0);
  // 오래된 D1/mock가 RETURNING rows를 제공하지 않아도 changes 수만큼 보수적으로 기록한다.
  const addedIds = returnedIds.length ? returnedIds : ids.slice(0, added);

  if (added > 0) {
    await touchDocumentSet(env, setId);

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
      AND EXISTS (SELECT 1 FROM document_sets WHERE id = ? AND is_locked = 0)
  `).bind(setId, documentId, setId).run();

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

export async function setDocumentSetLock(env, setId, locked, reason, actor = {}) {
  const id = Number(setId);
  const cleanReason = clean(reason);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }
  if (!cleanReason) {
    return { ok: false, message: locked ? "잠금 사유를 입력하세요." : "잠금 해제 사유를 입력하세요." };
  }
  if (cleanReason.length > 500) {
    return { ok: false, message: "잠금 사유는 500자 이하로 입력하세요." };
  }

  const set = await getDocumentSet(env, id);
  if (!set) return { ok: false, message: "세트를 찾을 수 없습니다." };
  const nextLocked = locked ? 1 : 0;
  const previousLocked = nextLocked ? 0 : 1;
  if (Number(set.is_locked) === nextLocked) {
    return { ok: true, unchanged: true };
  }
  const actorId = Number(actor.userId ?? actor.user_id ?? actor.id);
  const safeActorId = Number.isInteger(actorId) && actorId > 0 ? actorId : null;
  const actorName = clean(actor.displayName ?? actor.display_name) || clean(actor.username) || "알 수 없음";
  const label = nextLocked ? "잠금" : "잠금 해제";
  const details = { before: { isLocked: Boolean(previousLocked) }, after: { isLocked: Boolean(nextLocked) }, reason: cleanReason };
  const guardSql = "FROM document_sets WHERE id = ? AND is_locked = ?";
  const guardBinds = [id, previousLocked];

  const results = await env.DB.batch([
    // 0010의 append-only CHECK 계약을 유지하기 위해 세트 이력 action은 update를 사용하고
    // 상세 문자열에서 잠금/해제를 구분한다.
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT id, name, 'update', ?, ?
      FROM document_sets
      WHERE id = ? AND is_locked = ?
    `).bind(actorName, `${label}: ${cleanReason}`, ...guardBinds),
    createSystemAuditStatement(env, {
      entityType: "document_set",
      entityId: id,
      entityReference: set.name,
      action: nextLocked ? "lock" : "unlock",
      actor,
      summary: `문서 세트 ${label}`,
      details
    }, { guardSql, guardBinds }),
    env.DB.prepare(`
      UPDATE document_sets
      SET is_locked = ?,
          locked_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
          locked_by_user_id = CASE WHEN ? = 1 THEN ? ELSE NULL END,
          locked_by_name = CASE WHEN ? = 1 THEN ? ELSE NULL END,
          lock_reason = CASE WHEN ? = 1 THEN ? ELSE NULL END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_locked = ?
    `).bind(
      nextLocked,
      nextLocked,
      nextLocked,
      safeActorId,
      nextLocked,
      actorName,
      nextLocked,
      cleanReason,
      ...guardBinds
    )
  ]);

  if (Number(results[2]?.meta?.changes || 0) === 0) {
    return { ok: false, message: "세트 잠금 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }
  return { ok: true };
}
