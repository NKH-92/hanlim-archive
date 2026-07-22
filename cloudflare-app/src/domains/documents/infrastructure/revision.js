import { AUDIT_LOG_INSERT_WITH_ACTOR } from "../../../data/sqlShared.js";
import { createSystemAuditStatement } from "../../audit/index.js";
import { clean } from "../../../shared/text/normalize.js";
import { isExpectedChangeAbort } from "../../../platform/d1/expectedChange.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { createDocumentRevisionPlan } from "./mutationPlans.js";

const STALE_MESSAGE = "다른 사용자가 문서를 먼저 변경했습니다. 새로고침 후 다시 시도하세요.";

export function validateDocumentRevisionInput(values, source = null) {
  const revisionNumber = clean(values?.revisionNumber);
  const revisionDate = clean(values?.revisionDate);
  const fieldErrors = {};
  const formErrors = [];

  if (!revisionNumber) fieldErrors.revisionNumber = "새 개정번호를 입력하세요.";
  else if (revisionNumber.length > 50) fieldErrors.revisionNumber = "개정번호는 50자 이내로 입력하세요.";
  else if (source && revisionNumber.toUpperCase() === String(source.revision_number).toUpperCase()) {
    fieldErrors.revisionNumber = "현재 개정번호와 다른 번호를 입력하세요.";
  }

  if (!revisionDate) fieldErrors.revisionDate = "새 제/개정일을 입력하세요.";
  else if (!isValidIsoDate(revisionDate)) fieldErrors.revisionDate = "올바른 제/개정일을 입력하세요.";

  if (values?.confirmReplacement !== "1") {
    formErrors.push("동일 바인더의 이전 개정본이 자동 폐기되는 것에 동의해야 합니다.");
  }

  return {
    ok: !Object.keys(fieldErrors).length && !formErrors.length,
    fieldErrors,
    formErrors,
    values: { revisionNumber, revisionDate }
  };
}

export async function reviseDocument(env, sourceId, values, actor) {
  const source = await env.DB.prepare(`
    SELECT *
    FROM documents
    WHERE id = ?
  `).bind(sourceId).first();
  if (!source) return { ok: false, message: "문서를 찾을 수 없습니다." };
  if (source.status !== "active" || source.sync_state !== "current") {
    return { ok: false, message: "현재 보관 중인 문서만 개정할 수 있습니다." };
  }

  const validation = validateDocumentRevisionInput(values, source);
  if (!validation.ok) return { ok: false, validation };

  const expectedUpdatedAt = clean(values.expectedUpdatedAt);
  const expectedRowVersion = Number(values.expectedRowVersion);
  if (!expectedUpdatedAt || !Number.isInteger(expectedRowVersion) || expectedRowVersion <= 0) {
    return { ok: false, message: "문서 개정 잠금 정보가 없습니다. 새로고침 후 다시 시도하세요." };
  }

  const existingLink = await env.DB.prepare(`
    SELECT new_document_id
    FROM document_revision_links
    WHERE previous_document_id = ?
  `).bind(sourceId).first();
  if (existingLink) {
    return { ok: false, message: "이미 새 개정본으로 교체된 문서입니다.", replacementId: Number(existingLink.new_document_id) };
  }

  const duplicate = await env.DB.prepare(`
    SELECT id
    FROM documents
    WHERE sync_state = 'current'
      AND UPPER(document_number) = UPPER(?)
      AND UPPER(revision_number) = UPPER(?)
    LIMIT 1
  `).bind(source.document_number, validation.values.revisionNumber).first();
  if (duplicate) {
    return { ok: false, validation: {
      ok: false,
      fieldErrors: { revisionNumber: "같은 문서번호와 개정번호가 이미 등록되어 있습니다." },
      formErrors: []
    } };
  }

  const actorInfo = normalizeActor(actor);
  const temporaryStorageCode = `TEMP-REV-${crypto.randomUUID()}`;
  const guardSql = `d.id = ? AND d.status = 'active' AND d.sync_state = 'current'
    AND d.updated_at = ? AND d.row_version = ?
    AND NOT EXISTS (
      SELECT 1 FROM document_revision_links existing
      WHERE existing.previous_document_id = d.id
    )`;
  const guardBinds = [sourceId, expectedUpdatedAt, expectedRowVersion];
  const previousDetails = JSON.stringify({
    previousRevisionNumber: source.revision_number,
    newRevisionNumber: validation.values.revisionNumber,
    revisionDate: validation.values.revisionDate,
    automaticDisposal: true
  });

  const statements = [
    env.DB.prepare(`
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, revision_date,
        disposal_due_year, document_name, note, rack_slot_id, rack_face, status,
        sync_state, updated_at
      )
      SELECT
        ?, d.category_id, d.document_number, ?, ?, d.disposal_due_year,
        d.document_name, d.note, d.rack_slot_id, d.rack_face, 'active', 'current', CURRENT_TIMESTAMP
      FROM documents d
      WHERE ${guardSql}
        AND NOT EXISTS (
          SELECT 1 FROM documents duplicate
          WHERE duplicate.sync_state = 'current'
            AND UPPER(duplicate.document_number) = UPPER(d.document_number)
            AND UPPER(duplicate.revision_number) = UPPER(?)
        )
      RETURNING id
    `).bind(
      temporaryStorageCode,
      validation.values.revisionNumber,
      validation.values.revisionDate,
      ...guardBinds,
      validation.values.revisionNumber
    ),
    env.DB.prepare(`
      INSERT INTO document_tags (document_id, tag_id)
      SELECT replacement.id, tags.tag_id
      FROM documents replacement
      JOIN document_tags tags ON tags.document_id = ?
      WHERE replacement.storage_code = ?
    `).bind(sourceId, temporaryStorageCode),
    env.DB.prepare(`
      INSERT INTO document_revision_links (
        previous_document_id, new_document_id,
        previous_revision_number, new_revision_number,
        performed_by_user_id, performed_by_username, performed_by_name
      )
      SELECT ?, replacement.id, ?, ?, ?, ?, ?
      FROM documents replacement
      WHERE replacement.storage_code = ?
    `).bind(
      sourceId,
      source.revision_number,
      validation.values.revisionNumber,
      actorInfo.userId,
      actorInfo.username,
      actorInfo.displayName,
      temporaryStorageCode
    ),
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason)
      SELECT ?, 'disposed', ?, ?
      FROM document_revision_links links
      WHERE links.previous_document_id = ?
    `).bind(sourceId, actorInfo.displayName, `개정 ${validation.values.revisionNumber}로 대체`, sourceId),
    env.DB.prepare(`
      ${AUDIT_LOG_INSERT_WITH_ACTOR}
      SELECT
        d.id, d.storage_code, d.document_number, 'revision_superseded',
        ?, ?, ?, ?, '문서 개정으로 이전본 자동 폐기', ?
      FROM documents d
      JOIN document_revision_links links ON links.previous_document_id = d.id
      WHERE d.id = ?
    `).bind(
      actorInfo.displayName,
      actorInfo.role,
      actorInfo.userId,
      actorInfo.username,
      previousDetails,
      sourceId
    ),
    env.DB.prepare(`
      ${AUDIT_LOG_INSERT_WITH_ACTOR}
      SELECT
        d.id, 'ARC-' || printf('%06d', d.id), d.document_number, 'revision_created',
        ?, ?, ?, ?, '동일 바인더에 새 개정본 등록', ?
      FROM documents d
      WHERE d.storage_code = ?
    `).bind(
      actorInfo.displayName,
      actorInfo.role,
      actorInfo.userId,
      actorInfo.username,
      previousDetails,
      temporaryStorageCode
    ),
    createSystemAuditStatement(env, {
      entityType: "document",
      entityId: sourceId,
      entityReference: source.document_number,
      action: "revision",
      actor,
      summary: "동일 바인더 문서 개정",
      details: JSON.parse(previousDetails)
    }, {
      guardSql: `FROM document_revision_links WHERE previous_document_id = ?`,
      guardBinds: [sourceId]
    }),
    env.DB.prepare(`
      UPDATE documents
      SET storage_code = 'ARC-' || printf('%06d', id),
          excel_row_key = 'HLM-' || printf('%012d', id),
          updated_at = CURRENT_TIMESTAMP
      WHERE storage_code = ?
    `).bind(temporaryStorageCode),
    env.DB.prepare(`
      UPDATE documents
      SET status = 'disposed', row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'active' AND updated_at = ? AND row_version = ?
        AND EXISTS (
          SELECT 1 FROM document_revision_links links
          WHERE links.previous_document_id = documents.id
        )
    `).bind(sourceId, expectedUpdatedAt, expectedRowVersion)
  ];

  try {
    const results = await executeMutationBatch(env, createDocumentRevisionPlan(statements, guardSql));
    const newDocumentId = Number(results[0]?.results?.[0]?.id || 0);
    return newDocumentId
      ? { ok: true, newDocumentId }
      : { ok: false, message: STALE_MESSAGE };
  } catch (error) {
    if (isExpectedChangeAbort(error) || /UNIQUE/i.test(String(error?.message || ""))) {
      return { ok: false, message: STALE_MESSAGE };
    }
    throw error;
  }
}

export async function getDocumentRevisionHistory(env, documentId) {
  const result = await env.DB.prepare(`
    WITH RECURSIVE
    ancestors(document_id) AS (
      SELECT ?
      UNION
      SELECT links.previous_document_id
      FROM document_revision_links links
      JOIN ancestors current ON current.document_id = links.new_document_id
    ),
    root(document_id) AS (
      SELECT ancestors.document_id
      FROM ancestors
      WHERE NOT EXISTS (
        SELECT 1 FROM document_revision_links links
        WHERE links.new_document_id = ancestors.document_id
      )
      LIMIT 1
    ),
    chain(document_id, sequence) AS (
      SELECT root.document_id, 0 FROM root
      UNION ALL
      SELECT links.new_document_id, chain.sequence + 1
      FROM document_revision_links links
      JOIN chain ON chain.document_id = links.previous_document_id
    )
    SELECT
      d.id, d.document_number, d.document_name, d.revision_number, d.revision_date,
      d.status, d.created_at, chain.sequence,
      previous.previous_document_id,
      replacement.new_document_id AS replacement_document_id
    FROM chain
    JOIN documents d ON d.id = chain.document_id
    LEFT JOIN document_revision_links previous ON previous.new_document_id = d.id
    LEFT JOIN document_revision_links replacement ON replacement.previous_document_id = d.id
    ORDER BY chain.sequence DESC
  `).bind(documentId).all();
  return result.results ?? [];
}

export async function getDocumentRevisionLink(env, documentId) {
  return env.DB.prepare(`
    SELECT previous_document_id, new_document_id
    FROM document_revision_links
    WHERE previous_document_id = ? OR new_document_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(documentId, documentId).first();
}

function normalizeActor(actor) {
  return {
    userId: Number.isInteger(Number(actor?.userId ?? actor?.id)) ? Number(actor?.userId ?? actor?.id) : null,
    username: clean(actor?.username) || "unknown",
    displayName: clean(actor?.displayName ?? actor?.display_name ?? actor?.username) || "알 수 없음",
    role: clean(actor?.role) || "Unknown"
  };
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
