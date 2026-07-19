import { clean } from "../../../shared/text/normalize.js";
import { createSystemAuditStatement } from "../../../data/systemAuditData.js";
import {
  DOCUMENT_CORE_COLUMNS,
  DOCUMENT_JOIN_TABLES,
  DOCUMENT_LOCATION_COLUMNS,
  uniqueViolationMessage
} from "../../../data/sqlShared.js";
import { actorDisplayName } from "../domain/policy.js";
import { createSetMutationPlan, executableStatements } from "./mutationPlans.js";

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

export async function upsertDocumentSet(env, values, actor = {}) {
  const name = clean(values.name);
  const performedBy = actorDisplayName(actor);
  if (!name) {
    return { ok: false, message: "세트 이름은 필수입니다." };
  }
  if (name.length > 100) {
    return { ok: false, message: "세트 이름은 100자 이하로 입력하세요." };
  }

  try {
    if (values.id) {
      // 이력 INSERT를 상태 변경보다 먼저 두고 같은 batch에서 실행해 이력 없는 수정과
      // 수정 없는 이력이 모두 생기지 않도록 한다.
      const statements = [
        env.DB.prepare(`
          INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
          SELECT id, ?, 'update', ?, ?
          FROM document_sets
          WHERE id = ? AND is_locked = 0
        `).bind(name, performedBy, "세트 정보 수정", values.id),
        env.DB.prepare(`
          UPDATE document_sets
          SET name = ?,
              description = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND is_locked = 0
        `).bind(name, clean(values.description) || null, values.id)
      ];
      const results = await env.DB.batch(executableStatements(createSetMutationPlan("update", statements)));

      if (Number(results[1]?.meta?.changes || 0) === 0) {
        const current = await getDocumentSet(env, values.id);
        return { ok: false, message: current?.is_locked ? "잠긴 세트는 정보를 수정할 수 없습니다." : "세트를 찾을 수 없습니다." };
      }

      return { ok: true, id: values.id };
    }

    // 생성 ID는 INSERT의 RETURNING 결과로 받고, 생성과 생성 이력을 한 batch에 둔다.
    // 생성 이력은 새 ID가 있어야 기록할 수 있으므로 이 경우에만 INSERT 다음에 위치한다.
    const statements = [
      env.DB.prepare(`
        INSERT INTO document_sets (name, description, created_by, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        RETURNING id
      `).bind(name, clean(values.description) || null, performedBy),
      env.DB.prepare(`
        INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
        SELECT id, name, 'create', ?, ?
        FROM document_sets
        WHERE name = ?
      `).bind(performedBy, "세트 생성", name)
    ];
    const results = await env.DB.batch(executableStatements(createSetMutationPlan("create", statements, "unique:set-name")));
    const id = Number(results[0]?.results?.[0]?.id || results[0]?.meta?.last_row_id || 0);
    if (!id) {
      throw new Error("생성한 세트를 확인할 수 없습니다.");
    }
    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      message: uniqueViolationMessage(error, "세트")
    };
  }
}

export async function deleteDocumentSet(env, id, actor = {}) {
  const set = await getDocumentSet(env, id);
  if (!set) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }
  if (Number(set.is_locked) === 1) {
    return { ok: false, message: "잠긴 세트는 삭제할 수 없습니다." };
  }

  // 삭제 이력(document_set_logs)을 삭제와 하나의 batch로 원자화한다. 로그는 세트가 아직 존재할 때만
  // 기록되도록 가드하여, 세트만 사라지고 삭제 기록이 없는 이력 공백을 막는다.
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT ?, ?, 'delete', ?, ?
      FROM document_sets
      WHERE id = ? AND is_locked = 0
    `).bind(id, set.name || "이름 없는 세트", actorDisplayName(actor), "세트 삭제", id),
    env.DB.prepare(`
      DELETE FROM document_set_items
      WHERE set_id = ?
        AND EXISTS (SELECT 1 FROM document_sets WHERE id = ? AND is_locked = 0)
    `).bind(id, id),
    env.DB.prepare("DELETE FROM document_sets WHERE id = ? AND is_locked = 0").bind(id)
  ];
  const results = await env.DB.batch(executableStatements(createSetMutationPlan("delete", statements)));

  if (results[results.length - 1].meta.changes === 0) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }

  return { ok: true };
}

export async function addDocumentsToSet(env, setId, documentIds, actor = {}) {
  const ids = [...new Set(documentIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return { added: 0 };
  }

  const addable = await getAddableSetDocuments(env, setId, ids);
  if (!addable.length) {
    return { added: 0 };
  }

  const addableIds = addable.map((row) => Number(row.id));
  const requestedRows = addableIds.map(() => "(?)").join(", ");
  const details = `문서 ${addableIds.length}건 추가: ${summarizeNumbers(addable.map((row) => row.document_number))}`;

  // 후보 확인은 사용자에게 남길 문서번호를 만들기 위한 읽기다. 실제 batch의 각 문장은
  // 동일한 미등록 문서 가드를 다시 검사하므로, 읽기와 batch 사이에 상태가 바뀌어도
  // 로그·touch·연결이 따로 반영되지 않는다.
  const statements = [
    env.DB.prepare(`
      WITH requested(document_id) AS (VALUES ${requestedRows})
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT s.id, s.name, 'add', ?, ?
      FROM document_sets s
      WHERE s.id = ? AND s.is_locked = 0
        AND EXISTS (
          SELECT 1
          FROM requested requested
          JOIN documents d ON d.id = requested.document_id
          LEFT JOIN document_set_items i ON i.set_id = s.id AND i.document_id = d.id
          WHERE i.document_id IS NULL
        )
    `).bind(...addableIds, actorDisplayName(actor), details, setId),
    env.DB.prepare(`
      WITH requested(document_id) AS (VALUES ${requestedRows})
      UPDATE document_sets
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_locked = 0
        AND EXISTS (
          SELECT 1
          FROM requested requested
          JOIN documents d ON d.id = requested.document_id
          LEFT JOIN document_set_items i ON i.set_id = document_sets.id AND i.document_id = d.id
          WHERE i.document_id IS NULL
        )
    `).bind(...addableIds, setId),
    // 최대 200개 ID도 한 INSERT statement로 처리해 요청당 D1 statement 예산을 지킨다.
    env.DB.prepare(`
      WITH requested(document_id) AS (VALUES ${requestedRows})
      INSERT OR IGNORE INTO document_set_items (set_id, document_id)
      SELECT s.id, d.id
      FROM requested requested
      JOIN documents d ON d.id = requested.document_id
      JOIN document_sets s ON s.id = ? AND s.is_locked = 0
      RETURNING document_id
    `).bind(...addableIds, setId)
  ];
  const results = await env.DB.batch(executableStatements(createSetMutationPlan("add", statements)));
  const insertResult = results[2] || {};
  const added = Number(insertResult.meta?.changes || insertResult.results?.length || 0);
  return { added };
}

export async function removeDocumentFromSet(env, setId, documentId, actor = {}) {
  const target = await env.DB.prepare(`
    SELECT s.name AS set_name, d.document_number
    FROM document_set_items i
    JOIN document_sets s ON s.id = i.set_id AND s.is_locked = 0
    JOIN documents d ON d.id = i.document_id
    WHERE i.set_id = ? AND i.document_id = ?
  `).bind(setId, documentId).first();
  if (!target) {
    return { ok: false, message: "세트에서 해당 문서를 찾을 수 없습니다." };
  }

  const statements = [
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT s.id, s.name, 'remove', ?, ?
      FROM document_sets s
      JOIN document_set_items i ON i.set_id = s.id AND i.document_id = ?
      WHERE s.id = ? AND s.is_locked = 0
    `).bind(actorDisplayName(actor), `문서 제외: ${target.document_number ?? `문서 ID ${documentId}`}`, documentId, setId),
    env.DB.prepare(`
      UPDATE document_sets
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_locked = 0
        AND EXISTS (
          SELECT 1 FROM document_set_items
          WHERE set_id = ? AND document_id = ?
        )
    `).bind(setId, setId, documentId),
    env.DB.prepare(`
      DELETE FROM document_set_items
      WHERE set_id = ? AND document_id = ?
        AND EXISTS (SELECT 1 FROM document_sets WHERE id = ? AND is_locked = 0)
    `).bind(setId, documentId, setId)
  ];
  const results = await env.DB.batch(executableStatements(createSetMutationPlan("remove", statements)));

  if (Number(results[2]?.meta?.changes || 0) === 0) {
    return { ok: false, message: "세트에서 해당 문서를 찾을 수 없습니다." };
  }
  return { ok: true };
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

async function getAddableSetDocuments(env, setId, ids) {
  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT d.id, d.document_number
    FROM documents d
    JOIN document_sets s ON s.id = ? AND s.is_locked = 0
    LEFT JOIN document_set_items i ON i.set_id = s.id AND i.document_id = d.id
    WHERE d.id IN (${placeholders}) AND i.document_id IS NULL
    ORDER BY d.document_number, d.id
  `).bind(setId, ...ids).all();

  return (result.results ?? []).filter((row) => Number.isInteger(Number(row.id)) && Number(row.id) > 0);
}

function summarizeNumbers(numbers, max = 30) {
  if (numbers.length <= max) {
    return numbers.join(", ");
  }
  return `${numbers.slice(0, max).join(", ")} 외 ${numbers.length - max}건`;
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

  const statements = [
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
  ];
  const results = await env.DB.batch(executableStatements(createSetMutationPlan(nextLocked ? "lock" : "unlock", statements, guardSql)));

  if (Number(results[2]?.meta?.changes || 0) === 0) {
    return { ok: false, message: "세트 잠금 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }
  return { ok: true };
}
