import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { createBatchPlan } from "../../../platform/d1/batchPlan.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { isExpectedChangeAbort } from "../../../platform/d1/expectedChange.js";
import { hasPermission, PERMISSIONS, permissionSnapshot } from "../../../permissions.js";
import { clean } from "../../../shared/text/normalize.js";
import { auditActorSnapshot } from "../../identity/index.js";
import {
  approvalReferenceRequired,
  APPROVAL_POLICY_VERSION,
  evaluateSnapshotApplyAuthorization,
  missingPermissionsForSession,
  normalizeApplyReason,
  normalizeSyncReason,
  requiredPermissionsForDiff,
  resolveSnapshotApplyMode
} from "../domain/authorization.js";
import { formatCanonicalErrors, prepareCanonicalSnapshotRows } from "../domain/canonicalRow.js";
import { computeRiskWarnings, summarizeChangeFlags } from "../domain/diff.js";
import { SNAPSHOT_ERROR_CODES, snapshotError } from "../domain/errorCodes.js";
import {
  computeCanonicalRowsHash,
  computeExportManifestHash,
  computeExportPageChainHash,
  SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS
} from "../domain/hash.js";
import { isStableRowKey, temporaryStagingRowKey } from "../domain/identity.js";
import { matchCanonicalSnapshotRows } from "../domain/matchRows.js";
import { validateRevisionHistorySnapshotChanges } from "../domain/revisionPolicy.js";
import { buildDocumentAuditDetails, buildSystemApplyAuditDetails } from "../domain/auditPayload.js";
import { buildApplyStatements } from "./applyPlan.js";

const SNAPSHOT_STATUSES = new Set(["staging", "ready", "applying", "completed", "cancelled", "failed"]);
const ROW_ACTIONS = new Set(["staged", "create", "update", "unchanged"]);
const BOOTSTRAP_CONFIRMATION = "BOOTSTRAP";

export async function getDocumentSyncState(env) {
  const row = await env.DB.prepare(`
    SELECT current_version, current_snapshot_id, updated_at
    FROM document_sync_state
    WHERE id = 1
  `).first();
  return {
    currentVersion: Number(row?.current_version || 1),
    currentSnapshotId: Number(row?.current_snapshot_id || 0),
    updatedAt: clean(row?.updated_at)
  };
}

export async function listDocumentSnapshots(env, { limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const result = await env.DB.prepare(`
    SELECT *
    FROM document_snapshots
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return result.results ?? [];
}

export async function getDocumentSnapshot(env, id) {
  return env.DB.prepare(`
    SELECT *
    FROM document_snapshots
    WHERE id = ?
  `).bind(id).first();
}

export async function getDocumentSnapshotRows(env, snapshotId, { action = "", limit = 1000 } = {}) {
  const safeAction = ROW_ACTIONS.has(action) ? action : "";
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, FREE_TIER_BUDGET.excelSnapshotMaxItems));
  const result = await env.DB.prepare(`
    SELECT
      id, snapshot_id, row_number, row_key, source_row_key, source_json, normalized_json,
      before_json, after_json, changed_fields_json, change_flags_json,
      action, matched_document_id, expected_row_version
    FROM document_snapshot_rows
    WHERE snapshot_id = ? AND (? = '' OR action = ?)
    ORDER BY row_number
    LIMIT ?
  `).bind(snapshotId, safeAction, safeAction, safeLimit).all();
  return result.results ?? [];
}

export async function getDocumentSnapshotExclusions(env, snapshotId) {
  const result = await env.DB.prepare(`
    SELECT
      ex.id, ex.snapshot_id, ex.document_id, ex.excel_row_key, ex.expected_row_version,
      ex.before_json, ex.created_at,
      (SELECT COUNT(*) FROM document_set_items item WHERE item.document_id = ex.document_id) AS set_count,
      (SELECT MAX(movement.created_at) FROM document_movements movement WHERE movement.document_id = ex.document_id) AS recent_movement_at
    FROM document_snapshot_exclusions ex
    WHERE ex.snapshot_id = ?
    ORDER BY ex.document_id
  `).bind(snapshotId).all();
  return result.results ?? [];
}

export async function createDocumentSnapshot(env, input, actor) {
  const sourceName = clean(input?.sourceName).slice(0, 200) || "문서고 관리대장.xlsx";
  const sourceHash = clean(input?.sourceHash || input?.clientSourceHash).toLowerCase();
  const totalCount = Number(input?.totalCount);
  const sourceSize = Number(input?.sourceSize);
  const schemaVersion = Number(input?.schemaVersion);
  const mode = clean(input?.mode) === "bootstrap" ? "bootstrap" : "managed";
  const exportManifestId = clean(input?.exportManifestId) || null;
  const canonicalExportHash = clean(input?.canonicalExportHash).toLowerCase();
  const requestedBaseVersion = optionalPositiveInteger(input?.baseVersion);
  const requestedSnapshotId = optionalPositiveInteger(input?.currentSnapshotId);

  if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "브라우저가 보고한 원본 파일 해시를 확인할 수 없습니다.");
  }
  if (!Number.isInteger(sourceSize) || sourceSize < 1) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "원본 엑셀 파일 크기를 확인할 수 없습니다.");
  }
  if (sourceSize > FREE_TIER_BUDGET.excelSnapshotMaxFileBytes) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_FILE_TOO_LARGE,
      `엑셀 파일은 ${Math.floor(FREE_TIER_BUDGET.excelSnapshotMaxFileBytes / 1024 / 1024)}MB 이하여야 합니다.`
    );
  }
  if (!Number.isInteger(totalCount) || totalCount < 1 || totalCount > FREE_TIER_BUDGET.excelSnapshotMaxItems) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH, `엑셀 문서는 1~${FREE_TIER_BUDGET.excelSnapshotMaxItems}건까지 동기화할 수 있습니다.`);
  }
  if (!SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS.has(schemaVersion)) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_SCHEMA_UNSUPPORTED, "지원하지 않는 엑셀 스키마 버전입니다.");
  }
  const reason = normalizeSyncReason(input?.syncReason ?? input?.applyReason);
  if (!reason.ok) return reason;

  const state = await getDocumentSyncState(env);

  if (mode === "bootstrap") {
    if (actor?.role !== "Admin" || !hasPermission(actor, PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_BOOTSTRAP_FORBIDDEN, "bootstrap은 Admin만 사용할 수 있습니다.");
    }
    if (state.currentSnapshotId) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_BOOTSTRAP_FORBIDDEN, "이미 관리 스냅샷이 있어 bootstrap을 다시 실행할 수 없습니다.");
    }
    if (clean(input?.bootstrapConfirmation) !== BOOTSTRAP_CONFIRMATION || !readBoolean(input?.backupConfirmed)) {
      return snapshotError(
        SNAPSHOT_ERROR_CODES.SNAPSHOT_BOOTSTRAP_CONFIRMATION_REQUIRED,
        `bootstrap은 운영 backup 확인 후 ${BOOTSTRAP_CONFIRMATION} 확인문구를 정확히 입력해야 합니다.`
      );
    }
  } else {
    if (!requestedBaseVersion) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_METADATA_REQUIRED, "관리 파일에는 baseVersion 메타데이터가 필요합니다.");
    }
    if (!requestedSnapshotId && !exportManifestId) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_METADATA_REQUIRED, "관리 파일에는 currentSnapshotId 또는 exportManifestId가 필요합니다.");
    }
    if (requestedBaseVersion !== state.currentVersion) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE, "이 엑셀을 추출한 뒤 문서고가 변경되었습니다. 최신 엑셀을 다시 추출해 작업하세요.", { stale: true });
    }
    if (requestedSnapshotId && requestedSnapshotId !== state.currentSnapshotId) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_EXPORT_PROVENANCE_INVALID, "관리 파일의 기준 snapshot이 현재 문서고 상태와 일치하지 않습니다.");
    }
    if (exportManifestId) {
      const manifest = await env.DB.prepare(`
        SELECT manifest_id, schema_version, base_version, current_snapshot_id,
               canonical_export_hash, created_by_user_id, status, finalized_at
        FROM document_snapshot_export_manifests
        WHERE manifest_id = ?
      `).bind(exportManifestId).first();
      const sameActor = !manifest?.created_by_user_id || Number(manifest.created_by_user_id) === Number(actor?.userId);
      if (
        !manifest ||
        manifest.status !== "completed" ||
        !manifest.finalized_at ||
        Number(manifest.schema_version) !== schemaVersion ||
        Number(manifest.base_version) !== state.currentVersion ||
        Number(manifest.current_snapshot_id || 0) !== state.currentSnapshotId ||
        !/^[a-f0-9]{64}$/.test(canonicalExportHash) ||
        canonicalExportHash !== clean(manifest.canonical_export_hash).toLowerCase() ||
        (!sameActor && actor?.role !== "Admin")
      ) {
        return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_EXPORT_PROVENANCE_INVALID, "서버가 발급한 엑셀 export 출처를 확인할 수 없습니다.");
      }
    }
  }

  const temporaryCode = `SNP-TEMP-${crypto.randomUUID()}`;
  const actorSnapshot = auditActorSnapshot(actor);
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_snapshots (
        snapshot_code, source_name, source_hash, schema_version, base_version, previous_snapshot_id, status,
        mode, export_manifest_id, has_row_keys, total_count, source_size, apply_reason,
        bootstrap_backup_confirmed, bootstrap_confirmed_at, created_by_user_id, created_by_name
      )
      SELECT ?, ?, ?, ?, state.current_version, NULLIF(state.current_snapshot_id, 0), 'staging', ?, ?, ?, ?, ?, ?, ?,
             CASE WHEN ? = 'bootstrap' THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?
      FROM document_sync_state state
      WHERE state.id = 1
        AND state.current_version = ?
        AND COALESCE(state.current_snapshot_id, 0) = ?
      RETURNING id
    `).bind(
      temporaryCode,
      sourceName,
      sourceHash,
      schemaVersion,
      mode,
      exportManifestId,
      input?.hasRowKeys ? 1 : 0,
      totalCount,
      sourceSize,
      reason.syncReason,
      mode === "bootstrap" ? 1 : 0,
      mode,
      actorSnapshot.userId,
      actorSnapshot.displayName,
      state.currentVersion,
      state.currentSnapshotId
    ),
    env.DB.prepare(`
      INSERT INTO system_audit_logs (
        entity_type, entity_id, entity_reference, action, actor_user_id,
        actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
        summary, details_json
      )
      SELECT
        'document_snapshot', CAST(id AS TEXT),
        'SNP-' || strftime('%Y', 'now') || '-' || printf('%04d', id),
        'create', ?, ?, ?, ?, '엑셀 문서대장 동기화 시작',
        json_object(
          'sourceName', source_name,
          'clientSourceHash', source_hash,
          'sourceSize', source_size,
          'totalCount', total_count,
          'syncReason', apply_reason,
          'baseVersion', base_version,
          'schemaVersion', schema_version,
          'mode', mode,
          'exportManifestId', export_manifest_id,
          'bootstrapBackupConfirmed', bootstrap_backup_confirmed
        )
      FROM document_snapshots
      WHERE snapshot_code = ?
    `).bind(
      actorSnapshot.userId,
      actorSnapshot.username,
      actorSnapshot.displayName,
      JSON.stringify(actorSnapshot.permissions),
      temporaryCode
    ),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET snapshot_code = 'SNP-' || strftime('%Y', 'now') || '-' || printf('%04d', id),
          updated_at = CURRENT_TIMESTAMP
      WHERE snapshot_code = ?
    `).bind(temporaryCode)
  ];
  if (exportManifestId) {
    statements.push(env.DB.prepare(`
      UPDATE document_snapshot_export_manifests
      SET last_used_at = CURRENT_TIMESTAMP,
          last_snapshot_id = (
            SELECT id FROM document_snapshots
            WHERE export_manifest_id = ?
            ORDER BY id DESC LIMIT 1
          )
      WHERE manifest_id = ?
        AND EXISTS (
          SELECT 1 FROM document_snapshots
          WHERE export_manifest_id = ?
        )
    `).bind(exportManifestId, exportManifestId, exportManifestId));
  }
  const results = await executeMutationBatch(env, createSnapshotPlan("create", statements));
  const id = Number(results[0]?.results?.[0]?.id || 0);
  if (!id) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE, "동기화 작업 생성 중 문서고가 변경되었습니다. 최신 엑셀을 다시 추출하세요.", { stale: true });
  }
  return { ok: true, id, baseVersion: state.currentVersion, mode };
}

export async function stageDocumentSnapshotRows(env, snapshotId, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > FREE_TIER_BUDGET.excelSnapshotStageChunkSize) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH, `한 번에 ${FREE_TIER_BUDGET.excelSnapshotStageChunkSize}행씩 전송해야 합니다.`);
  }
  const normalized = [];
  const seenRows = new Set();
  const seenKeys = new Set();
  for (const entry of rows) {
    const rowNumber = Number(entry?.rowNumber);
    const sourceRowKey = clean(entry?.sourceRowKey ?? entry?.rowKey);
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > FREE_TIER_BUDGET.excelSnapshotMaxItems + 1) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "엑셀 행 번호가 올바르지 않습니다.");
    }
    if (sourceRowKey && !isStableRowKey(sourceRowKey)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `${rowNumber}행의 숨김 관리 ID가 올바르지 않습니다.`);
    }
    if (seenRows.has(rowNumber)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_DUPLICATE, "같은 행 번호가 중복되었습니다.");
    }
    if (sourceRowKey && seenKeys.has(sourceRowKey)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_DUPLICATE, "같은 관리 ID가 중복되었습니다.");
    }
    seenRows.add(rowNumber);
    if (sourceRowKey) seenKeys.add(sourceRowKey);
    const stagingKey = sourceRowKey || temporaryStagingRowKey(snapshotId, rowNumber);
    normalized.push({
      rowNumber,
      rowKey: stagingKey,
      sourceRowKey: sourceRowKey || null,
      source: normalizeSourceRow(entry?.source)
    });
  }

  const payload = JSON.stringify(normalized);
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_snapshot_rows (snapshot_id, row_number, row_key, source_row_key, source_json)
      SELECT
        ?,
        CAST(json_extract(staged.value, '$.rowNumber') AS INTEGER),
        json_extract(staged.value, '$.rowKey'),
        NULLIF(json_extract(staged.value, '$.sourceRowKey'), ''),
        json(json_extract(staged.value, '$.source'))
      FROM json_each(?) staged
      WHERE EXISTS (
        SELECT 1 FROM document_snapshots
        WHERE id = ? AND status = 'staging'
      )
      ON CONFLICT(snapshot_id, row_number) DO UPDATE SET
        row_key = excluded.row_key,
        source_row_key = excluded.source_row_key,
        source_json = excluded.source_json,
        normalized_json = NULL,
        before_json = NULL,
        after_json = NULL,
        changed_fields_json = NULL,
        change_flags_json = NULL,
        expected_row_version = NULL,
        action = 'staged',
        matched_document_id = NULL
    `).bind(snapshotId, payload, snapshotId),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET staged_count = (SELECT COUNT(*) FROM document_snapshot_rows WHERE snapshot_id = ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'staging'
      RETURNING staged_count, total_count
    `).bind(snapshotId, snapshotId)
  ];
  const results = await executeMutationBatch(env, createSnapshotPlan("stage", statements));
  const progress = results[1]?.results?.[0];
  if (!progress) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "행을 추가할 수 없는 동기화 작업입니다.");
  return { ok: true, stagedCount: Number(progress.staged_count || 0), totalCount: Number(progress.total_count || 0) };
}

export async function stageDocumentSnapshotMembership(env, snapshotId, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > FREE_TIER_BUDGET.excelSnapshotMembershipChunkSize) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH,
      `membership은 한 번에 ${FREE_TIER_BUDGET.excelSnapshotMembershipChunkSize}행까지 전송할 수 있습니다.`
    );
  }
  const normalized = [];
  const seenRows = new Set();
  const seenKeys = new Set();
  for (const entry of rows) {
    const rowNumber = Number(entry?.rowNumber);
    const rowKey = clean(entry?.rowKey ?? entry?.sourceRowKey);
    const baseRowVersion = optionalPositiveInteger(entry?.baseRowVersion);
    const baseHash = clean(entry?.baseHash).toLowerCase();
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > FREE_TIER_BUDGET.excelSnapshotMaxItems + 1) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "membership 행 번호가 올바르지 않습니다.");
    }
    if (!rowKey || !isStableRowKey(rowKey)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `${rowNumber}행의 숨김 관리 ID가 올바르지 않습니다.`);
    }
    if (baseHash && !/^[a-f0-9]{64}$/.test(baseHash)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `${rowNumber}행의 기준 행 해시가 올바르지 않습니다.`);
    }
    if (seenRows.has(rowNumber) || seenKeys.has(rowKey)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_DUPLICATE, "membership 행 번호 또는 관리 ID가 중복되었습니다.");
    }
    seenRows.add(rowNumber);
    seenKeys.add(rowKey);
    normalized.push({ rowNumber, rowKey, baseRowVersion, baseHash: baseHash || null });
  }
  const payload = JSON.stringify(normalized);
  const results = await executeMutationBatch(env, createSnapshotPlan("membership", [
    env.DB.prepare(`
      INSERT INTO document_snapshot_membership (
        snapshot_id, row_number, row_key, base_row_version, base_hash
      )
      SELECT
        ?,
        CAST(json_extract(item.value, '$.rowNumber') AS INTEGER),
        json_extract(item.value, '$.rowKey'),
        CAST(json_extract(item.value, '$.baseRowVersion') AS INTEGER),
        NULLIF(json_extract(item.value, '$.baseHash'), '')
      FROM json_each(?) item
      WHERE EXISTS (
        SELECT 1 FROM document_snapshots
        WHERE id = ? AND status = 'staging' AND schema_version = 2
      )
      ON CONFLICT(snapshot_id, row_number) DO UPDATE SET
        row_key = excluded.row_key,
        base_row_version = excluded.base_row_version,
        base_hash = excluded.base_hash
    `).bind(snapshotId, payload, snapshotId),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'staging' AND schema_version = 2
      RETURNING (
        SELECT COUNT(*) FROM document_snapshot_membership WHERE snapshot_id = ?
      ) AS membership_count
    `).bind(snapshotId, snapshotId)
  ]));
  const count = Number(results[1]?.results?.[0]?.membership_count || 0);
  if (!count) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "membership을 추가할 수 없는 동기화 작업입니다.");
  return { ok: true, membershipCount: count };
}

export async function prepareDocumentSnapshot(env, snapshotId, options, _legacyPrepareRows, actor) {
  const snapshot = await getDocumentSnapshot(env, snapshotId);
  if (!snapshot) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_NOT_FOUND, "엑셀 동기화 작업을 찾을 수 없습니다.");
  if (snapshot.status === "ready" || snapshot.status === "completed") return { ok: true, snapshot };
  if (snapshot.status !== "staging") {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "검증할 수 없는 동기화 작업 상태입니다.");
  }

  const [rowResult, membershipResult, documentResult, revisionLinkResult, state] = await Promise.all([
    env.DB.prepare(`
      SELECT row_number, row_key, source_row_key, source_json
      FROM document_snapshot_rows
      WHERE snapshot_id = ?
      ORDER BY row_number
    `).bind(snapshotId).all(),
    env.DB.prepare(`
      SELECT row_number, row_key, base_row_version, base_hash
      FROM document_snapshot_membership
      WHERE snapshot_id = ?
      ORDER BY row_number
    `).bind(snapshotId).all(),
    env.DB.prepare(`
      SELECT
        d.id, d.storage_code, d.excel_row_key, d.sync_state, d.category_id, d.document_number,
        d.revision_number, d.revision_date, d.disposal_due_year, d.document_name,
        d.note, d.rack_slot_id, d.rack_face, d.status, d.row_version,
        GROUP_CONCAT(dt.tag_id, ',') AS tag_ids
      FROM documents d
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      GROUP BY d.id
      ORDER BY d.id
    `).all(),
    env.DB.prepare(`
      SELECT previous_document_id, new_document_id
      FROM document_revision_links
    `).all(),
    getDocumentSyncState(env)
  ]);
  const stagedRows = rowResult.results ?? [];
  const membershipRows = membershipResult.results ?? [];
  const schemaVersion = Number(snapshot.schema_version || 1);
  // schema v2 정식 클라이언트는 membership을 먼저 보내지만, 배포 중 열린 탭처럼
  // 전체 행을 staging한 호출도 전환 릴리스 동안 호환한다.
  const usesMembership = schemaVersion >= 2 && membershipRows.length > 0;
  const receivedCount = usesMembership ? membershipRows.length : stagedRows.length;
  if (receivedCount !== Number(snapshot.total_count) || stagedRows.length !== Number(snapshot.staged_count)) {
    return failSnapshotValidation(
      env,
      snapshotId,
      `전체 ${snapshot.total_count}행 중 ${receivedCount}행의 membership만 전송되었습니다.`,
      actor,
      false,
      SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH
    );
  }
  if (
    usesMembership &&
    snapshot.mode !== "bootstrap" &&
    stagedRows.length > FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems
  ) {
    return failSnapshotValidation(
      env,
      snapshotId,
      `일상 변경 영향은 최대 ${FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems}건입니다. 최신 대장을 기준으로 작업을 나누세요.`,
      actor,
      false,
      SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH
    );
  }
  if (state.currentVersion !== Number(snapshot.base_version)) {
    return failSnapshotValidation(
      env,
      snapshotId,
      "검증 중 문서고가 변경되었습니다. 최신 엑셀로 다시 시작하세요.",
      actor,
      true,
      SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE
    );
  }

  let sourceRows;
  try {
    sourceRows = stagedRows.map((row) => ({
      ...JSON.parse(row.source_json),
      rowNumber: Number(row.row_number),
      sourceRowKey: clean(row.source_row_key),
      rowKey: clean(row.source_row_key || row.row_key)
    }));
    if (usesMembership) {
      const stagedNumbers = new Set(stagedRows.map((row) => Number(row.row_number)));
      const documentsByKey = new Map((documentResult.results ?? []).map((document) => [clean(document.excel_row_key), document]));
      for (const membership of membershipRows) {
        const rowNumber = Number(membership.row_number);
        if (stagedNumbers.has(rowNumber)) continue;
        const document = documentsByKey.get(clean(membership.row_key));
        if (!document || document.sync_state !== "current") {
          throw new Error(`${rowNumber}행의 기준 문서를 찾을 수 없습니다.`);
        }
        if (
          Number(membership.base_row_version || 0) > 0 &&
          Number(membership.base_row_version) !== Number(document.row_version)
        ) {
          throw new Error(`${rowNumber}행의 기준 버전이 현재 문서와 다릅니다.`);
        }
        sourceRows.push(sourceRowFromCurrentDocument(document, membership, options));
      }
      sourceRows.sort((left, right) => Number(left.rowNumber) - Number(right.rowNumber));
    }
  } catch {
    return failSnapshotValidation(env, snapshotId, "저장된 엑셀 행 또는 기준 membership을 읽을 수 없습니다.", actor);
  }

  const prepared = prepareCanonicalSnapshotRows(sourceRows, options);
  if (!prepared.ok) {
    return failSnapshotValidation(
      env,
      snapshotId,
      formatCanonicalErrors(prepared.errors),
      actor,
      false,
      SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD,
      { errors: prepared.errors }
    );
  }

  const lookup = {
    categoryNames: new Map((options.categories || []).map((category) => [Number(category.id), category.name])),
    tagNames: new Map((options.tags || []).map((tag) => [Number(tag.id), tag.name])),
    slotsById: new Map((options.slots || []).map((slot) => [Number(slot.id), slot]))
  };
  const existingDocuments = snapshot.mode === "bootstrap"
    ? (documentResult.results ?? []).filter((document) => !isInitialBootstrapSeed(document))
    : (documentResult.results ?? []);
  const match = matchCanonicalSnapshotRows(prepared.items, existingDocuments, {
    managedMode: snapshot.mode !== "bootstrap",
    lookup
  });
  if (!match.ok) {
    return failSnapshotValidation(
      env,
      snapshotId,
      formatCanonicalErrors(match.errors),
      actor,
      false,
      match.errors[0]?.code || SNAPSHOT_ERROR_CODES.SNAPSHOT_IDENTITY_CONFLICT,
      { errors: match.errors }
    );
  }

  const revisionPolicy = validateRevisionHistorySnapshotChanges(
    match.items,
    revisionLinkResult.results ?? []
  );
  if (!revisionPolicy.ok) {
    return failSnapshotValidation(
      env,
      snapshotId,
      formatCanonicalErrors(revisionPolicy.errors),
      actor,
      false,
      SNAPSHOT_ERROR_CODES.SNAPSHOT_REVISION_HISTORY_CONFLICT,
      { errors: revisionPolicy.errors }
    );
  }

  const summary = summarizeChangeFlags(match.items, match.exclusions.length);
  const requiredPermissions = requiredPermissionsForDiff(summary);
  const missing = missingPermissionsForSession(actor, requiredPermissions);
  if (Number(summary.restoreCount) > 0 && actor?.role !== "Admin" && !missing.includes("Admin")) {
    missing.push("Admin(폐기 해제)");
  }
  const baselineCurrentDocumentCount = existingDocuments.filter((document) => document.sync_state === "current").length;
  const warnings = computeRiskWarnings({
    summary,
    currentDocumentCount: baselineCurrentDocumentCount,
    missingPermissions: missing,
    identityChangeCount: match.identityChangeCount,
    blankKeyCreateCount: match.blankKeyCreateCount
  });
  const approvalRequired = approvalReferenceRequired(summary, {
    identityChangeCount: match.identityChangeCount,
    warnings
  }) ? 1 : 0;
  const canonicalRowsHash = await computeCanonicalRowsHash(match.items);
  const actorSnapshot = auditActorSnapshot(actor);
  const changes = {};
  for (const item of match.items) {
    changes[String(item.rowNumber)] = {
      action: item.action,
      matchedDocumentId: item.matchedDocumentId || null,
      rowKey: item.rowKey,
      expectedRowVersion: item.expectedRowVersion,
      beforeJson: item.before ? JSON.stringify(item.before) : null,
      afterJson: item.after ? JSON.stringify(item.after) : null,
      changedFieldsJson: JSON.stringify(item.changedFields || []),
      changeFlagsJson: JSON.stringify(item.changeFlags || []),
      normalizedJson: JSON.stringify({
        schemaVersion: 1,
        rowKey: item.rowKey,
        values: item.values,
        status: item.status,
        changeFlags: item.changeFlags,
        changedFields: item.changedFields
      })
    };
  }
  const exclusionPayload = JSON.stringify(match.exclusions.map((item) => ({
    documentId: item.documentId,
    excelRowKey: item.excelRowKey,
    expectedRowVersion: item.expectedRowVersion,
    beforeJson: JSON.stringify(item.before)
  })));

  const statements = [
    env.DB.prepare(`
      DELETE FROM document_snapshot_exclusions
      WHERE snapshot_id = ?
        AND EXISTS (SELECT 1 FROM document_snapshots WHERE id = ? AND status = 'staging')
    `).bind(snapshotId, snapshotId),
    env.DB.prepare(`
      UPDATE document_snapshot_rows AS row
      SET row_key = json_extract(change.value, '$.rowKey'),
          normalized_json = json_extract(change.value, '$.normalizedJson'),
          before_json = json_extract(change.value, '$.beforeJson'),
          after_json = json_extract(change.value, '$.afterJson'),
          changed_fields_json = json_extract(change.value, '$.changedFieldsJson'),
          change_flags_json = json_extract(change.value, '$.changeFlagsJson'),
          expected_row_version = CAST(json_extract(change.value, '$.expectedRowVersion') AS INTEGER),
          action = json_extract(change.value, '$.action'),
          matched_document_id = CAST(json_extract(change.value, '$.matchedDocumentId') AS INTEGER)
      FROM json_each(?) change
      WHERE row.snapshot_id = ?
        AND row.row_number = CAST(change.key AS INTEGER)
        AND EXISTS (SELECT 1 FROM document_snapshots WHERE id = ? AND status = 'staging')
    `).bind(JSON.stringify(changes), snapshotId, snapshotId),
    env.DB.prepare(`
      INSERT INTO document_snapshot_exclusions (
        snapshot_id, document_id, excel_row_key, expected_row_version, before_json
      )
      SELECT
        ?,
        CAST(json_extract(item.value, '$.documentId') AS INTEGER),
        json_extract(item.value, '$.excelRowKey'),
        CAST(json_extract(item.value, '$.expectedRowVersion') AS INTEGER),
        json_extract(item.value, '$.beforeJson')
      FROM json_each(?) item
      WHERE EXISTS (SELECT 1 FROM document_snapshots WHERE id = ? AND status = 'staging')
    `).bind(snapshotId, exclusionPayload, snapshotId),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'ready',
          create_count = ?, update_count = ?, unchanged_count = ?, exclude_count = ?,
          metadata_count = ?, move_count = ?, dispose_count = ?, restore_count = ?,
          tag_change_count = ?, reinclude_count = ?, identity_change_count = ?,
          required_permissions_json = ?, warnings_json = ?, canonical_rows_hash = ?,
          baseline_current_document_count = ?, approval_required = ?,
          approval_policy_version = ?,
          error_summary = NULL, validation_errors_json = NULL,
          prepared_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'staging' AND base_version = (
        SELECT current_version FROM document_sync_state WHERE id = 1
      )
      RETURNING *
    `).bind(
      summary.createCount,
      summary.updateCount,
      summary.unchangedCount,
      summary.excludeCount,
      summary.metadataCount,
      summary.moveCount,
      summary.disposeCount,
      summary.restoreCount,
      summary.tagChangeCount,
      summary.reincludeCount,
      match.identityChangeCount,
      JSON.stringify(requiredPermissions),
      JSON.stringify(warnings),
      canonicalRowsHash,
      baselineCurrentDocumentCount,
      approvalRequired,
      APPROVAL_POLICY_VERSION,
      snapshotId
    ),
    systemSnapshotAuditStatement(env, snapshotId, "prepare", "엑셀 문서대장 변경 검토 완료", actorSnapshot, {
      ...summary,
      requiredPermissions,
      missingPermissions: missing,
      warnings,
      canonicalRowsHash,
      baselineCurrentDocumentCount,
      approvalRequired: Boolean(approvalRequired),
      approvalPolicyVersion: APPROVAL_POLICY_VERSION,
      applyMode: resolveSnapshotApplyMode(env)
    }, "ready")
  ];
  const results = await executeMutationBatch(env, createSnapshotPlan("prepare", statements));
  const ready = results[3]?.results?.[0];
  if (!ready) {
    return failSnapshotValidation(
      env,
      snapshotId,
      "검증 중 문서고가 변경되었습니다. 최신 엑셀로 다시 시작하세요.",
      actor,
      true,
      SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE,
      { stale: true, warnings }
    );
  }
  return {
    ok: true,
    snapshot: ready,
    summary,
    requiredPermissions,
    missingPermissions: missing,
    warnings,
    canonicalRowsHash
  };
}

export async function applyDocumentSnapshot(env, snapshotId, actor, input = {}) {
  const snapshot = await getDocumentSnapshot(env, snapshotId);
  if (!snapshot) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_NOT_FOUND, "엑셀 동기화 작업을 찾을 수 없습니다.");
  if (snapshot.status === "completed") return { ok: true, snapshot, alreadyApplied: true };
  if (snapshot.status !== "ready") {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "검증이 완료된 동기화 작업만 반영할 수 있습니다.");
  }

  const summary = {
    createCount: Number(snapshot.create_count || 0),
    updateCount: Number(snapshot.update_count || 0),
    unchangedCount: Number(snapshot.unchanged_count || 0),
    excludeCount: Number(snapshot.exclude_count || 0),
    metadataCount: Number(snapshot.metadata_count || 0),
    moveCount: Number(snapshot.move_count || 0),
    disposeCount: Number(snapshot.dispose_count || 0),
    restoreCount: Number(snapshot.restore_count || 0),
    tagChangeCount: Number(snapshot.tag_change_count || 0),
    reincludeCount: Number(snapshot.reinclude_count || 0)
  };

  const auth = evaluateSnapshotApplyAuthorization(actor, summary, env, {
    bootstrap: snapshot.mode === "bootstrap"
  });
  if (!auth.ok) return auth;

  const reason = normalizeApplyReason(input);
  if (!reason.ok) return reason;
  // prepare에 저장된 승인 baseline·정책 버전만 사용한다. 재계산으로 승인을 완화하지 않는다.
  const storedWarnings = parseJsonArray(snapshot.warnings_json);
  if (String(snapshot.approval_policy_version || "") !== APPROVAL_POLICY_VERSION) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE,
      "승인 정책이 변경되었습니다. 미리보기를 다시 준비하세요.",
      { stale: true }
    );
  }
  const currentDocuments = await env.DB.prepare(`
    SELECT
      COUNT(*) AS count,
      SUM(CASE WHEN (
        (storage_code = 'ARC-000001' AND document_number = 'MR-2026-001' AND note = 'Cloudflare 테스트 기본 문서')
        OR
        (storage_code = 'ARC-000002' AND document_number = 'PV-2026-014' AND note = 'Cloudflare 테스트 기본 문서')
      ) THEN 1 ELSE 0 END) AS seed_count
    FROM documents
    WHERE sync_state = 'current'
  `).first();
  const bootstrapSeedCount = snapshot.mode === "bootstrap" ? Number(currentDocuments?.seed_count || 0) : 0;
  const expectedCurrentCount = Number(snapshot.baseline_current_document_count || 0) + bootstrapSeedCount;
  if (
    expectedCurrentCount !== Number(currentDocuments?.count || 0) ||
    (snapshot.mode === "bootstrap" && bootstrapSeedCount !== 2)
  ) {
    await markSnapshotStale(env, snapshotId, actor, "미리보기 이후 현재 대장 건수가 변경되었습니다.");
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE,
      "미리보기 이후 현재 대장 건수가 변경되었습니다. 최신 엑셀로 다시 시작하세요.",
      { stale: true }
    );
  }
  const needsApproval = Number(snapshot.approval_required) === 1 || approvalReferenceRequired(summary, {
    identityChangeCount: Number(snapshot.identity_change_count || 0),
    warnings: storedWarnings
  });
  if (needsApproval && !reason.approvalReference) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_APPROVAL_REFERENCE_REQUIRED,
      "제외·위치 변경·폐기·폐기 해제 또는 대량 변경이 있으면 승인 참조가 필요합니다."
    );
  }
  const reviewCount = summary.createCount + summary.updateCount + summary.excludeCount;
  const confirmedReviewCount = Number(input.confirmedReviewCount);
  if (!readBoolean(input.confirmReview) || !Number.isInteger(confirmedReviewCount) || confirmedReviewCount !== reviewCount) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD,
      `행별 변경과 제외 예정 목록을 검토하고 변경 영향 ${reviewCount}건을 정확히 확인하세요.`
    );
  }
  if (summary.excludeCount > 0) {
    const confirmed = Number(input.confirmedExcludeCount);
    if (!readBoolean(input.confirmExclude) || !Number.isInteger(confirmed) || confirmed !== summary.excludeCount) {
      return snapshotError(
        SNAPSHOT_ERROR_CODES.SNAPSHOT_EXCLUSION_CONFIRMATION_MISMATCH,
        `제외 ${summary.excludeCount}건을 검토하고 예상 건수를 정확히 확인하세요.`
      );
    }
  }

  const state = await getDocumentSyncState(env);
  if (state.currentVersion !== Number(snapshot.base_version)) {
    await markSnapshotStale(env, snapshotId, actor, "미리보기 이후 문서고가 변경되었습니다.");
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE, "미리보기 이후 문서고가 변경되었습니다. 최신 엑셀로 다시 시작하세요.", { stale: true });
  }

  const actorSnapshot = auditActorSnapshot(actor);
  const applyDetails = buildSystemApplyAuditDetails({
    summary,
    requiredPermissions: auth.requiredPermissions,
    applyReason: reason.applyReason,
    approvalReference: reason.approvalReference,
    canonicalRowsHash: snapshot.canonical_rows_hash,
    mode: auth.mode,
    permissionSnapshot: permissionSnapshot(actor)
  });
  const statements = buildApplyStatements(env, {
    snapshotId,
    snapshot,
    actorSnapshot,
    role: clean(actor?.role) || "User",
    applyReason: reason.applyReason,
    approvalReference: reason.approvalReference,
    applyDetails
  });
  let results;
  try {
    results = await executeMutationBatch(env, createSnapshotPlan("apply", statements));
  } catch (error) {
    if (isExpectedChangeAbort(error)) {
      await markSnapshotStale(env, snapshotId, actor, "동시 반영 또는 버전 충돌로 반영하지 못했습니다.");
      return snapshotError(
        SNAPSHOT_ERROR_CODES.SNAPSHOT_CONCURRENT_APPLY,
        "동시 반영 또는 버전 충돌로 반영하지 못했습니다.",
        { stale: true }
      );
    }
    throw error;
  }
  if (!Number(results[0]?.meta?.changes || 0)) {
    const current = await getDocumentSnapshot(env, snapshotId);
    if (current?.status === "completed") return { ok: true, snapshot: current, alreadyApplied: true };
    await markSnapshotStale(env, snapshotId, actor, "동시 반영 또는 버전 충돌로 반영하지 못했습니다.");
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_CONCURRENT_APPLY, "동시 반영 또는 버전 충돌로 반영하지 못했습니다.", { stale: true });
  }
  const completed = results.at(-1)?.results?.[0];
  if (!completed) throw new Error("엑셀 문서대장 반영 결과를 확인할 수 없습니다.");
  return { ok: true, snapshot: completed, statementCount: statements.length };
}

export async function createDocumentSnapshotExport(env, actor = {}, attempt = 0) {
  const stateBefore = await getDocumentSyncState(env);
  const [countResult, categoryResult, tagResult, rackResult] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").first(),
    env.DB.prepare("SELECT name FROM categories WHERE is_active = 1 ORDER BY sort_order, name").all(),
    env.DB.prepare("SELECT name FROM tags WHERE is_active = 1 ORDER BY name").all(),
    env.DB.prepare("SELECT rack_number, code, is_single_sided FROM racks WHERE is_active = 1 ORDER BY zone_number, rack_number").all()
  ]);
  const state = await getDocumentSyncState(env);
  if (
    state.currentVersion !== stateBefore.currentVersion ||
    state.currentSnapshotId !== stateBefore.currentSnapshotId
  ) {
    if (attempt >= 1) throw new Error("엑셀 추출 중 문서고가 계속 변경되어 일관된 export를 만들 수 없습니다.");
    return createDocumentSnapshotExport(env, actor, attempt + 1);
  }

  const documentCount = Number(countResult?.count || 0);
  const exportManifestId = `EXP-${crypto.randomUUID()}`;
  const actorSnapshot = auditActorSnapshot(actor);
  const persisted = await env.DB.prepare(`
    INSERT INTO document_snapshot_export_manifests (
      manifest_id, schema_version, base_version, current_snapshot_id,
      canonical_export_hash, document_count, created_by_user_id, created_by_name,
      status, page_size, finalized_at
    )
    SELECT ?, 2, state.current_version, NULLIF(state.current_snapshot_id, 0), ?, ?, ?, ?,
           'building', ?, NULL
    FROM document_sync_state state
    WHERE state.id = 1
      AND state.current_version = ?
      AND COALESCE(state.current_snapshot_id, 0) = ?
    RETURNING manifest_id
  `).bind(
    exportManifestId,
    "0".repeat(64),
    documentCount,
    actorSnapshot.userId,
    actorSnapshot.displayName,
    FREE_TIER_BUDGET.excelSnapshotExportPageSize,
    state.currentVersion,
    state.currentSnapshotId
  ).first();
  if (!persisted?.manifest_id) {
    if (attempt >= 1) throw new Error("엑셀 추출 중 문서고가 계속 변경되어 일관된 export를 만들 수 없습니다.");
    return createDocumentSnapshotExport(env, actor, attempt + 1);
  }

  return {
    schemaVersion: 2,
    baseVersion: state.currentVersion,
    currentSnapshotId: state.currentSnapshotId || null,
    exportManifestId,
    exportedAt: new Date().toISOString(),
    documentCount,
    clientSourceHashNote: "업로드 시 sourceHash는 브라우저가 계산한 원본 XLSX SHA-256이며 서버 검증 해시가 아닙니다.",
    codes: {
      categories: (categoryResult.results ?? []).map((row) => row.name),
      tags: (tagResult.results ?? []).map((row) => row.name),
      racks: (rackResult.results ?? []).map((row) => ({
        rackNumber: Number(row.rack_number), code: row.code, singleSided: Boolean(row.is_single_sided)
      }))
    }
  };
}

export async function getDocumentSnapshotExport(env, actor = {}, attempt = 0) {
  const stateBefore = await getDocumentSyncState(env);
  const [result, categoryResult, tagResult, rackResult] = await Promise.all([
    env.DB.prepare(`
      SELECT
        d.excel_row_key, d.row_version, d.document_number, d.revision_number, d.revision_date,
        d.disposal_due_year, d.document_name, c.name AS category_name,
        r.rack_number, r.code AS rack_code, r.is_single_sided,
        rs.column_number, rs.shelf_number, d.rack_face,
        GROUP_CONCAT(t.name, ';') AS tag_names,
        d.note, d.status
      FROM documents d
      JOIN categories c ON c.id = d.category_id
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      JOIN racks r ON r.id = rs.rack_id
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      LEFT JOIN tags t ON t.id = dt.tag_id
      WHERE d.sync_state = 'current'
      GROUP BY d.id
      ORDER BY r.rack_number, d.rack_face, rs.column_number, rs.shelf_number, d.document_number, d.id
    `).all(),
    env.DB.prepare("SELECT name FROM categories WHERE is_active = 1 ORDER BY sort_order, name").all(),
    env.DB.prepare("SELECT name FROM tags WHERE is_active = 1 ORDER BY name").all(),
    env.DB.prepare("SELECT rack_number, code, is_single_sided FROM racks WHERE is_active = 1 ORDER BY zone_number, rack_number").all()
  ]);
  const state = await getDocumentSyncState(env);
  if (
    state.currentVersion !== stateBefore.currentVersion ||
    state.currentSnapshotId !== stateBefore.currentSnapshotId
  ) {
    if (attempt >= 1) throw new Error("엑셀 추출 중 문서고가 계속 변경되어 일관된 export를 만들 수 없습니다.");
    return getDocumentSnapshotExport(env, actor, attempt + 1);
  }
  const documents = (result.results ?? []).map(exportDocument);
  const exportManifestId = `EXP-${crypto.randomUUID()}`;
  const canonicalExportHash = await computeExportManifestHash(documents);
  const actorSnapshot = auditActorSnapshot(actor);
  const persisted = await env.DB.prepare(`
    INSERT INTO document_snapshot_export_manifests (
      manifest_id, schema_version, base_version, current_snapshot_id,
      canonical_export_hash, document_count, created_by_user_id, created_by_name,
      status, page_size, finalized_at
    )
    SELECT ?, 2, state.current_version, NULLIF(state.current_snapshot_id, 0), ?, ?, ?, ?,
           'completed', ?, CURRENT_TIMESTAMP
    FROM document_sync_state state
    WHERE state.id = 1
      AND state.current_version = ?
      AND COALESCE(state.current_snapshot_id, 0) = ?
    RETURNING manifest_id
  `).bind(
    exportManifestId,
    canonicalExportHash,
    documents.length,
    actorSnapshot.userId,
    actorSnapshot.displayName,
    FREE_TIER_BUDGET.excelSnapshotExportPageSize,
    state.currentVersion,
    state.currentSnapshotId
  ).first();
  if (!persisted?.manifest_id) {
    if (attempt >= 1) throw new Error("엑셀 추출 중 문서고가 계속 변경되어 일관된 export를 만들 수 없습니다.");
    return getDocumentSnapshotExport(env, actor, attempt + 1);
  }
  return {
    schemaVersion: 2,
    baseVersion: state.currentVersion,
    currentSnapshotId: state.currentSnapshotId || null,
    exportManifestId,
    canonicalExportHash,
    exportedAt: new Date().toISOString(),
    clientSourceHashNote: "업로드 시 sourceHash는 브라우저가 계산한 원본 XLSX SHA-256이며 서버 검증 해시가 아닙니다.",
    documents,
    codes: {
      categories: (categoryResult.results ?? []).map((row) => row.name),
      tags: (tagResult.results ?? []).map((row) => row.name),
      racks: (rackResult.results ?? []).map((row) => ({
        rackNumber: Number(row.rack_number), code: row.code, singleSided: Boolean(row.is_single_sided)
      }))
    }
  };
}

export async function getDocumentSnapshotExportPage(env, manifestId, pageNumber) {
  const id = clean(manifestId);
  const page = Number(pageNumber);
  if (!/^EXP-[A-Za-z0-9-]{16,}$/.test(id) || !Number.isInteger(page) || page < 1) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "export page 요청이 올바르지 않습니다.");
  }
  const manifest = await env.DB.prepare(`
    SELECT manifest_id, base_version, current_snapshot_id, document_count, page_size
    FROM document_snapshot_export_manifests
    WHERE manifest_id = ? AND status IN ('building', 'completed')
  `).bind(id).first();
  if (!manifest) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_NOT_FOUND, "export manifest를 찾을 수 없습니다.");
  const state = await getDocumentSyncState(env);
  if (
    Number(manifest.base_version) !== state.currentVersion ||
    Number(manifest.current_snapshot_id || 0) !== state.currentSnapshotId
  ) {
    await env.DB.prepare("UPDATE document_snapshot_export_manifests SET status = 'invalidated' WHERE manifest_id = ?").bind(id).run();
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE, "export 도중 문서고가 변경되었습니다. 다시 추출하세요.", { stale: true });
  }
  const pageSize = Math.min(Number(manifest.page_size || 250), FREE_TIER_BUDGET.excelSnapshotExportPageSize);
  const expectedPages = Math.max(1, Math.ceil(Number(manifest.document_count || 0) / pageSize));
  if (page > expectedPages) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "export page 범위를 벗어났습니다.");
  }
  const offset = (page - 1) * pageSize;
  const result = await env.DB.prepare(`
    SELECT
      d.excel_row_key, d.row_version, d.document_number, d.revision_number, d.revision_date,
      d.disposal_due_year, d.document_name, c.name AS category_name,
      r.rack_number, r.code AS rack_code, r.is_single_sided,
      rs.column_number, rs.shelf_number, d.rack_face,
      GROUP_CONCAT(t.name, ';') AS tag_names,
      d.note, d.status
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_tags dt ON dt.document_id = d.id
    LEFT JOIN tags t ON t.id = dt.tag_id
    WHERE d.sync_state = 'current'
    GROUP BY d.id
    ORDER BY r.rack_number, d.rack_face, rs.column_number, rs.shelf_number, d.document_number, d.id
    LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all();
  const documents = (result.results ?? []).map(exportDocument);
  const pageHash = await computeExportManifestHash(documents);
  await env.DB.prepare(`
    INSERT INTO document_snapshot_export_pages (
      manifest_id, page_number, row_offset, row_count, page_hash
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(manifest_id, page_number) DO UPDATE SET
      row_offset = excluded.row_offset,
      row_count = excluded.row_count,
      page_hash = excluded.page_hash
  `).bind(id, page, offset, documents.length, pageHash).run();
  return {
    ok: true,
    manifestId: id,
    page,
    pageSize,
    pageHash,
    documents,
    hasMore: offset + documents.length < Number(manifest.document_count || 0)
  };
}

export async function finalizeDocumentSnapshotExport(env, manifestId) {
  const id = clean(manifestId);
  const manifest = await env.DB.prepare(`
    SELECT manifest_id, base_version, current_snapshot_id, document_count, page_size,
           canonical_export_hash, status
    FROM document_snapshot_export_manifests
    WHERE manifest_id = ? AND status IN ('building', 'completed')
  `).bind(id).first();
  if (!manifest) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_NOT_FOUND, "완료할 export manifest를 찾을 수 없습니다.");
  const state = await getDocumentSyncState(env);
  if (
    Number(manifest.base_version) !== state.currentVersion ||
    Number(manifest.current_snapshot_id || 0) !== state.currentSnapshotId
  ) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE, "export 도중 문서고가 변경되었습니다.", { stale: true });
  const pages = await env.DB.prepare(`
    SELECT page_number, row_offset, row_count, page_hash
    FROM document_snapshot_export_pages
    WHERE manifest_id = ?
    ORDER BY page_number
  `).bind(id).all();
  const pageRows = pages.results ?? [];
  const pageSize = Number(manifest.page_size || 250);
  const documentCount = Number(manifest.document_count || 0);
  const expectedPages = Math.max(1, Math.ceil(documentCount / pageSize));
  const validPageChain = pageRows.length === expectedPages && pageRows.every((page, index) => {
    const expectedOffset = index * pageSize;
    const expectedRowCount = Math.max(0, Math.min(pageSize, documentCount - expectedOffset));
    return Number(page.page_number) === index + 1 &&
      Number(page.row_offset) === expectedOffset &&
      Number(page.row_count) === expectedRowCount &&
      /^[a-f0-9]{64}$/i.test(clean(page.page_hash));
  });
  if (!validPageChain) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH, "모든 export page를 받은 뒤 완료하세요.");
  }
  const canonicalExportHash = manifest.status === "completed"
    ? clean(manifest.canonical_export_hash)
    : await computeExportPageChainHash(pageRows);
  if (manifest.status === "building") {
    const completed = await env.DB.prepare(`
      UPDATE document_snapshot_export_manifests
      SET status = 'completed',
          canonical_export_hash = ?,
          finalized_at = CURRENT_TIMESTAMP
      WHERE manifest_id = ? AND status = 'building'
      RETURNING manifest_id
    `).bind(canonicalExportHash, id).first();
    if (!completed?.manifest_id) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_CONCURRENT_APPLY, "export 완료 상태가 동시에 변경되었습니다.");
    }
  }
  return {
    ok: true,
    manifestId: id,
    documentCount,
    pageCount: expectedPages,
    canonicalExportHash
  };
}

async function failSnapshotValidation(env, snapshotId, message, actor, stale = false, code = SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, extras = {}) {
  const summary = clean(message).slice(0, 2000) || "엑셀 검증에 실패했습니다.";
  const actorSnapshot = auditActorSnapshot(actor);
  const statements = [
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'failed', error_summary = ?, validation_errors_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'staging'
    `).bind(summary, Array.isArray(extras.errors) ? JSON.stringify(extras.errors) : null, snapshotId),
    systemSnapshotAuditStatement(env, snapshotId, "validation_failed", "엑셀 문서대장 검증 실패", actorSnapshot, { message: summary, code, ...extras }, "failed")
  ];
  await executeMutationBatch(env, createSnapshotPlan("validation-failed", statements));
  return { ok: false, stale, code, message: summary, ...extras };
}

async function markSnapshotStale(env, snapshotId, actor, message) {
  const actorSnapshot = auditActorSnapshot(actor);
  const summary = clean(message).slice(0, 2000);
  await executeMutationBatch(env, createSnapshotPlan("stale", [
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'failed', error_summary = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('ready', 'applying')
    `).bind(summary, snapshotId),
    systemSnapshotAuditStatement(env, snapshotId, "stale", "엑셀 문서대장 stale 차단", actorSnapshot, { message: summary }, "failed")
  ]));
}

function exportDocument(row) {
  return {
    rowKey: clean(row.excel_row_key),
    baseRowVersion: Number(row.row_version || 0),
    documentNumber: clean(row.document_number),
    revisionNumber: clean(row.revision_number),
    revisionDate: clean(row.revision_date),
    disposalDueYear: row.disposal_due_year === null || row.disposal_due_year === undefined ? "" : Number(row.disposal_due_year),
    documentName: clean(row.document_name),
    category: clean(row.category_name),
    rackNumber: Number(row.rack_number),
    rackColumn: Number(row.column_number),
    shelfNumber: Number(row.shelf_number),
    rackFace: Number(row.is_single_sided) ? "단면" : row.rack_face === "B" ? "2면" : "1면",
    tags: clean(row.tag_names),
    note: clean(row.note),
    status: row.status === "disposed" ? "폐기" : "보관중"
  };
}

function sourceRowFromCurrentDocument(document, membership, options) {
  const category = (options.categories || []).find((item) => Number(item.id) === Number(document.category_id));
  const slot = (options.slots || []).find((item) => Number(item.id) === Number(document.rack_slot_id));
  const tagIds = String(document.tag_ids || "").split(",").map(Number).filter(Number.isInteger);
  const tagNames = tagIds.map((id) => (options.tags || []).find((tag) => Number(tag.id) === id)?.name).filter(Boolean);
  return {
    rowNumber: Number(membership.row_number),
    sourceRowKey: clean(membership.row_key),
    rowKey: clean(membership.row_key),
    documentNumber: clean(document.document_number),
    revisionNumber: clean(document.revision_number),
    revisionDate: clean(document.revision_date),
    disposalDueYear: document.disposal_due_year,
    documentName: clean(document.document_name),
    category: clean(category?.name),
    rackCode: clean(slot?.code),
    rackNumber: clean(slot?.code),
    rackColumn: Number(slot?.column_number || 0),
    shelfNumber: Number(slot?.shelf_number || 0),
    rackFace: clean(document.rack_face),
    tags: tagNames.join(";"),
    note: clean(document.note),
    status: document.status === "disposed" ? "폐기" : "보관중"
  };
}

function isInitialBootstrapSeed(document) {
  const storageCode = clean(document.storage_code);
  const documentNumber = clean(document.document_number);
  const note = clean(document.note);
  return note === "Cloudflare 테스트 기본 문서" && (
    (storageCode === "ARC-000001" && documentNumber === "MR-2026-001") ||
    (storageCode === "ARC-000002" && documentNumber === "PV-2026-014")
  );
}

function normalizeSourceRow(source = {}) {
  return {
    documentNumber: clean(source.documentNumber),
    revisionNumber: clean(source.revisionNumber),
    revisionDate: clean(source.revisionDate),
    disposalDueYear: clean(source.disposalDueYear),
    documentName: clean(source.documentName),
    category: clean(source.category),
    rackNumber: clean(source.rackNumber || source.rackCode),
    rackColumn: clean(source.rackColumn),
    shelfNumber: clean(source.shelfNumber),
    rackFace: clean(source.rackFace),
    tags: clean(source.tags),
    note: clean(source.note),
    status: clean(source.status)
  };
}

function optionalPositiveInteger(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export async function cancelDocumentSnapshot(env, snapshotId, actor) {
  const snapshot = await getDocumentSnapshot(env, snapshotId);
  if (!snapshot) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_NOT_FOUND, "엑셀 동기화 작업을 찾을 수 없습니다.");
  if (snapshot.status === "cancelled") return { ok: true, snapshot, alreadyCancelled: true };
  if (!new Set(["staging", "ready"]).has(snapshot.status)) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "업로드 중이거나 반영 대기인 작업만 취소할 수 있습니다.");
  }
  const actorSnapshot = auditActorSnapshot(actor);
  const results = await executeMutationBatch(env, createSnapshotPlan("cancel", [
    env.DB.prepare(`
      INSERT INTO system_audit_logs (
        entity_type, entity_id, entity_reference, action, actor_user_id,
        actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
        summary, details_json
      )
      SELECT 'document_snapshot', CAST(id AS TEXT), snapshot_code, 'cancel', ?, ?, ?, ?,
             '엑셀 문서대장 작업 취소', json_object('previousStatus', status, 'sourceName', source_name)
      FROM document_snapshots
      WHERE id = ? AND status IN ('staging', 'ready')
    `).bind(
      actorSnapshot.userId,
      actorSnapshot.username,
      actorSnapshot.displayName,
      JSON.stringify(actorSnapshot.permissions),
      snapshotId
    ),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'cancelled', error_summary = '사용자가 반영 전 작업을 취소했습니다.', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('staging', 'ready')
      RETURNING *
    `).bind(snapshotId)
  ]));
  const cancelled = results[1]?.results?.[0];
  if (!cancelled) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "동시에 상태가 변경되어 작업을 취소하지 못했습니다.");
  return { ok: true, snapshot: cancelled };
}

function readBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function systemSnapshotAuditStatement(env, snapshotId, action, summary, actor, details, requiredStatus) {
  return env.DB.prepare(`
    INSERT INTO system_audit_logs (
      entity_type, entity_id, entity_reference, action, actor_user_id,
      actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
      summary, details_json
    )
    SELECT 'document_snapshot', CAST(id AS TEXT), snapshot_code, ?, ?, ?, ?, ?, ?, ?
    FROM document_snapshots
    WHERE id = ? AND status = ?
  `).bind(
    action,
    actor.userId,
    actor.username,
    actor.displayName,
    JSON.stringify(actor.permissions),
    summary,
    JSON.stringify(details),
    snapshotId,
    requiredStatus
  );
}

function createSnapshotPlan(action, statements) {
  const plan = createBatchPlan(`snapshots.${action}`).withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest);
  statements.forEach((statement, index) => plan.step(`${action}.${index + 1}`, statement, { guard: "snapshot-state" }));
  return plan;
}

function snapshotStatements(action, statements) {
  return createSnapshotPlan(action, statements).execution().statements;
}

export { SNAPSHOT_STATUSES, buildDocumentAuditDetails };
