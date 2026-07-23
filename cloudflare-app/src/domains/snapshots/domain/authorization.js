import { hasPermission, PERMISSIONS } from "../../../permissions.js";
import { CHANGE_FLAGS } from "./diff.js";
import { SNAPSHOT_ERROR_CODES, snapshotError } from "./errorCodes.js";

export const APPLY_MODES = Object.freeze({
  DISABLED: "disabled",
  ADMIN_ONLY: "admin-only",
  PERMISSIONED: "permissioned"
});

export function resolveSnapshotApplyMode(env = {}) {
  const raw = String(env.EXCEL_SNAPSHOT_APPLY_MODE || "").trim().toLowerCase();
  if (!raw) return APPLY_MODES.ADMIN_ONLY;
  if (raw === APPLY_MODES.DISABLED || raw === APPLY_MODES.ADMIN_ONLY || raw === APPLY_MODES.PERMISSIONED) {
    return raw;
  }
  return APPLY_MODES.DISABLED;
}

export function requiredPermissionsForDiff(summary = {}) {
  /** @type {string[]} */
  const required = [
    PERMISSIONS.MANAGE_DOCUMENTS,
    PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS
  ];
  if (Number(summary.moveCount) > 0) required.push(PERMISSIONS.MOVE_DOCUMENTS);
  if (Number(summary.disposeCount) > 0) required.push(PERMISSIONS.MANAGE_DISPOSALS);
  return [...new Set(required)];
}

export function evaluateSnapshotApplyAuthorization(session, summary = {}, env = {}, { bootstrap = false } = {}) {
  const mode = resolveSnapshotApplyMode(env);
  const requiredPermissions = requiredPermissionsForDiff(summary);
  const missingPermissions = missingPermissionsForSession(session, requiredPermissions);
  if (Number(summary.restoreCount) > 0 && session?.role !== "Admin" && !missingPermissions.includes("Admin")) {
    missingPermissions.push("Admin");
  }

  if (mode === APPLY_MODES.DISABLED) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_APPLY_DISABLED,
      "엑셀 전체 대장 반영이 일시적으로 비활성화되어 있습니다.",
      { requiredPermissions, missingPermissions, mode }
    );
  }
  if (mode === APPLY_MODES.ADMIN_ONLY && session?.role !== "Admin") {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_APPLY_PERMISSION_REQUIRED,
      "현재 반영 모드는 Admin 전용입니다.",
      { requiredPermissions: [...requiredPermissions, "Admin"], missingPermissions: ["Admin"], mode }
    );
  }
  if (!hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS)) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_APPLY_PERMISSION_REQUIRED,
      "문서 등록·수정 권한이 필요합니다.",
      { requiredPermissions, missingPermissions, mode }
    );
  }
  if (!hasPermission(session, PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS)) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_APPLY_PERMISSION_REQUIRED,
      "엑셀 전체 대장 반영 권한이 필요합니다.",
      { requiredPermissions, missingPermissions, mode }
    );
  }
  if (bootstrap && session?.role !== "Admin") {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_BOOTSTRAP_FORBIDDEN,
      "메타데이터 없는 bootstrap 반영은 Admin만 수행할 수 있습니다.",
      { requiredPermissions: [...requiredPermissions, "Admin"], missingPermissions: ["Admin"], mode }
    );
  }
  if (Number(summary.moveCount) > 0 && !hasPermission(session, PERMISSIONS.MOVE_DOCUMENTS)) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_MOVE_PERMISSION_REQUIRED,
      `위치 변경 ${summary.moveCount}건을 반영하려면 문서 위치 이동 권한이 필요합니다.`,
      { requiredPermissions, missingPermissions, mode }
    );
  }
  if (Number(summary.disposeCount) > 0 && !hasPermission(session, PERMISSIONS.MANAGE_DISPOSALS)) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_DISPOSAL_PERMISSION_REQUIRED,
      `폐기 ${summary.disposeCount}건을 반영하려면 폐기 관리 권한이 필요합니다.`,
      { requiredPermissions, missingPermissions, mode }
    );
  }
  if (Number(summary.restoreCount) > 0 && session?.role !== "Admin") {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_RESTORE_ADMIN_REQUIRED,
      `폐기 해제 ${summary.restoreCount}건을 반영하려면 Admin 권한이 필요합니다.`,
      { requiredPermissions: [...requiredPermissions, "Admin"], missingPermissions, mode }
    );
  }
  return {
    ok: true,
    mode,
    requiredPermissions,
    missingPermissions: []
  };
}

export function missingPermissionsForSession(session, requiredPermissions = []) {
  return requiredPermissions.filter((permission) => !hasPermission(session, permission));
}

export const APPROVAL_POLICY_VERSION = "v1";

export function approvalReferenceRequired(summary = {}, { identityChangeCount = 0, warnings = [] } = {}) {
  return Number(summary.excludeCount) > 0 ||
    Number(summary.moveCount) > 0 ||
    Number(summary.disposeCount) > 0 ||
    Number(summary.restoreCount) > 0 ||
    Number(identityChangeCount) > 0 ||
    warnings.some((warning) => warning.code === "LARGE_CHANGE" || warning.code === "LARGE_EXCLUSION");
}

export function normalizeApplyReason(input = {}) {
  const applyReason = String(input.applyReason || "").trim();
  const approvalReference = String(input.approvalReference || "").trim();
  if (applyReason.length < 10 || applyReason.length > 500) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_REASON_REQUIRED,
      "동기화 사유는 10자 이상 500자 이하로 입력하세요."
    );
  }
  if (approvalReference.length > 200) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_APPROVAL_REFERENCE_REQUIRED,
      "승인 참조는 200자 이하로 입력하세요."
    );
  }
  return { ok: true, applyReason, approvalReference };
}

export function normalizeSyncReason(value) {
  const syncReason = String(value || "").trim();
  if (syncReason.length < 10 || syncReason.length > 500) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_REASON_REQUIRED,
      "동기화 사유는 10자 이상 500자 이하로 입력하세요."
    );
  }
  return { ok: true, syncReason };
}

export function rowHasFlag(flags = [], flag) {
  return Array.isArray(flags) && flags.includes(flag);
}

export function flagsIndicateMove(flags) {
  return rowHasFlag(flags, CHANGE_FLAGS.MOVE);
}
