import {
  AUDIT_LOG_INSERT_WITH_ACTOR,
  DOCUMENT_BASE_JOINS,
  DOCUMENT_LOCATION_COLUMNS,
  hasChanged,
  optimisticLockClause
} from "../../../data/sqlShared.js";
import { FREE_TIER_BUDGET } from "../../../config.js";
import { clean } from "../../../shared/text/normalize.js";
import { getDocument, getDocumentTags, getDisposalLogs } from "../../../data/documentsData.js";
import { createSystemAuditStatement } from "../../audit/index.js";
import {
  createDocumentBulkDisposePlan,
  createDocumentCreatePlan,
  createDocumentPermanentDeletePlan,
  createDocumentStatusPlan,
  createDocumentUpdatePlan,
  executableStatements
} from "./mutationPlans.js";

async function getTagsByIds(env, tagIds) {
  const uniqueTagIds = [...new Set(tagIds || [])].filter((id) => Number.isInteger(id) && id > 0);

  if (!uniqueTagIds.length) {
    return [];
  }

  const placeholders = uniqueTagIds.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT id, name
    FROM tags
    WHERE id IN (${placeholders})
    ORDER BY name
  `).bind(...uniqueTagIds).all();

  return result.results ?? [];
}

async function getCategoryById(env, id) {
  return env.DB.prepare(`
    SELECT id, name, is_active
    FROM categories
    WHERE id = ?
  `).bind(id).first();
}

async function getSlotDetails(env, id) {
  return env.DB.prepare(`
    SELECT
      rs.id,
      rs.slot_code,
      rs.column_number,
      rs.shelf_number,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided,
      r.column_count,
      r.shelf_count
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE rs.id = ?
  `).bind(id).first();
}

// 상태변경(UPDATE/DELETE)과 같은 batch(트랜잭션)에서 실행하는 조건부 감사 로그.
// guardClause를 아직 만족하는 문서에만 기록되므로, 같은 조건의 가드 statement가 no-op이면
// 감사 로그도 함께 0행이 된다 — 감사기록 없는 상태변경(2차 쓰기 실패)과 유령 로그를 모두 막는다.
// 반드시 가드 UPDATE/DELETE '앞'에 두어 pre-state를 읽게 한다.
function conditionalAuditStatement(env, document, action, actor, actorRole, summary, details, guardClause, guardBinds = []) {
  const actorInfo = normalizeActor(actor, actorRole);
  return env.DB.prepare(`
    ${AUDIT_LOG_INSERT_WITH_ACTOR}
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM documents
    WHERE ${guardClause}
  `).bind(
    document.id,
    document.storage_code,
    document.document_number,
    action,
    actorInfo.displayName,
    actorInfo.role,
    actorInfo.userId,
    actorInfo.username,
    summary,
    details ? JSON.stringify(details) : null,
    ...guardBinds
  );
}

function normalizeActor(actor, fallbackRole = "Unknown") {
  if (actor && typeof actor === "object") {
    return {
      displayName: String(actor.displayName ?? actor.display_name ?? actor.username ?? "알 수 없음"),
      username: String(actor.username ?? "unknown"),
      userId: Number.isInteger(Number(actor.userId ?? actor.id)) ? Number(actor.userId ?? actor.id) : null,
      role: String(actor.role ?? fallbackRole ?? "Unknown")
    };
  }
  return {
    displayName: String(actor || "알 수 없음"),
    username: "unknown",
    userId: null,
    role: String(fallbackRole || "Unknown")
  };
}

function documentSnapshot(document, tags = []) {
  return {
    storageCode: document.storage_code,
    documentNumber: document.document_number,
    revisionNumber: document.revision_number,
    revisionDate: document.revision_date || "",
    disposalDueYear: document.disposal_due_year ?? null,
    documentName: document.document_name,
    categoryName: document.category_name,
    zoneNumber: document.zone_number,
    rackNumber: document.rack_number,
    rackCode: document.rack_code,
    columnNumber: document.column_number,
    shelfNumber: document.shelf_number,
    slotCode: document.slot_code,
    rackFace: document.rack_face,
    status: document.status,
    note: document.note || "",
    tags: tags.map((tag) => tag.name).sort()
  };
}

async function documentWithValues(env, baseDocument, values, status = baseDocument.status) {
  const [category, slot] = await Promise.all([
    getCategoryById(env, values.categoryId),
    getSlotDetails(env, values.rackSlotId)
  ]);

  return {
    ...baseDocument,
    category_id: values.categoryId,
    category_name: category?.name ?? baseDocument.category_name,
    document_number: values.documentNumber,
    revision_number: values.revisionNumber,
    revision_date: values.revisionDate || null,
    disposal_due_year: values.disposalDueYear === "" ? null : Number(values.disposalDueYear),
    document_name: values.documentName,
    note: values.note || null,
    rack_slot_id: values.rackSlotId,
    rack_face: values.rackFace,
    status,
    rack_code: slot?.rack_code ?? baseDocument.rack_code,
    zone_number: slot?.zone_number ?? baseDocument.zone_number,
    rack_number: slot?.rack_number ?? baseDocument.rack_number,
    is_single_sided: slot?.is_single_sided ?? baseDocument.is_single_sided,
    column_count: slot?.column_count ?? baseDocument.column_count,
    shelf_count: slot?.shelf_count ?? baseDocument.shelf_count,
    column_number: slot?.column_number ?? baseDocument.column_number,
    shelf_number: slot?.shelf_number ?? baseDocument.shelf_number,
    slot_code: slot?.slot_code ?? baseDocument.slot_code
  };
}

function insertDocumentTagStatementsByTempCode(env, temporaryStorageCode, tagIds) {
  return [...new Set(tagIds || [])].map((tagId) =>
    env.DB.prepare(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      SELECT id, ?
      FROM documents
      WHERE storage_code = ?
    `).bind(tagId, temporaryStorageCode)
  );
}

function createDocumentAuditStatement(env, temporaryStorageCode, actor, actorRole) {
  const actorInfo = normalizeActor(actor, actorRole);
  return env.DB.prepare(`
    ${AUDIT_LOG_INSERT_WITH_ACTOR}
    SELECT
      d.id,
      'ARC-' || printf('%06d', d.id),
      d.document_number,
      'create',
      ?,
      ?,
      ?,
      ?,
      '문서 등록',
      json_object(
        'after',
        json_object(
          'storageCode', 'ARC-' || printf('%06d', d.id),
          'documentNumber', d.document_number,
          'revisionNumber', d.revision_number,
          'revisionDate', IFNULL(d.revision_date, ''),
          'disposalDueYear', d.disposal_due_year,
          'documentName', d.document_name,
          'categoryName', c.name,
          'zoneNumber', r.zone_number,
          'rackNumber', r.rack_number,
          'rackCode', r.code,
          'columnNumber', rs.column_number,
          'shelfNumber', rs.shelf_number,
          'slotCode', rs.slot_code,
          'rackFace', d.rack_face,
          'status', d.status,
          'note', IFNULL(d.note, ''),
          'tags', COALESCE((
            SELECT json_group_array(name)
            FROM (
              SELECT t.name AS name
              FROM document_tags dt
              JOIN tags t ON t.id = dt.tag_id
              WHERE dt.document_id = d.id
              ORDER BY t.name
            )
          ), json('[]'))
        )
      )
    ${DOCUMENT_BASE_JOINS}
    WHERE d.storage_code = ?
  `).bind(
    actorInfo.displayName,
    actorInfo.role,
    actorInfo.userId,
    actorInfo.username,
    temporaryStorageCode
  );
}

export async function createDocument(env, values, actor, actorRole = "User") {
  const temporaryStorageCode = `TEMP-${crypto.randomUUID()}`;
  const statements = [
    env.DB.prepare(`
      INSERT INTO documents (
        storage_code,
        category_id,
        document_number,
        revision_number,
        revision_date,
        disposal_due_year,
        document_name,
        note,
        rack_slot_id,
        rack_face,
        status,
        updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1
        FROM documents
        WHERE UPPER(document_number) = UPPER(?)
          AND UPPER(revision_number) = UPPER(?)
      )
      RETURNING id
    `).bind(
      temporaryStorageCode,
      values.categoryId,
      values.documentNumber,
      values.revisionNumber,
      values.revisionDate || null,
      values.disposalDueYear === "" ? null : Number(values.disposalDueYear),
      values.documentName,
      values.note || null,
      values.rackSlotId,
      values.rackFace,
      values.documentNumber,
      values.revisionNumber
    ),
    ...insertDocumentTagStatementsByTempCode(env, temporaryStorageCode, values.tagIds),
    createDocumentAuditStatement(env, temporaryStorageCode, actor, actorRole),
    env.DB.prepare(`
      UPDATE documents
      SET storage_code = 'ARC-' || printf('%06d', id),
          updated_at = CURRENT_TIMESTAMP
      WHERE storage_code = ?
    `).bind(temporaryStorageCode)
  ];

  const plan = createDocumentCreatePlan(statements, statements.length - 3);
  const result = await env.DB.batch(executableStatements(plan));
  const createdId = result[0]?.results?.[0]?.id;

  if (!createdId) {
    /** @type {Error & { code?: string }} */
    const error = new Error("같은 문서번호와 개정번호가 이미 등록되어 있습니다.");
    error.code = "DUPLICATE_DOCUMENT";
    throw error;
  }

  return createdId;
}

export async function updateDocument(env, id, values, actor, actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  if (doc.status === "disposed") {
    return { ok: false, message: "폐기 상태 문서는 폐기를 해제하기 전까지 수정할 수 없습니다." };
  }

  const expectedRowVersion = Number(values.expectedRowVersion);
  if (!clean(values.expectedUpdatedAt) || !Number.isInteger(expectedRowVersion) || expectedRowVersion <= 0) {
    return { ok: false, message: "문서 수정 잠금 정보가 없습니다. 새로고침 후 다시 시도하세요." };
  }

  // 기존 내부 호출자가 위치 값을 생략해도 현재 위치를 보존한다. 명시된 값은 감사 스냅샷과
  // 실제 UPDATE에 동일하게 사용해 기록과 저장 상태가 어긋나지 않게 한다.
  const nextValues = {
    ...values,
    rackSlotId: Number.isInteger(values.rackSlotId) && values.rackSlotId > 0 ? values.rackSlotId : doc.rack_slot_id,
    rackFace: values.rackFace === "A" || values.rackFace === "B" ? values.rackFace : doc.rack_face
  };
  const [beforeTags, afterTags, updated] = await Promise.all([
    getDocumentTags(env, id),
    getTagsByIds(env, nextValues.tagIds),
    documentWithValues(env, doc, nextValues)
  ]);

  const lock = optimisticLockClause(values.expectedUpdatedAt, values.expectedRowVersion);
  const guardClause = `id = ? AND status = 'active'${lock.sql}`;
  const guardBinds = [id, ...lock.binds];
  const existsGuard = `EXISTS (SELECT 1 FROM documents WHERE ${guardClause})`;

  // 상태변경(UPDATE)·태그 교체·감사 로그를 하나의 batch(트랜잭션)로 원자화한다.
  // 모든 부수효과는 pre-state 가드에 묶여, 낙관적 잠금 실패 시 태그도 감사도 함께 no-op이 된다.
  const uniqueTagIds = [...new Set(nextValues.tagIds || [])].filter((tagId) => Number.isInteger(tagId) && tagId > 0);
  const statements = [
    conditionalAuditStatement(env, updated, "update", actor, actorRole, "문서 정보 수정", {
      before: documentSnapshot(doc, beforeTags),
      after: documentSnapshot(updated, afterTags)
    }, guardClause, guardBinds),
    env.DB.prepare(`DELETE FROM document_tags WHERE document_id = ? AND ${existsGuard}`).bind(id, ...guardBinds),
    ...uniqueTagIds.map((tagId) =>
      env.DB.prepare(`INSERT OR IGNORE INTO document_tags (document_id, tag_id) SELECT ?, ? WHERE ${existsGuard}`).bind(id, tagId, ...guardBinds)
    ),
    env.DB.prepare(`
      UPDATE documents
      SET
        category_id = ?,
        document_number = ?,
        revision_number = ?,
        revision_date = ?,
        disposal_due_year = ?,
        document_name = ?,
        note = ?,
        rack_slot_id = ?,
        rack_face = ?,
        row_version = row_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE ${guardClause}
    `).bind(
      nextValues.categoryId,
      nextValues.documentNumber,
      nextValues.revisionNumber,
      nextValues.revisionDate || null,
      nextValues.disposalDueYear === "" ? null : Number(nextValues.disposalDueYear),
      nextValues.documentName,
      nextValues.note || null,
      nextValues.rackSlotId,
      nextValues.rackFace,
      ...guardBinds
    )
  ];

  const plan = createDocumentUpdatePlan(statements, uniqueTagIds.length, guardClause);
  const results = await env.DB.batch(executableStatements(plan));
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "다른 사용자가 문서를 먼저 수정했거나 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}

// dispose/restore 공통 상태 전이. 배치 순서(폐기 이력 INSERT → 감사 INSERT → 가드 UPDATE)와
// pre-state 가드(FROM documents WHERE ...)를 그대로 유지해야 한다 — 로그 INSERT가 가드 UPDATE
// '앞'에 있어야 pre-state를 읽는다(no-op 시 함께 0행).
async function transitionDocumentStatus(env, id, spec, actor, actorRole) {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  if (doc.status !== spec.fromStatus) {
    return { ok: true };
  }

  const tags = await getDocumentTags(env, id);
  const next = { ...doc, status: spec.toStatus };
  const guardClause = `id = ? AND status = '${spec.fromStatus}' AND updated_at = ? AND row_version = ?`;
  const guardBinds = [id, doc.updated_at, Number(doc.row_version)];
  const actorInfo = normalizeActor(actor, actorRole);

  const statements = [
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason)
      SELECT ?, '${spec.logAction}', ?, ?
      FROM documents
      WHERE ${guardClause}
    `).bind(id, actorInfo.displayName, spec.logReason, ...guardBinds),
    conditionalAuditStatement(env, next, spec.auditAction, actor, actorRole, spec.auditSummary,
      spec.auditDetails(documentSnapshot(doc, tags), documentSnapshot(next, tags)), guardClause, guardBinds)
  ];
  if (spec.systemAudit) {
    statements.push(createSystemAuditStatement(env, {
      entityType: "document",
      entityId: id,
      entityReference: doc.document_number,
      action: spec.auditAction,
      actor,
      summary: spec.auditSummary,
      details: spec.auditDetails(documentSnapshot(doc, tags), documentSnapshot(next, tags))
    }, { guardSql: `FROM documents WHERE ${guardClause}`, guardBinds }));
  }
  statements.push(env.DB.prepare(`
      UPDATE documents
      SET status = '${spec.toStatus}', row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE ${guardClause}
    `).bind(...guardBinds));

  const plan = createDocumentStatusPlan(spec.auditAction, statements, guardClause);
  const results = await env.DB.batch(executableStatements(plan));
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "문서 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}

export async function disposeDocument(env, id, actor, reason, actorRole = "Admin") {
  return transitionDocumentStatus(env, id, {
    fromStatus: "active",
    toStatus: "disposed",
    logAction: "disposed",
    logReason: reason || null,
    auditAction: "dispose",
    auditSummary: "문서 폐기",
    auditDetails: (before, after) => ({ before, after, reason: reason || "" })
  }, actor, actorRole);
}

// 일괄 폐기: 문서·태그를 각각 1회 조회한 뒤, 건별 가드 문장을 하나의 batch로 묶어
// N+1 왕복을 줄인다. 건별 순서(폐기 이력 → 감사 → 가드 UPDATE)와 pre-state 가드는 유지한다.
export async function disposeDocumentsBulk(env, ids, actor, reason, actorRole = "Admin") {
  const uniqueIds = [...new Set(ids || [])].filter((id) => Number.isInteger(id) && id > 0);
  if (!uniqueIds.length) {
    return { ok: true, disposed: 0, skipped: 0, failures: [] };
  }
  if (uniqueIds.length > FREE_TIER_BUDGET.legacyBulkDisposeMaxItems) {
    return {
      ok: false,
      disposed: 0,
      skipped: 0,
      failures: [`소량 긴급 폐기는 한 번에 ${FREE_TIER_BUDGET.legacyBulkDisposeMaxItems}건 이하만 처리할 수 있습니다.`]
    };
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [docsResult, tagsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT
        d.id,
        d.storage_code,
        d.category_id,
        d.document_number,
        d.revision_number,
        d.revision_date,
        d.disposal_due_year,
        d.document_name,
        d.note,
        d.rack_slot_id,
        d.rack_face,
        d.status,
        d.updated_at,
        d.row_version,
        ${DOCUMENT_LOCATION_COLUMNS}
        r.column_count,
        r.shelf_count,
        rs.column_number,
        rs.shelf_number,
        rs.slot_code
      ${DOCUMENT_BASE_JOINS}
      WHERE d.id IN (${placeholders})
    `).bind(...uniqueIds).all(),
    env.DB.prepare(`
      SELECT dt.document_id, t.id, t.name
      FROM document_tags dt
      JOIN tags t ON t.id = dt.tag_id
      WHERE dt.document_id IN (${placeholders})
      ORDER BY t.name
    `).bind(...uniqueIds).all()
  ]);

  const docsById = new Map((docsResult.results ?? []).map((doc) => [Number(doc.id), doc]));
  const tagsByDoc = new Map();
  for (const row of tagsResult.results ?? []) {
    const documentId = Number(row.document_id);
    const list = tagsByDoc.get(documentId) || [];
    list.push({ id: Number(row.id), name: row.name });
    tagsByDoc.set(documentId, list);
  }

  const statements = [];
  const activeIds = [];
  const failures = [];
  let skipped = 0;
  const actorInfo = normalizeActor(actor, actorRole);

  for (const id of uniqueIds) {
    const doc = docsById.get(id);
    if (!doc) {
      failures.push(`${id}번: 문서를 찾을 수 없습니다.`);
      continue;
    }
    if (doc.status !== "active") {
      skipped += 1;
      continue;
    }

    const tags = tagsByDoc.get(id) || [];
    const next = { ...doc, status: "disposed" };
    const guardClause = "id = ? AND status = 'active' AND updated_at = ? AND row_version = ?";
    const guardBinds = [id, doc.updated_at, Number(doc.row_version)];

    statements.push(
      env.DB.prepare(`
        INSERT INTO disposal_logs (document_id, action, performed_by, reason)
        SELECT ?, 'disposed', ?, ?
        FROM documents
        WHERE ${guardClause}
      `).bind(id, actorInfo.displayName, reason || null, ...guardBinds),
      conditionalAuditStatement(
        env,
        next,
        "dispose",
        actor,
        actorRole,
        "문서 폐기",
        {
          before: documentSnapshot(doc, tags),
          after: documentSnapshot(next, tags),
          reason: reason || ""
        },
        guardClause,
        guardBinds
      ),
      env.DB.prepare(`
        UPDATE documents
        SET status = 'disposed', row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE ${guardClause}
      `).bind(...guardBinds)
    );
    activeIds.push(id);
  }

  if (!statements.length) {
    return {
      ok: failures.length === 0,
      disposed: 0,
      skipped,
      failures
    };
  }

  // 위의 문서·태그 집합 조회 2회까지 포함해 요청 내부 statement 예산을 방어한다.
  if (statements.length + 2 > FREE_TIER_BUDGET.maxD1StatementsPerRequest) {
    return {
      ok: false,
      disposed: 0,
      skipped,
      failures: ["한 번에 처리할 수 있는 무료티어 내부 예산을 초과했습니다."]
    };
  }

  const plan = createDocumentBulkDisposePlan(statements, activeIds.length);
  const results = await env.DB.batch(executableStatements(plan));
  let disposed = 0;
  for (let index = 0; index < activeIds.length; index += 1) {
    const updateResult = results[index * 3 + 2];
    if (hasChanged(updateResult)) {
      disposed += 1;
    } else {
      failures.push(`${activeIds[index]}번: 문서 상태가 변경되었습니다. 새로고침 후 다시 시도하세요.`);
    }
  }

  return {
    ok: failures.length === 0,
    disposed,
    skipped,
    failures
  };
}

export async function restoreDocument(env, id, actor, reason, actorRole = "Admin") {
  const restoreReason = String(reason ?? "").trim();
  if (!restoreReason) {
    return { ok: false, message: "폐기 해제 사유를 입력해 주세요." };
  }
  return transitionDocumentStatus(env, id, {
    fromStatus: "disposed",
    toStatus: "active",
    logAction: "restored",
    logReason: restoreReason,
    auditAction: "restore",
    auditSummary: "문서 폐기 해제",
    auditDetails: (before, after) => ({ before, after, reason: restoreReason }),
    systemAudit: true
  }, actor, actorRole);
}

export async function permanentlyDeleteDocument(env, id, actor = "알 수 없음", actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: true };
  }

  if (doc.status !== "disposed") {
    return { ok: false, message: "보관중 문서는 완전삭제할 수 없습니다. 먼저 폐기 처리해야 합니다." };
  }

  // 하드삭제는 ON DELETE CASCADE로 폐기 이력을 함께 파괴한다. GMP 기록 보존을 위해
  // 삭제 직전 전체 이력을 불변 감사 로그(document_audit_logs, documents FK 없음)의 details에
  // 스냅샷으로 보존한다(ALCOA Enduring/Complete). 감사·삭제를 하나의 batch로 원자화.
  const [tags, disposalLogs] = await Promise.all([
    getDocumentTags(env, id),
    getDisposalLogs(env, id)
  ]);
  const guardClause = "id = ? AND status = 'disposed' AND updated_at = ? AND row_version = ?";
  const guardBinds = [id, doc.updated_at, Number(doc.row_version)];

  const statements = [
    conditionalAuditStatement(env, doc, "delete_permanent", actor, actorRole, "문서 완전삭제", {
      before: documentSnapshot(doc, tags),
      history: {
        disposals: disposalLogs
      }
    }, guardClause, guardBinds),
    createSystemAuditStatement(env, {
      entityType: "document",
      entityId: id,
      entityReference: doc.document_number,
      action: "delete_permanent",
      actor,
      summary: "문서 완전삭제",
      details: { before: documentSnapshot(doc, tags), history: { disposals: disposalLogs } }
    }, { guardSql: `FROM documents WHERE ${guardClause}`, guardBinds }),
    env.DB.prepare(`DELETE FROM documents WHERE ${guardClause}`).bind(...guardBinds)
  ];

  const plan = createDocumentPermanentDeletePlan(statements, guardClause);
  const results = await env.DB.batch(executableStatements(plan));
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "문서 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}
