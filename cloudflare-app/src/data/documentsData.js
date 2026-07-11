import { clean, normalizeRackFace } from "../utils.js";
import {
  AUDIT_LOG_INSERT,
  DOCUMENT_BASE_JOINS,
  DOCUMENT_CORE_COLUMNS,
  DOCUMENT_LOCATION_COLUMNS,
  DOCUMENT_TAG_CONCAT,
  DOCUMENT_TAG_JOINS,
  hasChanged,
  optimisticLockClause
} from "./sqlShared.js";

export async function getCategoryDocumentIndex(env) {
  const result = await env.DB.prepare(`
    SELECT
      c.id,
      c.name,
      c.description,
      c.sort_order,
      c.is_active,
      COUNT(d.id) AS document_count,
      SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END) AS active_document_count,
      MIN(r.zone_number) AS first_zone_number,
      MIN(r.rack_number) AS first_rack_number
    FROM categories c
    LEFT JOIN documents d ON d.category_id = c.id
    LEFT JOIN rack_slots rs ON rs.id = d.rack_slot_id
    LEFT JOIN racks r ON r.id = rs.rack_id
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `).all();

  return result.results ?? [];
}

export async function getDocumentQualitySummary(env) {
  const [
    duplicateRows,
    missingLocation,
    missingCategory,
    invalidRackFace,
    suspiciousText,
    documentsWithoutTags,
    disposedDocuments
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT document_number, revision_number
        FROM documents
        GROUP BY document_number, revision_number
        HAVING COUNT(*) > 1
      )
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      LEFT JOIN rack_slots rs ON rs.id = d.rack_slot_id
      LEFT JOIN racks r ON r.id = rs.rack_id
      WHERE rs.id IS NULL OR r.id IS NULL
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      LEFT JOIN categories c ON c.id = d.category_id
      WHERE c.id IS NULL OR c.is_active = 0
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      JOIN racks r ON r.id = rs.rack_id
      WHERE r.is_single_sided = 1 AND d.rack_face = 'B'
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents
      WHERE document_name LIKE '%�%'
         OR document_name LIKE '%Ã%'
         OR document_name LIKE '%Â%'
         OR note LIKE '%�%'
         OR note LIKE '%Ã%'
         OR note LIKE '%Â%'
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      WHERE dt.document_id IS NULL
    `).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE status = 'disposed'").first()
  ]);

  return {
    duplicateDocumentNumbers: Number(duplicateRows?.count || 0),
    missingLocation: Number(missingLocation?.count || 0),
    missingCategory: Number(missingCategory?.count || 0),
    invalidRackFace: Number(invalidRackFace?.count || 0),
    suspiciousText: Number(suspiciousText?.count || 0),
    documentsWithoutTags: Number(documentsWithoutTags?.count || 0),
    disposedDocuments: Number(disposedDocuments?.count || 0)
  };
}

export async function getDocumentsForExport(env) {
  const result = await env.DB.prepare(`
    SELECT
      ${DOCUMENT_CORE_COLUMNS}
      ${DOCUMENT_LOCATION_COLUMNS}
      rs.column_number,
      rs.shelf_number,
      rs.slot_code,
      ${DOCUMENT_TAG_CONCAT}
    ${DOCUMENT_BASE_JOINS}
    ${DOCUMENT_TAG_JOINS}
    GROUP BY d.id
    ORDER BY d.id
  `).all();

  return result.results ?? [];
}

export async function getDocument(env, id) {
  return env.DB.prepare(`
    SELECT
      d.id,
      d.storage_code,
      d.category_id,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.note,
      d.rack_slot_id,
      d.rack_face,
      d.status,
      d.updated_at,
      ${DOCUMENT_LOCATION_COLUMNS}
      r.column_count,
      r.shelf_count,
      rs.column_number,
      rs.shelf_number,
      rs.slot_code
    ${DOCUMENT_BASE_JOINS}
    WHERE d.id = ?
  `).bind(id).first();
}

export async function getDocumentTags(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT t.id, t.name
    FROM document_tags dt
    JOIN tags t ON t.id = dt.tag_id
    WHERE dt.document_id = ?
    ORDER BY t.name
  `).bind(documentId).all();

  return result.results ?? [];
}

async function getTagsByIds(env, tagIds) {
  const uniqueTagIds = [...new Set(tagIds)].filter((id) => Number.isInteger(id) && id > 0);

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

export async function getDisposalLogs(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT id, action, performed_by, reason, created_at
    FROM disposal_logs
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(documentId).all();

  return result.results ?? [];
}

export async function getDocumentAuditLogs(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT id, action, actor, actor_role, summary, details, created_at
    FROM document_audit_logs
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(documentId).all();

  return result.results ?? [];
}

// 상태변경(UPDATE/DELETE)과 같은 batch(트랜잭션)에서 실행하는 조건부 감사 로그.
// guardClause를 아직 만족하는 문서에만 기록되므로, 같은 조건의 가드 statement가 no-op이면
// 감사 로그도 함께 0행이 된다 — 감사기록 없는 상태변경(2차 쓰기 실패)과 유령 로그를 모두 막는다.
// 반드시 가드 UPDATE/DELETE '앞'에 두어 pre-state를 읽게 한다.
function conditionalAuditStatement(env, document, action, actor, actorRole, summary, details, guardClause, guardBinds = []) {
  return env.DB.prepare(`
    ${AUDIT_LOG_INSERT}
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    FROM documents
    WHERE ${guardClause}
  `).bind(
    document.id,
    document.storage_code,
    document.document_number,
    action,
    actor || "알 수 없음",
    actorRole || "Unknown",
    summary,
    details ? JSON.stringify(details) : null,
    ...guardBinds
  );
}

function documentSnapshot(document, tags = []) {
  return {
    storageCode: document.storage_code,
    documentNumber: document.document_number,
    revisionNumber: document.revision_number,
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
  return env.DB.prepare(`
    ${AUDIT_LOG_INSERT}
    SELECT
      d.id,
      'ARC-' || printf('%06d', d.id),
      d.document_number,
      'create',
      ?,
      ?,
      '문서 등록',
      json_object(
        'after',
        json_object(
          'storageCode', 'ARC-' || printf('%06d', d.id),
          'documentNumber', d.document_number,
          'revisionNumber', d.revision_number,
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
  `).bind(actor || "알 수 없음", actorRole || "Unknown", temporaryStorageCode);
}

const DOCUMENT_FIELD_LIMITS = Object.freeze({
  documentNumber: 100,
  revisionNumber: 50,
  documentName: 300,
  note: 2000
});

export async function validateDocumentInput(env, values, options = {}) {
  if (!values.documentNumber || !values.revisionNumber || !values.documentName) {
    return "문서번호, 개정번호, 문서명은 필수입니다.";
  }

  // 자유 입력 필드 길이 상한: 저장소·검색 인덱스 팽창(저장 고갈 DoS)과 기록 신뢰도 저하 방지.
  if (clean(values.documentNumber).length > DOCUMENT_FIELD_LIMITS.documentNumber) {
    return `문서번호는 ${DOCUMENT_FIELD_LIMITS.documentNumber}자 이하로 입력하세요.`;
  }
  if (clean(values.revisionNumber).length > DOCUMENT_FIELD_LIMITS.revisionNumber) {
    return `개정번호는 ${DOCUMENT_FIELD_LIMITS.revisionNumber}자 이하로 입력하세요.`;
  }
  if (clean(values.documentName).length > DOCUMENT_FIELD_LIMITS.documentName) {
    return `문서명은 ${DOCUMENT_FIELD_LIMITS.documentName}자 이하로 입력하세요.`;
  }
  if (clean(values.note).length > DOCUMENT_FIELD_LIMITS.note) {
    return `비고는 ${DOCUMENT_FIELD_LIMITS.note}자 이하로 입력하세요.`;
  }

  if (!Number.isInteger(values.categoryId) || values.categoryId <= 0) {
    return "대분류를 선택하세요.";
  }

  if (!Number.isInteger(values.rackSlotId) || values.rackSlotId <= 0) {
    return "보관 위치를 선택하세요.";
  }

  if (!["A", "B"].includes(values.rackFace)) {
    return "보관 면은 1면 또는 2면만 선택할 수 있습니다.";
  }

  const category = await env.DB.prepare(`
    SELECT id, is_active FROM categories
    WHERE id = ?
  `).bind(values.categoryId).first();

  const allowInactiveCategory = options.allowInactiveCategory === true ||
    Number(options.allowInactiveCategoryId) === values.categoryId;

  if (!category || (!category.is_active && !allowInactiveCategory)) {
    return "사용 가능한 대분류가 아닙니다.";
  }

  const slot = await env.DB.prepare(`
    SELECT rs.id, r.is_single_sided
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE rs.id = ? AND rs.is_active = 1 AND r.is_active = 1
  `).bind(values.rackSlotId).first();

  if (!slot) {
    return "사용 가능한 보관 위치가 아닙니다.";
  }

  if (slot.is_single_sided && values.rackFace === "B") {
    return "단면 랙은 면 구분 없이 사용합니다. 2면을 선택할 수 없습니다.";
  }

  return "";
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
        document_name,
        note,
        rack_slot_id,
        rack_face,
        status,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
      RETURNING id
    `).bind(
      temporaryStorageCode,
      values.categoryId,
      values.documentNumber,
      values.revisionNumber,
      values.documentName,
      values.note || null,
      values.rackSlotId,
      values.rackFace
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

  const result = await env.DB.batch(statements);
  const createdId = result[0]?.results?.[0]?.id;

  if (!createdId) {
    throw new Error("문서 등록 결과를 확인할 수 없습니다.");
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

  const [beforeTags, afterTags, updated] = await Promise.all([
    getDocumentTags(env, id),
    getTagsByIds(env, values.tagIds),
    documentWithValues(env, doc, values)
  ]);

  const lock = optimisticLockClause(values.expectedUpdatedAt);
  const guardClause = `id = ? AND status = 'active'${lock.sql}`;
  const guardBinds = [id, ...lock.binds];
  const existsGuard = `EXISTS (SELECT 1 FROM documents WHERE ${guardClause})`;

  // 상태변경(UPDATE)·태그 교체·감사 로그를 하나의 batch(트랜잭션)로 원자화한다.
  // 모든 부수효과는 pre-state 가드에 묶여, 낙관적 잠금 실패 시 태그도 감사도 함께 no-op이 된다.
  const uniqueTagIds = [...new Set(values.tagIds || [])];
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
        document_name = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE ${guardClause}
    `).bind(
      values.categoryId,
      values.documentNumber,
      values.revisionNumber,
      values.documentName,
      values.note || null,
      ...guardBinds
    )
  ];

  const results = await env.DB.batch(statements);
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
  const guardClause = `id = ? AND status = '${spec.fromStatus}'`;
  const guardBinds = [id];

  const statements = [
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason)
      SELECT ?, '${spec.logAction}', ?, ?
      FROM documents
      WHERE ${guardClause}
    `).bind(id, actor, spec.logReason, ...guardBinds),
    conditionalAuditStatement(env, next, spec.auditAction, actor, actorRole, spec.auditSummary,
      spec.auditDetails(documentSnapshot(doc, tags), documentSnapshot(next, tags)), guardClause, guardBinds),
    env.DB.prepare(`
      UPDATE documents
      SET status = '${spec.toStatus}', updated_at = CURRENT_TIMESTAMP
      WHERE ${guardClause}
    `).bind(...guardBinds)
  ];

  const results = await env.DB.batch(statements);
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

export async function restoreDocument(env, id, actor, actorRole = "Admin") {
  return transitionDocumentStatus(env, id, {
    fromStatus: "disposed",
    toStatus: "active",
    logAction: "restored",
    logReason: "관리자 폐기 해제",
    auditAction: "restore",
    auditSummary: "문서 폐기 해제",
    auditDetails: (before, after) => ({ before, after })
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
  const guardClause = "id = ? AND status = 'disposed'";
  const guardBinds = [id];

  const statements = [
    conditionalAuditStatement(env, doc, "delete_permanent", actor, actorRole, "문서 완전삭제", {
      before: documentSnapshot(doc, tags),
      history: {
        disposals: disposalLogs
      }
    }, guardClause, guardBinds),
    env.DB.prepare(`DELETE FROM documents WHERE ${guardClause}`).bind(...guardBinds)
  ];

  const results = await env.DB.batch(statements);
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "문서 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}

export function parseDocumentNumberList(text) {
  const seen = new Set();
  const numbers = [];

  // 문서번호/보관코드는 공백 없는 코드이므로 공백·줄바꿈·쉼표·세미콜론·탭을 모두 구분자로 본다.
  for (const token of String(text ?? "").split(/[\s,;]+/)) {
    const value = clean(token);
    if (!value) {
      continue;
    }

    const key = value.toUpperCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    numbers.push(value);
  }

  return numbers;
}

export async function findDocumentsByNumbers(env, numbers) {
  if (!numbers.length) {
    return { documents: [], missing: [] };
  }

  const upperNumbers = numbers.map((number) => number.toUpperCase());
  const placeholders = upperNumbers.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT id, document_number, storage_code
    FROM documents
    WHERE UPPER(document_number) IN (${placeholders})
       OR UPPER(storage_code) IN (${placeholders})
  `).bind(...upperNumbers, ...upperNumbers).all();
  const documents = result.results ?? [];
  const matched = new Set();

  for (const document of documents) {
    matched.add(String(document.document_number).toUpperCase());
    matched.add(String(document.storage_code).toUpperCase());
  }

  const missing = numbers.filter((number) => !matched.has(number.toUpperCase()));
  return { documents, missing };
}

export function valuesFromDocumentForm(form) {
  return {
    documentNumber: clean(form.get("documentNumber")),
    revisionNumber: clean(form.get("revisionNumber")),
    documentName: clean(form.get("documentName")),
    categoryId: Number(form.get("categoryId")),
    rackSlotId: Number(form.get("rackSlotId")),
    rackFace: normalizeRackFace(form.get("rackFace")),
    note: clean(form.get("note")),
    tagIds: form.getAll("tagIds").map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0),
    // 낙관적 잠금: 사용자가 수정 화면을 연 시점의 updated_at(hidden). 비어 있으면 잠금 없이 동작.
    expectedUpdatedAt: clean(form.get("expectedUpdatedAt"))
  };
}
