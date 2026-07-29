import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { exactChangeCountAssertionSql } from "../../../platform/d1/expectedChange.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { clean } from "../../../shared/text/normalize.js";
import { SNAPSHOT_ERROR_CODES, snapshotError } from "../domain/errorCodes.js";
import { createSnapshotPlan } from "./support.js";

const SEED_PREDICATE = `
  note = 'Cloudflare 테스트 기본 문서'
  AND (
    (storage_code = 'ARC-000001' AND document_number = 'MR-2026-001')
    OR (storage_code = 'ARC-000002' AND document_number = 'PV-2026-014')
  )
`;

export async function scheduleBootstrapApplication(env, {
  snapshotId,
  actorSnapshot,
  role,
  applyReason,
  approvalReference,
  applyDetails
}) {
  const scheduled = await env.DB.prepare(`
    UPDATE document_snapshots
    SET status = 'applying',
        apply_reason = ?,
        approval_reference = NULLIF(?, ''),
        bootstrap_progress_count = 0,
        bootstrap_next_run_at = datetime(CURRENT_TIMESTAMP, 'start of day', '+1 day'),
        bootstrap_processing_token = NULL,
        bootstrap_apply_actor_json = ?,
        bootstrap_apply_details_json = ?,
        bootstrap_apply_role = ?,
        bootstrap_apply_started_at = CURRENT_TIMESTAMP,
        bootstrap_last_processed_at = NULL,
        error_summary = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'ready'
      AND mode = 'bootstrap'
      AND create_count = total_count
      AND update_count = 0
      AND exclude_count = 0
      AND base_version = (SELECT current_version FROM document_sync_state WHERE id = 1)
    RETURNING *
  `).bind(
    applyReason,
    approvalReference || "",
    JSON.stringify(actorSnapshot),
    JSON.stringify(applyDetails),
    clean(role) || "Admin",
    snapshotId
  ).first();
  if (!scheduled) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_CONCURRENT_APPLY,
      "최초 대량등록 예약 중 작업 상태가 변경되었습니다. 화면을 새로고침해 주세요.",
      { stale: true }
    );
  }
  return {
    ok: true,
    snapshot: scheduled,
    scheduled: true,
    processing: true,
    chunkSize: FREE_TIER_BUDGET.bootstrapApplyChunkSize
  };
}

export async function runScheduledBootstrapApplication(env, { force = false } = {}) {
  const due = await env.DB.prepare(`
    SELECT *
    FROM document_snapshots
    WHERE status = 'applying'
      AND mode = 'bootstrap'
      AND bootstrap_apply_actor_json IS NOT NULL
      AND bootstrap_progress_count <= total_count
      AND (
        ? = 1
        OR bootstrap_next_run_at IS NULL
        OR bootstrap_next_run_at <= CURRENT_TIMESTAMP
      )
      AND (
        bootstrap_processing_token IS NULL
        OR bootstrap_last_processed_at IS NULL
        OR bootstrap_last_processed_at < datetime(CURRENT_TIMESTAMP, '-30 minutes')
      )
    ORDER BY bootstrap_next_run_at, id
    LIMIT 1
  `).bind(force ? 1 : 0).first();
  if (!due) return { ok: true, processed: false };

  const token = crypto.randomUUID();
  const claimed = await env.DB.prepare(`
    UPDATE document_snapshots
    SET bootstrap_processing_token = ?,
        bootstrap_last_processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'applying'
      AND mode = 'bootstrap'
      AND bootstrap_progress_count = ?
      AND (
        bootstrap_processing_token IS NULL
        OR bootstrap_last_processed_at IS NULL
        OR bootstrap_last_processed_at < datetime(CURRENT_TIMESTAMP, '-30 minutes')
      )
    RETURNING *
  `).bind(token, due.id, due.bootstrap_progress_count).first();
  if (!claimed) return { ok: true, processed: false, claimed: false };

  const total = Number(claimed.total_count || 0);
  const progress = Number(claimed.bootstrap_progress_count || 0);
  const finalizeOnly = progress === total;
  const chunkSize = finalizeOnly ? 0 : Math.min(FREE_TIER_BUDGET.bootstrapApplyChunkSize, total - progress);
  const isFirst = progress === 0;
  if (!total || progress > total || (!finalizeOnly && chunkSize <= 0) || Number(claimed.create_count || 0) !== total) {
    await releaseFailedClaim(env, claimed.id, token, "최초 대량등록 계획의 건수가 올바르지 않습니다.");
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "최초 대량등록 계획의 건수가 올바르지 않습니다.");
  }

  const actor = parseJsonObject(claimed.bootstrap_apply_actor_json);
  const applyDetails = parseJsonObject(claimed.bootstrap_apply_details_json);
  const statements = buildChunkStatements(env, {
    snapshot: claimed,
    token,
    progress,
    chunkSize,
    total,
    isFirst,
    finalizeOnly,
    actor,
    applyDetails
  });

  try {
    const results = await executeMutationBatch(env, createSnapshotPlan("bootstrap-chunk", statements));
    const current = results.findLast?.((result) => result?.results?.[0]?.snapshot_code)?.results?.[0]
      || await env.DB.prepare("SELECT * FROM document_snapshots WHERE id = ?").bind(claimed.id).first();
    return {
      ok: true,
      processed: true,
      completed: finalizeOnly,
      snapshot: current,
      processedCount: chunkSize,
      progressCount: progress + chunkSize,
      totalCount: total
    };
  } catch (error) {
    await releaseFailedClaim(env, claimed.id, token, clean(error?.message).slice(0, 1000) || "분할 반영에 실패했습니다.");
    throw error;
  }
}

function buildChunkStatements(env, {
  snapshot,
  token,
  progress,
  chunkSize,
  total,
  isFirst,
  finalizeOnly,
  actor,
  applyDetails
}) {
  const id = Number(snapshot.id);
  const statements = [
    env.DB.prepare(`
      UPDATE bootstrap_runtime_control
      SET suppress_derived_triggers = 1,
          suppress_capacity_triggers = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
        AND suppress_derived_triggers = 0
        AND suppress_capacity_triggers = 0
        AND EXISTS (
          SELECT 1 FROM document_snapshots
          WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
        )
    `).bind(id, token),
    env.DB.prepare(exactChangeCountAssertionSql("1"))
  ];

  if (isFirst) {
    statements.push(
      env.DB.prepare(`
        DELETE FROM documents
        WHERE ${SEED_PREDICATE}
          AND (SELECT COUNT(*) FROM documents) = 2
          AND EXISTS (
            SELECT 1 FROM document_snapshots
            WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
          )
      `).bind(id, token),
      env.DB.prepare(exactChangeCountAssertionSql("2"))
    );
  }

  if (!finalizeOnly) {
    statements.push(
      env.DB.prepare(`
      INSERT INTO documents (
        storage_code, excel_row_key, category_id, document_number, revision_number,
        revision_date, disposal_due_year, document_name, note, rack_slot_id, rack_face,
        status, sync_state, last_snapshot_id, updated_at
      )
      SELECT
        'ARC-' || printf('%06d', row.row_number - 1),
        row.row_key,
        CAST(json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.categoryId') AS INTEGER),
        json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.documentNumber'),
        json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.revisionNumber'),
        NULLIF(json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.revisionDate'), ''),
        CAST(NULLIF(json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.disposalDueYear'), '') AS INTEGER),
        json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.documentName'),
        NULLIF(json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.note'), ''),
        CAST(json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.rackSlotId') AS INTEGER),
        json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.rackFace'),
        json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.status'),
        'excluded', row.snapshot_id, CURRENT_TIMESTAMP
      FROM document_snapshot_rows row
      WHERE row.snapshot_id = ?
        AND row.action = 'create'
        AND EXISTS (
          SELECT 1 FROM document_snapshots
          WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
        )
      ORDER BY row.row_number
      LIMIT ? OFFSET ?
      `).bind(id, id, token, chunkSize, progress),
      env.DB.prepare(exactChangeCountAssertionSql(String(chunkSize))),
      env.DB.prepare(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      SELECT d.id, CAST(tag.value AS INTEGER)
      FROM (
        SELECT * FROM document_snapshot_rows
        WHERE snapshot_id = ? AND action = 'create'
        ORDER BY row_number
        LIMIT ? OFFSET ?
      ) row
      JOIN documents d ON d.excel_row_key = row.row_key AND d.last_snapshot_id = ?
      CROSS JOIN json_each(json_extract(COALESCE(row.after_json, row.normalized_json), '$.values.tagIds')) tag
      JOIN tags t ON t.id = CAST(tag.value AS INTEGER) AND t.is_active = 1
      WHERE EXISTS (
        SELECT 1 FROM document_snapshots
        WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
      )
      `).bind(id, chunkSize, progress, id, id, token),
      env.DB.prepare(`
      UPDATE document_snapshots
      SET bootstrap_progress_count = bootstrap_progress_count + ?,
          bootstrap_last_processed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'applying'
        AND bootstrap_processing_token = ?
        AND bootstrap_progress_count = ?
      `).bind(chunkSize, id, token, progress),
      env.DB.prepare(exactChangeCountAssertionSql("1")),
      env.DB.prepare(`
        UPDATE document_snapshots
        SET bootstrap_next_run_at = datetime(CURRENT_TIMESTAMP, 'start of day', '+1 day'),
            bootstrap_processing_token = NULL,
            error_summary = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
        RETURNING *
      `).bind(id, token),
      env.DB.prepare(`
        UPDATE bootstrap_runtime_control
        SET suppress_derived_triggers = 0,
            suppress_capacity_triggers = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1 AND suppress_derived_triggers = 1 AND suppress_capacity_triggers = 1
      `),
      env.DB.prepare(exactChangeCountAssertionSql("1"))
    );
    return statements;
  }

  statements.push(
    env.DB.prepare(`
      UPDATE documents
      SET sync_state = 'current', updated_at = CURRENT_TIMESTAMP
      WHERE last_snapshot_id = ? AND sync_state = 'excluded'
        AND EXISTS (
          SELECT 1 FROM document_snapshots
          WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
            AND bootstrap_progress_count = total_count
        )
    `).bind(id, id, token),
    env.DB.prepare(exactChangeCountAssertionSql(String(total))),
    env.DB.prepare(`
      UPDATE document_capacity_state
      SET current_document_count = (SELECT COUNT(*) FROM documents WHERE sync_state = 'current'),
          active_document_count = (SELECT COUNT(*) FROM documents WHERE sync_state = 'current' AND status = 'active'),
          disposed_document_count = (SELECT COUNT(*) FROM documents WHERE sync_state = 'current' AND status = 'disposed'),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `),
    env.DB.prepare(`
      UPDATE search_index_state
      SET rebuild_required = 1,
          generation = generation + 1,
          indexed_document_count = 0,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `),
    env.DB.prepare(`
      UPDATE search_projection_state
      SET generation = generation + 1,
          reindex_status = 'pending',
          reindex_cursor = 0,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `),
    env.DB.prepare(`
      INSERT INTO system_audit_logs (
        entity_type, entity_id, entity_reference, action, actor_user_id,
        actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
        summary, details_json
      )
      SELECT 'document_snapshot', CAST(id AS TEXT), snapshot_code, 'apply', ?, ?, ?, ?, ?, ?
      FROM document_snapshots
      WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
    `).bind(
      Number(actor.userId || 0) || null,
      clean(actor.username),
      clean(actor.displayName) || "관리자",
      JSON.stringify(Array.isArray(actor.permissions) ? actor.permissions : []),
      "엑셀 문서대장 최초 대량등록 자동 분할 반영",
      JSON.stringify({ ...applyDetails, automaticChunkSize: FREE_TIER_BUDGET.bootstrapApplyChunkSize }),
      id,
      token
    ),
    env.DB.prepare(`
      UPDATE document_sync_state
      SET current_version = current_version + 1,
          current_snapshot_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
        AND EXISTS (
          SELECT 1 FROM document_snapshots
          WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
        )
    `).bind(id, id, token),
    env.DB.prepare(`
      UPDATE bootstrap_runtime_control
      SET suppress_derived_triggers = 0,
          suppress_capacity_triggers = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND suppress_derived_triggers = 1 AND suppress_capacity_triggers = 1
    `),
    env.DB.prepare(exactChangeCountAssertionSql("1")),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'completed',
          bootstrap_progress_count = total_count,
          bootstrap_next_run_at = NULL,
          bootstrap_processing_token = NULL,
          error_summary = NULL,
          applied_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
      RETURNING *
    `).bind(id, token)
  );
  return statements;
}

async function releaseFailedClaim(env, snapshotId, token, message) {
  await env.DB.prepare(`
    UPDATE document_snapshots
    SET bootstrap_processing_token = NULL,
        bootstrap_next_run_at = datetime(CURRENT_TIMESTAMP, '+1 hour'),
        error_summary = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'applying' AND bootstrap_processing_token = ?
  `).bind(clean(message).slice(0, 1000), snapshotId, token).run();
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
