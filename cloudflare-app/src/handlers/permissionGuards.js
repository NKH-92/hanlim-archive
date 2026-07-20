import { accessDeniedPage } from "../views/authViews.js";
import { hasAnyPermission, hasPermission, PERMISSIONS, sessionHasManagementAccess } from "../permissions.js";

export function requirePermission(session, permission) {
  return hasPermission(session, permission) ? null : accessDeniedPage(session);
}

export function requireManagementAccess(session) {
  return sessionHasManagementAccess(session) ? null : accessDeniedPage(session);
}

export function requireAnyPermission(session, permissions) {
  return hasAnyPermission(session, permissions) ? null : accessDeniedPage(session);
}

export const requireManageDocuments = (session) => requirePermission(session, PERMISSIONS.MANAGE_DOCUMENTS);
export const requireMoveDocuments = (session) => requirePermission(session, PERMISSIONS.MOVE_DOCUMENTS);
export const requireManageDisposals = (session) => requirePermission(session, PERMISSIONS.MANAGE_DISPOSALS);
export const requireManageSets = (session) => requirePermission(session, PERMISSIONS.MANAGE_SETS);
export const requireManageMasters = (session) => requirePermission(session, PERMISSIONS.MANAGE_MASTERS);
export const requireManageUsers = (session) => requirePermission(session, PERMISSIONS.MANAGE_USERS);
export const requireViewAudit = (session) => requirePermission(session, PERMISSIONS.VIEW_AUDIT);
export const requireApplyDocumentSnapshots = (session) => requirePermission(session, PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS);
