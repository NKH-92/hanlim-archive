import { FREE_TIER_BUDGET } from "../../../config.js";
import { clean } from "../../../shared/text/normalize.js";
import { createSystemAuditStatement } from "../../audit/index.js";
import { hasChanged } from "../../../data/sqlShared.js";
import { importStatements } from "./plans.js";

const JOB_STATUSES = new Set(["ready", "processing", "completed", "cancelled"]);
const ITEM_STATUSES = new Set(["pending", "completed", "failed"]);

export async function listDocumentImportJobs(env, { status = "", limit = 100 } = {}) {
  const safeStatus = JOB_STATUSES.has(status) ? status : "";
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
  const result = await env.DB.prepare(`
    SELECT
      j.*,
      MAX(0, j.total_count - j.completed_count - j.failed_count) AS pending_count
    FROM document_import_jobs j
    WHERE (? = '' OR j.status = ?)
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT ?
  `).bind(safeStatus, safeStatus, safeLimit).all();
  return result.results ?? [];
}

export async function getDocumentImportJob(env, id) {
  return env.DB.prepare(`
    SELECT
      j.*,
      MAX(0, j.total_count - j.completed_count - j.failed_count) AS pending_count
    FROM document_import_jobs j
    WHERE j.id = ?
  `).bind(id).first();
}

export async function getDocumentImportItems(env, jobId, { status = "", limit = 100, offset = 0 } = {}) {
  const safeStatus = ITEM_STATUSES.has(status) ? status : "";
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const result = await env.DB.prepare(`
    SELECT id, job_id, row_number, status, created_document_id, error_message, processed_at, created_at
    FROM document_import_items
    WHERE job_id = ? AND (? = '' OR status = ?)
    ORDER BY row_number
    LIMIT ? OFFSET ?
  `).bind(jobId, safeStatus, safeStatus, safeLimit, safeOffset).all();
  return result.results ?? [];
}

export async function createDocumentImportJob(env, { sourceName = "", items = [] } = {}, actor) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, message: "가져올 문서가 없습니다." };
  }
  if (items.length > FREE_TIER_BUDGET.csvImportMaxItems) {
    return { ok: false, message: `CSV 가져오기는 한 번에 ${FREE_TIER_BUDGET.csvImportMaxItems}건까지 처리합니다.` };
  }
  const normalizedItems = items.map((item, index) => ({
    rowNumber: Number(item.rowNumber) || index + 2,
    payload: normalizeStagedPayload(item)
  }));
  const temporaryCode = `IMP-TEMP-${crypto.randomUUID()}`;
  const actorId = requiredActorId(actor);
  const stagedSql = normalizedItems.map(() => "SELECT ? AS row_number, ? AS payload_json").join(" UNION ALL ");
  const stagedBinds = normalizedItems.flatMap((item) => [item.rowNumber, JSON.stringify(item.payload)]);
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_import_jobs (
        job_code, source_name, status, total_count, created_by_user_id, created_by_name
      )
      VALUES (?, ?, 'ready', ?, ?, ?)
      RETURNING id
    `).bind(temporaryCode, clean(sourceName) || null, normalizedItems.length, actorId, actorName(actor)),
    env.DB.prepare(`
      INSERT INTO document_import_items (job_id, row_number, payload_json)
      SELECT j.id, staged.row_number, staged.payload_json
      FROM document_import_jobs j
      CROSS JOIN (${stagedSql}) AS staged
      WHERE j.job_code = ?
    `).bind(...stagedBinds, temporaryCode),
    env.DB.prepare(`
      INSERT INTO system_audit_logs (
        entity_type, entity_id, entity_reference, action, actor_user_id,
        actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
        summary, details_json
      )
      SELECT
        'document_import_job', id, 'IMP-' || strftime('%Y', 'now') || '-' || printf('%04d', id),
        'create', ?, ?, ?, ?, 'CSV 가져오기 작업 생성',
        json_object('sourceName', source_name, 'totalCount', total_count)
      FROM document_import_jobs
      WHERE job_code = ?
    `).bind(
      actorId,
      actorUsername(actor),
      actorName(actor),
      actorPermissionsSnapshot(actor),
      temporaryCode
    ),
    env.DB.prepare(`
      UPDATE document_import_jobs
      SET job_code = 'IMP-' || strftime('%Y', 'now') || '-' || printf('%04d', id),
          updated_at = CURRENT_TIMESTAMP
      WHERE job_code = ?
    `).bind(temporaryCode)
  ];
  const results = await env.DB.batch(importStatements("create", statements, "temporary-job-code"));
  const id = Number(results[0]?.results?.[0]?.id || 0);
  if (!id) throw new Error("CSV 가져오기 작업 생성 결과를 확인할 수 없습니다.");
  return { ok: true, id };
}

export async function processDocumentImportJob(env, jobId, actor) {
  const work = await getNextImportWork(env, jobId);
  if (!work) return { ok: false, message: "CSV 가져오기 작업을 찾을 수 없습니다." };
  if (work.job_status === "completed") return { ok: true, done: true, job: importJobFromWork(work) };
  if (work.job_status === "cancelled") return { ok: false, message: "취소된 가져오기 작업입니다." };
  if (!work.item_id) {
    const aggregate = [aggregateImportJobStatement(env, jobId, actor, true)];
    const result = await env.DB.batch(importStatements("aggregate", aggregate, "job-not-cancelled"));
    const job = result[0]?.results?.[0] || importJobFromWork(work);
    return { ok: true, done: job.status === "completed", job, statementCount: 2 };
  }

  let payload;
  try {
    payload = normalizeStagedPayload(JSON.parse(work.payload_json));
  } catch {
    return failDocumentImportItem(env, jobId, work.item_id, "저장된 행 데이터를 읽을 수 없습니다.", actor);
  }
  const validationError = validateWorkPayload(work, payload);
  if (validationError) {
    return failDocumentImportItem(env, jobId, work.item_id, validationError, actor);
  }

  const token = crypto.randomUUID();
  const temporaryCode = `TEMP-${crypto.randomUUID()}`;
  const values = payload.values;
  const statements = [
    env.DB.prepare(`
      UPDATE document_import_items
      SET processing_token = ?
      WHERE id = ? AND job_id = ? AND status = 'pending' AND processing_token IS NULL
        AND EXISTS (
          SELECT 1 FROM document_import_jobs
          WHERE id = ? AND status IN ('ready', 'processing')
        )
    `).bind(token, work.item_id, jobId, jobId),
    env.DB.prepare(`
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, revision_date,
        disposal_due_year, document_name, note, rack_slot_id, rack_face, status, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP
      FROM document_import_items i
      JOIN document_import_jobs j ON j.id = i.job_id
      JOIN categories c ON c.id = ? AND c.is_active = 1
      JOIN rack_slots rs ON rs.id = ? AND rs.is_active = 1
      JOIN racks r ON r.id = rs.rack_id AND r.is_active = 1
      WHERE i.id = ? AND i.job_id = ? AND i.status = 'pending' AND i.processing_token = ?
        AND j.status IN ('ready', 'processing')
        AND (? <> 'B' OR r.is_single_sided = 0)
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(?) requested
          LEFT JOIN tags t ON t.id = CAST(requested.value AS INTEGER) AND t.is_active = 1
          WHERE t.id IS NULL
        )
    `).bind(
      temporaryCode,
      values.categoryId,
      values.documentNumber,
      values.revisionNumber,
      values.revisionDate || null,
      values.disposalDueYear === "" ? null : Number(values.disposalDueYear),
      values.documentName,
      values.note || null,
      values.rackSlotId,
      values.rackFace,
      values.categoryId,
      values.rackSlotId,
      work.item_id,
      jobId,
      token,
      values.rackFace,
      JSON.stringify(values.tagIds)
    ),
    env.DB.prepare(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      SELECT d.id, CAST(requested.value AS INTEGER)
      FROM documents d
      CROSS JOIN json_each(?) requested
      JOIN tags t ON t.id = CAST(requested.value AS INTEGER) AND t.is_active = 1
      WHERE d.storage_code = ?
    `).bind(JSON.stringify(values.tagIds), temporaryCode),
    createDocumentImportAuditStatement(env, temporaryCode, actor)
  ];

  if (payload.status === "disposed") {
    statements.push(
      env.DB.prepare(`
        INSERT INTO disposal_logs (document_id, action, performed_by, reason)
        SELECT id, 'disposed', ?, 'CSV 가져오기 폐기 상태 반영'
        FROM documents
        WHERE storage_code = ? AND status = 'active'
      `).bind(actorName(actor), temporaryCode),
      env.DB.prepare(`
        INSERT INTO document_audit_logs (
          document_id, storage_code, document_number, action, actor, actor_role, summary, details,
          actor_user_id, actor_username
        )
        SELECT
          id, 'ARC-' || printf('%06d', id), document_number, 'dispose', ?, ?,
          'CSV 가져오기 폐기 상태 반영',
          json_object('before', json_object('status', 'active'), 'after', json_object('status', 'disposed'), 'reason', 'CSV 가져오기 폐기 상태 반영'),
          ?, ?
        FROM documents
        WHERE storage_code = ? AND status = 'active'
      `).bind(actorName(actor), clean(actor?.role) || "User", requiredActorId(actor), actorUsername(actor), temporaryCode),
      env.DB.prepare(`
        UPDATE documents
        SET status = 'disposed', row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE storage_code = ? AND status = 'active'
      `).bind(temporaryCode)
    );
  }

  statements.push(
    env.DB.prepare(`
      UPDATE document_import_items
      SET status = 'completed',
          created_document_id = (SELECT id FROM documents WHERE storage_code = ?),
          error_message = NULL, processed_at = CURRENT_TIMESTAMP, processing_token = NULL
      WHERE id = ? AND job_id = ? AND status = 'pending' AND processing_token = ?
        AND EXISTS (
          SELECT 1 FROM documents
          WHERE storage_code = ? AND status = ?
        )
    `).bind(temporaryCode, work.item_id, jobId, token, temporaryCode, payload.status),
    env.DB.prepare(`
      UPDATE documents
      SET storage_code = 'ARC-' || printf('%06d', id), updated_at = CURRENT_TIMESTAMP
      WHERE storage_code = ?
        AND EXISTS (
          SELECT 1 FROM document_import_items
          WHERE id = ? AND job_id = ? AND status = 'completed'
        )
    `).bind(temporaryCode, work.item_id, jobId),
    env.DB.prepare(`
      UPDATE document_import_items
      SET status = 'failed', error_message = '처리 시점에 대분류, 태그 또는 위치가 변경되었습니다.',
          processed_at = CURRENT_TIMESTAMP, processing_token = NULL
      WHERE id = ? AND job_id = ? AND status = 'pending' AND processing_token = ?
    `).bind(work.item_id, jobId, token),
    aggregateImportJobStatement(env, jobId, actor, true)
  );

  if (statements.length > FREE_TIER_BUDGET.maxD1StatementsPerRequest) {
    throw new Error("CSV 행 처리 statement 예산을 초과했습니다.");
  }

  try {
    const results = await env.DB.batch(importStatements("process", statements, "claim-token+pending-item"));
    const claim = results[0];
    const job = results[results.length - 1]?.results?.[0] || importJobFromWork(work);
    if (!hasChanged(claim)) {
      return { ok: true, done: job.status === "completed", job, skipped: true, statementCount: statements.length + 1 };
    }
    return { ok: true, done: job.status === "completed", job, statementCount: statements.length + 1 };
  } catch (error) {
    // 알려진 행 제약 오류만 해당 행 실패로 닫는다. 일시적 D1/네트워크 오류는 batch
    // rollback 상태를 유지한 채 다시 던져, 사용자가 같은 pending 행부터 재시도할 수 있게 한다.
    const failure = friendlyImportFailure(error);
    if (!failure) throw error;
    return failDocumentImportItem(env, jobId, work.item_id, failure, actor);
  }
}

export async function failDocumentImportItem(env, jobId, itemId, message, actor) {
  const cleanMessage = clean(message) || "문서를 등록할 수 없습니다.";
  const statements = [
    env.DB.prepare(`
      UPDATE document_import_items
      SET status = 'failed', error_message = ?, processed_at = CURRENT_TIMESTAMP, processing_token = NULL
      WHERE id = ? AND job_id = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM document_import_jobs
          WHERE id = ? AND status IN ('ready', 'processing')
        )
    `).bind(cleanMessage, itemId, jobId, jobId),
    aggregateImportJobStatement(env, jobId, actor, true)
  ];
  const results = await env.DB.batch(importStatements("fail-item", statements, "pending-item"));
  const job = results[1]?.results?.[0];
  return { ok: true, failed: true, done: job?.status === "completed", job, statementCount: statements.length + 1 };
}

export async function cancelDocumentImportJob(env, id, actor) {
  const job = await getDocumentImportJob(env, id);
  if (!job) return { ok: false, message: "CSV 가져오기 작업을 찾을 수 없습니다." };
  if (job.status === "cancelled") return { ok: true };
  if (!new Set(["ready", "processing"]).has(job.status)) {
    return { ok: false, message: "완료된 가져오기 작업은 취소할 수 없습니다." };
  }
  const guardSql = "FROM document_import_jobs WHERE id = ? AND status IN ('ready', 'processing')";
  const statements = [
    createSystemAuditStatement(env, {
      entityType: "document_import_job", entityId: id, entityReference: job.job_code,
      action: "cancel", actor, summary: "CSV 가져오기 작업 취소"
    }, { guardSql, guardBinds: [id] }),
    env.DB.prepare(`
      UPDATE document_import_jobs
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('ready', 'processing')
    `).bind(id)
  ];
  const results = await env.DB.batch(importStatements("cancel", statements, "ready-or-processing"));
  return hasChanged(results[1]) ? { ok: true } : { ok: false, message: "작업 상태가 변경되었습니다." };
}

export async function getDocumentImportFailureRows(env, id) {
  const result = await env.DB.prepare(`
    SELECT j.job_code, i.row_number, i.error_message, i.payload_json, i.processed_at
    FROM document_import_jobs j
    JOIN document_import_items i ON i.job_id = j.id
    WHERE j.id = ? AND i.status = 'failed'
    ORDER BY i.row_number
  `).bind(id).all();
  return result.results ?? [];
}

async function getNextImportWork(env, jobId) {
  return env.DB.prepare(`
    SELECT
      j.id AS job_id, j.job_code, j.source_name, j.status AS job_status,
      j.total_count, j.completed_count, j.failed_count, j.created_at, j.completed_at,
      i.id AS item_id, i.row_number, i.payload_json,
      c.is_active AS category_active,
      rs.is_active AS slot_active,
      r.is_active AS rack_active,
      r.is_single_sided,
      (SELECT COUNT(*) FROM json_each(json_extract(i.payload_json, '$.values.tagIds'))) AS requested_tag_count,
      (
        SELECT COUNT(*)
        FROM json_each(json_extract(i.payload_json, '$.values.tagIds')) requested
        JOIN tags t ON t.id = CAST(requested.value AS INTEGER) AND t.is_active = 1
      ) AS active_tag_count
    FROM document_import_jobs j
    LEFT JOIN document_import_items i ON i.id = (
      SELECT next.id
      FROM document_import_items next
      WHERE next.job_id = j.id AND next.status = 'pending' AND next.processing_token IS NULL
      ORDER BY next.id
      LIMIT 1
    )
    LEFT JOIN categories c ON c.id = CAST(json_extract(i.payload_json, '$.values.categoryId') AS INTEGER)
    LEFT JOIN rack_slots rs ON rs.id = CAST(json_extract(i.payload_json, '$.values.rackSlotId') AS INTEGER)
    LEFT JOIN racks r ON r.id = rs.rack_id
    WHERE j.id = ?
  `).bind(jobId).first();
}

function aggregateImportJobStatement(env, jobId, actor, returnRow) {
  const suffix = returnRow ? ` RETURNING *, MAX(0, total_count - completed_count - failed_count) AS pending_count` : "";
  return env.DB.prepare(`
    UPDATE document_import_jobs
    SET
      completed_count = (SELECT COUNT(*) FROM document_import_items WHERE job_id = ? AND status = 'completed'),
      failed_count = (SELECT COUNT(*) FROM document_import_items WHERE job_id = ? AND status = 'failed'),
      status = CASE
        WHEN status IN ('ready', 'processing') AND NOT EXISTS (
          SELECT 1 FROM document_import_items WHERE job_id = ? AND status = 'pending'
        ) THEN 'completed'
        WHEN status = 'ready' THEN 'processing'
        ELSE status
      END,
      completed_at = CASE
        WHEN status IN ('ready', 'processing') AND NOT EXISTS (
          SELECT 1 FROM document_import_items WHERE job_id = ? AND status = 'pending'
        ) THEN COALESCE(completed_at, CURRENT_TIMESTAMP)
        ELSE completed_at
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?${suffix}
  `).bind(jobId, jobId, jobId, jobId, jobId);
}

function createDocumentImportAuditStatement(env, temporaryCode, actor) {
  return env.DB.prepare(`
    INSERT INTO document_audit_logs (
      document_id, storage_code, document_number, action, actor, actor_role, summary, details,
      actor_user_id, actor_username
    )
    SELECT
      d.id, 'ARC-' || printf('%06d', d.id), d.document_number, 'create', ?, ?,
      'CSV 가져오기 문서 등록',
      json_object(
        'after', json_object(
          'storageCode', 'ARC-' || printf('%06d', d.id),
          'documentNumber', d.document_number,
          'revisionNumber', d.revision_number,
          'revisionDate', IFNULL(d.revision_date, ''),
          'disposalDueYear', d.disposal_due_year,
          'documentName', d.document_name,
          'categoryName', c.name,
          'zoneNumber', r.zone_number,
          'rackNumber', r.rack_number,
          'columnNumber', rs.column_number,
          'shelfNumber', rs.shelf_number,
          'rackFace', d.rack_face,
          'status', d.status,
          'note', IFNULL(d.note, ''),
          'tags', COALESCE((
            SELECT json_group_array(name)
            FROM (
              SELECT t.name AS name
              FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
              WHERE dt.document_id = d.id ORDER BY t.name
            )
          ), json('[]'))
        )
      ),
      ?, ?
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    WHERE d.storage_code = ?
  `).bind(actorName(actor), clean(actor?.role) || "User", requiredActorId(actor), actorUsername(actor), temporaryCode);
}

function validateWorkPayload(work, payload) {
  const values = payload.values;
  if (!values.documentNumber || !values.revisionNumber || !values.documentName) return "필수 문서 정보가 없습니다.";
  if (!Number.isInteger(values.categoryId) || values.categoryId <= 0 || !Number(work.category_active)) {
    return "사용 가능한 대분류가 아닙니다.";
  }
  if (!Number.isInteger(values.rackSlotId) || values.rackSlotId <= 0 || !Number(work.slot_active) || !Number(work.rack_active)) {
    return "사용 가능한 보관 위치가 아닙니다.";
  }
  if (!new Set(["A", "B"]).has(values.rackFace)) return "보관 면 값이 올바르지 않습니다.";
  if (Number(work.is_single_sided) && values.rackFace === "B") return "단면 랙은 2면을 선택할 수 없습니다.";
  if (Number(work.requested_tag_count || 0) !== Number(work.active_tag_count || 0)) return "사용할 수 없는 태그가 포함되어 있습니다.";
  return "";
}

function normalizeStagedPayload(item = {}) {
  const source = item.values || item;
  const tagIds = [...new Set((source.tagIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  return {
    values: {
      documentNumber: clean(source.documentNumber),
      revisionNumber: clean(source.revisionNumber) || "Rev.0",
      revisionDate: clean(source.revisionDate),
      disposalDueYear: clean(source.disposalDueYear),
      documentName: clean(source.documentName),
      categoryId: Number(source.categoryId),
      rackSlotId: Number(source.rackSlotId),
      rackFace: source.rackFace === "B" ? "B" : "A",
      note: clean(source.note),
      tagIds
    },
    status: item.status === "disposed" ? "disposed" : "active"
  };
}

function importJobFromWork(work) {
  return {
    id: work.job_id,
    job_code: work.job_code,
    source_name: work.source_name,
    status: work.job_status,
    total_count: Number(work.total_count || 0),
    completed_count: Number(work.completed_count || 0),
    failed_count: Number(work.failed_count || 0),
    pending_count: Math.max(0, Number(work.total_count || 0) - Number(work.completed_count || 0) - Number(work.failed_count || 0)),
    created_at: work.created_at,
    completed_at: work.completed_at
  };
}

function friendlyImportFailure(error) {
  const message = clean(error?.message);
  if (/UNIQUE/i.test(message)) return "중복된 값 때문에 문서를 등록할 수 없습니다.";
  if (/FOREIGN KEY|CHECK constraint/i.test(message)) return "대분류 또는 보관 위치가 변경되어 등록할 수 없습니다.";
  return null;
}

function requiredActorId(actor) {
  const id = Number(actor?.userId ?? actor?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("작업 사용자 ID를 확인할 수 없습니다.");
  return id;
}

function actorName(actor) {
  return clean(actor?.displayName) || clean(actor?.username) || "알 수 없음";
}

function actorUsername(actor) {
  return clean(actor?.username) || "unknown";
}

function actorPermissionsSnapshot(actor) {
  const snapshot = { role: clean(actor?.role) || "User" };
  for (const [key, value] of Object.entries(actor || {})) {
    if (key.startsWith("can_") || key === "canViewAudit") snapshot[key] = Boolean(value);
  }
  return JSON.stringify(snapshot);
}
