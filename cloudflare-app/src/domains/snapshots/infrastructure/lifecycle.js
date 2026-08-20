import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { hasPermission, PERMISSIONS } from "../../../permissions.js";
import { clean } from "../../../shared/text/normalize.js";
import { auditActorSnapshot } from "../../identity/index.js";
import { normalizeSyncReason } from "../domain/authorization.js";
import { SNAPSHOT_ERROR_CODES, snapshotError } from "../domain/errorCodes.js";
import { SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS } from "../domain/hash.js";
import { EXCEL_SNAPSHOT_SCHEMA_VERSION } from "../domain/workbookSchema.js";
import { getDocumentSnapshot, getDocumentSyncState } from "./queries.js";
import {
  BOOTSTRAP_CONFIRMATION,
  createSnapshotPlan,
  optionalPositiveInteger,
  readBoolean
} from "./support.js";

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
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_SCHEMA_UNSUPPORTED,
      schemaVersion < EXCEL_SNAPSHOT_SCHEMA_VERSION
        ? "구역 열이 포함된 최신 대장을 다시 추출하세요."
        : "지원하지 않는 엑셀 스키마 버전입니다."
    );
  }
  const reason = normalizeSyncReason(input?.syncReason ?? input?.applyReason);
  if (!reason.ok) return reason;

  const state = await getDocumentSyncState(env);
  const applyingBootstrap = await env.DB.prepare(`
    SELECT id
    FROM document_snapshots
    WHERE status = 'applying' AND mode = 'bootstrap' AND bootstrap_apply_actor_json IS NOT NULL
    LIMIT 1
  `).first();
  if (applyingBootstrap) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE,
      "최초 대량등록을 자동 분할 반영 중입니다. 완료된 뒤 새 엑셀 작업을 시작해 주세요."
    );
  }

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
