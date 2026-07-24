import { clean } from "../../../shared/text/normalize.js";
import { createSystemAuditStatement } from "../../audit/index.js";
import {
  DOCUMENT_CORE_COLUMNS,
  DOCUMENT_JOIN_TABLES,
  DOCUMENT_LOCATION_COLUMNS,
  uniqueViolationMessage
} from "../../../data/sqlShared.js";
import { actorDisplayName } from "../domain/policy.js";
import { createSetMutationPlan } from "./mutationPlans.js";
import { isExpectedChangeAbort } from "../../../platform/d1/expectedChange.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { auditActorSnapshot } from "../../identity/index.js";

async function runSetMutationBatch(env, plan) {
  try {
    return { ok: true, results: await executeMutationBatch(env, plan) };
  } catch (error) {
    if (isExpectedChangeAbort(error)) {
      return { ok: false, stale: true, error };
    }
    throw error;
  }
}

export async function getDocumentSets(env, filters = {}) {
  const query = clean(filters.q);
  const status = ["editable", "locked", "disposed", "excluded"].includes(clean(filters.status))
    ? clean(filters.status)
    : "all";
  const sort = ["updated", "name", "created"].includes(clean(filters.sort))
    ? clean(filters.sort)
    : "updated";
  const where = [];
  const binds = [];
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(s.name LIKE ? ESCAPE '\\' OR COALESCE(s.description, '') LIKE ? ESCAPE '\\')");
    binds.push(pattern, pattern);
  }
  if (status === "editable") where.push("s.is_locked = 0");
  if (status === "locked") where.push("s.is_locked = 1");
  const having = status === "disposed"
    ? "HAVING SUM(CASE WHEN d.status = 'disposed' THEN 1 ELSE 0 END) > 0"
    : status === "excluded"
      ? "HAVING SUM(CASE WHEN d.sync_state = 'excluded' THEN 1 ELSE 0 END) > 0"
      : "";
  const order = sort === "name"
    ? "s.name COLLATE NOCASE, s.id"
    : sort === "created"
      ? "s.created_at DESC, s.id DESC"
      : "s.updated_at DESC, s.id DESC";
  const result = await env.DB.prepare(`
    SELECT
      s.id,
      s.name,
      s.description,
      s.row_version,
      s.is_locked,
      s.locked_at,
      s.locked_by_name,
      s.lock_reason,
      s.created_at,
      s.updated_at,
      COUNT(i.document_id) AS document_count,
      SUM(CASE WHEN d.sync_state = 'current' THEN 1 ELSE 0 END) AS current_count,
      SUM(CASE WHEN d.sync_state = 'excluded' THEN 1 ELSE 0 END) AS excluded_count,
      SUM(CASE WHEN d.status = 'disposed' THEN 1 ELSE 0 END) AS disposed_count
    FROM document_sets s
    LEFT JOIN document_set_items i ON i.set_id = s.id
    LEFT JOIN documents d ON d.id = i.document_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY s.id
    ${having}
    ORDER BY ${order}
  `).bind(...binds).all();

  return result.results ?? [];
}

export async function cloneDocumentSet(env, sourceId, values = {}, actor = {}) {
  const id = Number(sourceId);
  const expectedVersion = positiveVersion(values.expectedRowVersion ?? values.rowVersion);
  const name = clean(values.name);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "복제할 세트를 찾을 수 없습니다." };
  if (!expectedVersion) return staleSetResult();
  if (!name) return { ok: false, message: "새 세트 이름은 필수입니다." };
  if (name.length > 100) return { ok: false, message: "새 세트 이름은 100자 이하로 입력하세요." };

  const source = await getDocumentSet(env, id);
  if (!source) return { ok: false, message: "복제할 세트를 찾을 수 없습니다." };
  if (Number(source.row_version) !== expectedVersion) return staleSetResult();
  const performedBy = actorDisplayName(actor);
  const snapshot = auditActorSnapshot(actor);
  const details = JSON.stringify({
    sourceSetId: id,
    sourceSetName: source.name,
    sourceRowVersion: expectedVersion
  });
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_sets (name, description, created_by, is_locked, updated_at)
      SELECT ?, description, ?, 0, CURRENT_TIMESTAMP
      FROM document_sets
      WHERE id = ? AND row_version = ?
      RETURNING id
    `).bind(name, performedBy, id, expectedVersion),
    env.DB.prepare(`
      INSERT INTO document_set_items (set_id, document_id)
      SELECT clone.id, item.document_id
      FROM document_sets clone
      JOIN document_sets source ON source.id = ? AND source.row_version = ?
      JOIN document_set_items item ON item.set_id = source.id
      WHERE clone.name = ?
    `).bind(id, expectedVersion, name),
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT clone.id, clone.name, 'create', ?, ?
      FROM document_sets clone
      JOIN document_sets source ON source.id = ? AND source.row_version = ?
      WHERE clone.name = ?
    `).bind(performedBy, `세트 복제: ${source.name}`, id, expectedVersion, name),
    env.DB.prepare(`
      INSERT INTO system_audit_logs (
        entity_type, entity_id, entity_reference, action,
        actor_user_id, actor_username_snapshot, actor_display_name_snapshot,
        actor_permissions_snapshot, summary, details_json
      )
      SELECT
        'document_set', CAST(clone.id AS TEXT), clone.name, 'clone',
        ?, ?, ?, ?, '준비 문서 세트 복제', ?
      FROM document_sets clone
      JOIN document_sets source ON source.id = ? AND source.row_version = ?
      WHERE clone.name = ?
    `).bind(
      snapshot.userId,
      snapshot.username,
      snapshot.displayName,
      JSON.stringify(snapshot.permissions),
      details,
      id,
      expectedVersion,
      name
    )
  ];

  try {
    const ran = await runSetMutationBatch(env, createSetMutationPlan("clone", statements));
    if (!ran.ok) return staleSetResult();
    const cloneId = Number(ran.results[0]?.results?.[0]?.id || ran.results[0]?.meta?.last_row_id || 0);
    if (!cloneId) return staleSetResult();
    return { ok: true, id: cloneId };
  } catch (error) {
    return { ok: false, message: uniqueViolationMessage(error, "세트") };
  }
}

export async function getDocumentSet(env, id) {
  return env.DB.prepare(`
    SELECT id, name, description, created_by, created_at, updated_at, row_version,
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
      const expectedRowVersion = positiveVersion(values.expectedRowVersion ?? values.rowVersion);
      if (!expectedRowVersion) return staleSetResult();
      // 이력 INSERT를 상태 변경보다 먼저 두고 같은 batch에서 실행해 이력 없는 수정과
      // 수정 없는 이력이 모두 생기지 않도록 한다.
      const statements = [
        env.DB.prepare(`
          INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
          SELECT id, ?, 'update', ?, ?
          FROM document_sets
          WHERE id = ? AND is_locked = 0 AND row_version = ?
        `).bind(name, performedBy, "세트 정보 수정", values.id, expectedRowVersion),
        env.DB.prepare(`
          UPDATE document_sets
          SET name = ?,
              description = ?,
              updated_at = CURRENT_TIMESTAMP,
              row_version = row_version + 1
          WHERE id = ? AND is_locked = 0 AND row_version = ?
        `).bind(name, clean(values.description) || null, values.id, expectedRowVersion)
      ];
      const ran = await runSetMutationBatch(env, createSetMutationPlan("update", statements));
      if (!ran.ok) {
        const current = await getDocumentSet(env, values.id);
        return current?.is_locked ? { ok: false, message: "잠긴 세트는 정보를 수정할 수 없습니다." } : staleSetResult();
      }
      if (Number(ran.results[1]?.meta?.changes || 0) === 0) {
        const current = await getDocumentSet(env, values.id);
        return current?.is_locked ? { ok: false, message: "잠긴 세트는 정보를 수정할 수 없습니다." } : staleSetResult();
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
    const results = await executeMutationBatch(env, createSetMutationPlan("create", statements, "unique:set-name"));
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

export async function deleteDocumentSet(env, id, actor = {}, expectedRowVersion = 0) {
  const set = await getDocumentSet(env, id);
  if (!set) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }
  if (Number(set.is_locked) === 1) {
    return { ok: false, message: "잠긴 세트는 삭제할 수 없습니다." };
  }
  const expectedVersion = positiveVersion(expectedRowVersion);
  if (!expectedVersion || Number(set.row_version) !== expectedVersion) return staleSetResult();

  // 삭제 이력(document_set_logs)을 삭제와 하나의 batch로 원자화한다. 로그는 세트가 아직 존재할 때만
  // 기록되도록 가드하여, 세트만 사라지고 삭제 기록이 없는 이력 공백을 막는다.
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT ?, ?, 'delete', ?, ?
      FROM document_sets
      WHERE id = ? AND is_locked = 0 AND row_version = ?
    `).bind(id, set.name || "이름 없는 세트", actorDisplayName(actor), "세트 삭제", id, expectedVersion),
    env.DB.prepare(`
      DELETE FROM document_set_items
      WHERE set_id = ?
        AND EXISTS (SELECT 1 FROM document_sets WHERE id = ? AND is_locked = 0 AND row_version = ?)
    `).bind(id, id, expectedVersion),
    env.DB.prepare("DELETE FROM document_sets WHERE id = ? AND is_locked = 0 AND row_version = ?").bind(id, expectedVersion)
  ];
  const ran = await runSetMutationBatch(env, createSetMutationPlan("delete", statements));
  if (!ran.ok) {
    const current = await getDocumentSet(env, id);
    return current?.is_locked ? { ok: false, message: "잠긴 세트는 삭제할 수 없습니다." } : staleSetResult();
  }
  if (Number(ran.results[2]?.meta?.changes || 0) === 0) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }

  return { ok: true };
}

export async function addDocumentsToSet(env, setId, documentIds, actor = {}, expectedRowVersion = 0) {
  const ids = [...new Set(documentIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return { added: 0 };
  }
  const expectedVersion = positiveVersion(expectedRowVersion);
  if (!expectedVersion) return { added: 0, ...staleSetResult() };

  const requestedIds = JSON.stringify(ids);
  const addability = await getSetAddability(env, setId, requestedIds);
  if (!addability) return { added: 0, ok: false, message: "세트를 찾을 수 없습니다." };
  if (Number(addability.is_locked) === 1) return { added: 0, ok: false, message: "잠긴 세트에는 문서를 추가할 수 없습니다." };
  if (Number(addability.row_version) !== expectedVersion) return { added: 0, ...staleSetResult() };
  if (Number(addability.addable_count || 0) === 0) return { added: 0 };

  // 후보 확인은 사용자에게 남길 문서번호를 만들기 위한 읽기다. 실제 batch의 각 문장은
  // 동일한 미등록 문서 가드를 다시 검사하므로, 읽기와 batch 사이에 상태가 바뀌어도
  // 로그·touch·연결이 따로 반영되지 않는다.
  const statements = [
    env.DB.prepare(`
      WITH requested(document_id) AS (
        SELECT CAST(value AS INTEGER)
        FROM json_each(?)
      ),
      eligible AS (
        SELECT d.id, d.document_number
        FROM requested requested
        JOIN documents d ON d.id = requested.document_id AND d.sync_state = 'current'
        JOIN document_sets s ON s.id = ? AND s.is_locked = 0 AND s.row_version = ?
        LEFT JOIN document_set_items i ON i.set_id = s.id AND i.document_id = d.id
        WHERE i.document_id IS NULL
        ORDER BY d.document_number, d.id
      )
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT
        s.id,
        s.name,
        'add',
        ?,
        '문서 ' || COUNT(*) || '건 추가: ' || GROUP_CONCAT(eligible.document_number, ', ')
      FROM document_sets s
      JOIN eligible ON 1 = 1
      WHERE s.id = ? AND s.is_locked = 0 AND s.row_version = ?
      GROUP BY s.id, s.name
    `).bind(requestedIds, setId, expectedVersion, actorDisplayName(actor), setId, expectedVersion),
    env.DB.prepare(`
      WITH requested(document_id) AS (
        SELECT CAST(value AS INTEGER)
        FROM json_each(?)
      )
      UPDATE document_sets
      SET updated_at = CURRENT_TIMESTAMP,
          row_version = row_version + 1
      WHERE id = ? AND is_locked = 0 AND row_version = ?
        AND EXISTS (
          SELECT 1
          FROM requested requested
          JOIN documents d ON d.id = requested.document_id AND d.sync_state = 'current'
          LEFT JOIN document_set_items i ON i.set_id = document_sets.id AND i.document_id = d.id
          WHERE i.document_id IS NULL
        )
    `).bind(requestedIds, setId, expectedVersion),
    // 최대 200개 ID도 한 INSERT statement로 처리해 요청당 D1 statement 예산을 지킨다.
    env.DB.prepare(`
      WITH requested(document_id) AS (
        SELECT CAST(value AS INTEGER)
        FROM json_each(?)
      )
      INSERT OR IGNORE INTO document_set_items (set_id, document_id)
      SELECT s.id, d.id
      FROM requested requested
      JOIN documents d ON d.id = requested.document_id AND d.sync_state = 'current'
      JOIN document_sets s ON s.id = ? AND s.is_locked = 0 AND s.row_version = ?
      LEFT JOIN document_set_items i ON i.set_id = s.id AND i.document_id = d.id
      WHERE i.document_id IS NULL
      RETURNING document_id
    `).bind(requestedIds, setId, expectedVersion + 1)
  ];
  const ran = await runSetMutationBatch(env, createSetMutationPlan("add", statements));
  if (!ran.ok) return { added: 0, ...staleSetResult() };
  const insertResult = ran.results[3] || {};
  const added = Number(insertResult.meta?.changes || insertResult.results?.length || 0);
  return { added };
}

async function getSetAddability(env, setId, requestedIds) {
  return env.DB.prepare(`
    WITH requested(document_id) AS (
      SELECT CAST(value AS INTEGER)
      FROM json_each(?)
    )
    SELECT
      s.id,
      s.is_locked,
      s.row_version,
      COALESCE(SUM(CASE
        WHEN d.id IS NOT NULL AND d.sync_state = 'current' AND i.document_id IS NULL THEN 1
        ELSE 0
      END), 0) AS addable_count
    FROM document_sets s
    CROSS JOIN requested requested
    LEFT JOIN documents d ON d.id = requested.document_id
    LEFT JOIN document_set_items i ON i.set_id = s.id AND i.document_id = d.id
    WHERE s.id = ?
    GROUP BY s.id, s.is_locked, s.row_version
  `).bind(requestedIds, setId).first();
}

export async function removeDocumentFromSet(env, setId, documentId, actor = {}, expectedRowVersion = 0) {
  const expectedVersion = positiveVersion(expectedRowVersion);
  if (!expectedVersion) return staleSetResult();
  const target = await env.DB.prepare(`
    SELECT s.name AS set_name, s.row_version, d.document_number
    FROM document_set_items i
    JOIN document_sets s ON s.id = i.set_id AND s.is_locked = 0
    JOIN documents d ON d.id = i.document_id
    WHERE i.set_id = ? AND i.document_id = ?
  `).bind(setId, documentId).first();
  if (!target) {
    return { ok: false, message: "세트에서 해당 문서를 찾을 수 없습니다." };
  }
  if (Number(target.row_version) !== expectedVersion) return staleSetResult();

  const statements = [
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT s.id, s.name, 'remove', ?, ?
      FROM document_sets s
      JOIN document_set_items i ON i.set_id = s.id AND i.document_id = ?
      WHERE s.id = ? AND s.is_locked = 0 AND s.row_version = ?
    `).bind(actorDisplayName(actor), `문서 제외: ${target.document_number ?? `문서 ID ${documentId}`}`, documentId, setId, expectedVersion),
    env.DB.prepare(`
      UPDATE document_sets
      SET updated_at = CURRENT_TIMESTAMP,
          row_version = row_version + 1
      WHERE id = ? AND is_locked = 0 AND row_version = ?
        AND EXISTS (
          SELECT 1 FROM document_set_items
          WHERE set_id = ? AND document_id = ?
        )
    `).bind(setId, expectedVersion, setId, documentId),
    env.DB.prepare(`
      DELETE FROM document_set_items
      WHERE set_id = ? AND document_id = ?
        AND EXISTS (SELECT 1 FROM document_sets WHERE id = ? AND is_locked = 0 AND row_version = ?)
    `).bind(setId, documentId, setId, expectedVersion + 1)
  ];
  const ran = await runSetMutationBatch(env, createSetMutationPlan("remove", statements));
  if (!ran.ok || Number(ran.results[3]?.meta?.changes || 0) === 0) {
    return staleSetResult();
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

export async function setDocumentSetLock(env, setId, locked, reason, actor = {}, expectedRowVersion = 0) {
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
  const expectedVersion = positiveVersion(expectedRowVersion);
  if (!expectedVersion || Number(set.row_version) !== expectedVersion) return staleSetResult();
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
  const guardSql = "FROM document_sets WHERE id = ? AND is_locked = ? AND row_version = ?";
  const guardBinds = [id, previousLocked, expectedVersion];

  const statements = [
    // 0010의 append-only CHECK 계약을 유지하기 위해 세트 이력 action은 update를 사용하고
    // 상세 문자열에서 잠금/해제를 구분한다.
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT id, name, 'update', ?, ?
      FROM document_sets
      WHERE id = ? AND is_locked = ? AND row_version = ?
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
          updated_at = CURRENT_TIMESTAMP,
          row_version = row_version + 1
      WHERE id = ? AND is_locked = ? AND row_version = ?
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
  const ran = await runSetMutationBatch(env, createSetMutationPlan(nextLocked ? "lock" : "unlock", statements, guardSql));
  if (!ran.ok || Number(ran.results[2]?.meta?.changes || 0) === 0) {
    return { ok: false, message: "세트 잠금 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }
  return { ok: true };
}

function positiveVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function staleSetResult() {
  return { ok: false, message: "세트가 다른 요청에서 변경되었습니다. 새로고침 후 다시 시도하세요." };
}
