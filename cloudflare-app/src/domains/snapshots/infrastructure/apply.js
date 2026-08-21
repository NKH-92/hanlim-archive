import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { isExpectedChangeAbort } from "../../../platform/d1/expectedChange.js";
import { permissionSnapshot } from "../../../permissions.js";
import { clean } from "../../../shared/text/normalize.js";
import { auditActorSnapshot } from "../../identity/index.js";
import {
  approvalReferenceRequired,
  APPROVAL_POLICY_VERSION,
  evaluateSnapshotApplyAuthorization,
  normalizeApplyReason
} from "../domain/authorization.js";
import { buildSystemApplyAuditDetails } from "../domain/auditPayload.js";
import { SNAPSHOT_ERROR_CODES, snapshotError } from "../domain/errorCodes.js";
import { buildApplyStatements } from "./applyPlan.js";
import { scheduleBootstrapApplication } from "./bootstrapApply.js";
import { getDocumentSnapshot, getDocumentSyncState } from "./queries.js";
import {
  createSnapshotPlan,
  parseJsonArray,
  readBoolean,
  systemSnapshotAuditStatement
} from "./support.js";

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
    permissionSnapshot: permissionSnapshot(actor),
    autoCategoryNames: storedWarnings.find((warning) => warning?.code === "AUTO_CATEGORY_CREATE")?.categoryNames || []
  });
  if (
    snapshot.mode === "bootstrap" &&
    summary.createCount > FREE_TIER_BUDGET.bootstrapApplyScheduleThreshold
  ) {
    return scheduleBootstrapApplication(env, {
      snapshotId,
      actorSnapshot,
      role: clean(actor?.role) || "Admin",
      applyReason: reason.applyReason,
      approvalReference: reason.approvalReference,
      applyDetails
    });
  }
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
