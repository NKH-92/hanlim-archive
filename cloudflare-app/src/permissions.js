export const PERMISSIONS = Object.freeze({
  MANAGE_DOCUMENTS: "can_manage_documents",
  MOVE_DOCUMENTS: "can_move_documents",
  MANAGE_DISPOSALS: "can_manage_disposals",
  MANAGE_SETS: "can_manage_sets",
  MANAGE_MASTERS: "can_manage_masters",
  MANAGE_USERS: "can_manage_users",
  VIEW_AUDIT: "can_view_audit",
  APPLY_DOCUMENT_SNAPSHOTS: "can_apply_document_snapshots"
});

export const PERMISSION_KEYS = Object.freeze(Object.values(PERMISSIONS));

export const PERMISSION_LABELS = Object.freeze({
  [PERMISSIONS.MANAGE_DOCUMENTS]: "문서 등록·수정",
  [PERMISSIONS.MOVE_DOCUMENTS]: "문서 위치 이동",
  [PERMISSIONS.MANAGE_DISPOSALS]: "폐기 관리",
  [PERMISSIONS.MANAGE_SETS]: "문서 세트 관리",
  [PERMISSIONS.MANAGE_MASTERS]: "랙·대분류·태그 관리",
  [PERMISSIONS.MANAGE_USERS]: "사용자·권한 관리",
  [PERMISSIONS.VIEW_AUDIT]: "전역 감사조회",
  [PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS]: "엑셀 전체 대장 반영"
});

export const PERMISSION_PRESETS = Object.freeze({
  viewer: Object.freeze({ label: "조회 사용자", permissions: Object.freeze([]) }),
  archive_manager: Object.freeze({
    label: "문서고 담당자",
    permissions: Object.freeze([
      PERMISSIONS.MANAGE_DOCUMENTS,
      PERMISSIONS.MOVE_DOCUMENTS,
      PERMISSIONS.MANAGE_SETS
    ])
  }),
  disposal_manager: Object.freeze({
    label: "폐기 담당자",
    permissions: Object.freeze([PERMISSIONS.MANAGE_DISPOSALS])
  }),
  operations_admin: Object.freeze({
    label: "운영 관리자",
    permissions: Object.freeze([PERMISSIONS.MANAGE_MASTERS, PERMISSIONS.VIEW_AUDIT])
  }),
  system_admin: Object.freeze({
    label: "시스템 관리자",
    permissions: PERMISSION_KEYS
  }),
  custom: Object.freeze({ label: "사용자 지정", permissions: null })
});

const permissionSet = new Set(PERMISSION_KEYS);

// 기존 Admin은 하위 호환을 위해 플래그 값과 관계없이 모든 권한을 가진다.
export function hasPermission(session, permission) {
  if (!session || !permissionSet.has(permission)) {
    return false;
  }
  if (session.role === "Admin") {
    return true;
  }
  return session.role === "User" && readPermissionFlag(session[permission]);
}

export function hasAnyPermission(session, permissions = PERMISSION_KEYS) {
  return Array.from(permissions || []).some((permission) => hasPermission(session, permission));
}

export function sessionHasManagementAccess(session) {
  return hasAnyPermission(session, PERMISSION_KEYS);
}

export function permissionFlags(source = {}) {
  return Object.fromEntries(PERMISSION_KEYS.map((permission) => [
    permission,
    readPermissionFlag(source[permission])
  ]));
}

export function permissionSnapshot(session = {}) {
  if (session.role === "Admin") {
    return Object.fromEntries(PERMISSION_KEYS.map((permission) => [permission, true]));
  }
  return permissionFlags(session);
}

export function permissionsForPreset(preset, custom = {}) {
  const selected = PERMISSION_PRESETS[preset] || PERMISSION_PRESETS.custom;
  if (selected.permissions === null) {
    return permissionFlags(custom);
  }
  const granted = new Set(selected.permissions);
  return Object.fromEntries(PERMISSION_KEYS.map((permission) => [permission, granted.has(permission)]));
}

function readPermissionFlag(value) {
  return value === true || value === 1 || value === "1";
}
