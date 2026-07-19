import { changeUserPassword } from "../auth.js";
import {
  approveUser,
  getAppUsers,
  getDocumentQualitySummary,
  getSearchIndexStats,
  rejectUser,
} from "../db.js";
import {
  adminDashboardPage,
  adminSettingsPage,
  errorPage,
  notFoundPage,
  passwordPage,
} from "../html.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";
import { clean, redirect } from "../utils.js";
import { validateNewPassword } from "../domains/identity/index.js";

export {
  renderCategories,
  handleSaveCategory,
  handleCategoryAction,
  renderTags,
  handleSaveTag,
  handleTagAction
} from "../domains/masters/index.js";

export async function handleAdminDashboard(env, session) {
  const canManageUsers = hasPermission(session, PERMISSIONS.MANAGE_USERS);
  const canManageDocuments = hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS);
  const canViewAudit = hasPermission(session, PERMISSIONS.VIEW_AUDIT);
  const [users, quality, searchIndex] = await Promise.all([
    canManageUsers ? getAppUsers(env) : Promise.resolve([]),
    canManageDocuments ? getDocumentQualitySummary(env) : Promise.resolve(null),
    canViewAudit ? getSearchIndexStats(env) : Promise.resolve(null)
  ]);
  const pendingCount = users.filter((user) => user.status === "pending").length;

  return adminDashboardPage({ session, pendingCount, quality, searchIndex });
}

export async function handleAdminSettings(env, session) {
  const users = await getAppUsers(env);

  return adminSettingsPage({ session, users });
}

export async function handleAdminUserAction(env, session, routeInfo) {
  let result;
  if (routeInfo.action === "approve") {
    result = await approveUser(env, routeInfo.id, session);
  } else if (routeInfo.action === "reject") {
    result = await rejectUser(env, routeInfo.id, session);
  } else {
    return notFoundPage(session);
  }

  if (!result.ok) {
    return errorPage("처리할 수 있는 가입 신청을 찾지 못했습니다.", session, 400);
  }

  const toast = routeInfo.action === "approve" ? "approved" : "rejected";
  return redirect(`/admin/settings?toast=${toast}`);
}

export function renderPasswordPage(session) {
  return renderPasswordResult(session);
}

export async function handleChangePassword(request, env, session) {
  const form = await request.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword) {
    return renderPasswordResult(session, { error: "모든 필드를 입력하세요." });
  }

  const passwordValidation = validateNewPassword(newPassword);
  if (!passwordValidation.ok) return renderPasswordResult(session, { error: passwordValidation.message });

  if (newPassword !== confirmPassword) {
    return renderPasswordResult(session, { error: "새 비밀번호가 일치하지 않습니다." });
  }

  const result = await changeUserPassword(env, session.username, currentPassword, newPassword);
  if (!result.ok) {
    return renderPasswordResult(session, { error: result.message });
  }

  if (session.mustChangePassword) {
    return redirect("/app?toast=password-changed");
  }

  return renderPasswordResult(session, { success: true });
}

function renderPasswordResult(session, options = {}) {
  return passwordPage({ session, required: Boolean(session.mustChangePassword), ...options });
}
