import { hasPermission, PERMISSIONS, sessionHasManagementAccess } from "../../../permissions.js";

export function capabilitiesFromSession(session) {
  const isAdmin = session?.role === "Admin";
  const canManageDocuments = hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS);
  const canMoveDocuments = hasPermission(session, PERMISSIONS.MOVE_DOCUMENTS);
  const canManageDisposals = hasPermission(session, PERMISSIONS.MANAGE_DISPOSALS);
  const canManageSets = hasPermission(session, PERMISSIONS.MANAGE_SETS);
  const canManageMasters = hasPermission(session, PERMISSIONS.MANAGE_MASTERS);
  const canManageUsers = hasPermission(session, PERMISSIONS.MANAGE_USERS);
  const canViewAudit = hasPermission(session, PERMISSIONS.VIEW_AUDIT);
  const canApplyDocumentSnapshots = hasPermission(session, PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS);
  return Object.freeze({
    isAdmin,
    canManageDocuments,
    canMoveDocuments,
    canManageDisposals,
    canManageSets,
    canManageMasters,
    canManageUsers,
    canViewAudit,
    canApplyDocumentSnapshots,
    canViewMovements: canMoveDocuments || canViewAudit,
    canOpenManagement: sessionHasManagementAccess(session),
    // 기존 UI 정책: User의 직접 URL 권한과 별개로 고급 설정 메뉴는 Admin에게만 보인다.
    canShowAdminSettings: isAdmin
  });
}
