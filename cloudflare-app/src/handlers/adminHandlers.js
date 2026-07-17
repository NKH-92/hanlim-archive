import { changeUserPassword } from "../auth.js";
import {
  approveUser,
  deleteCategory,
  deleteTag,
  getAppUsers,
  getCategories,
  getDocumentQualitySummary,
  getSearchIndexStats,
  getTags,
  rejectUser,
  upsertCategory,
  upsertTag
} from "../db.js";
import {
  adminDashboardPage,
  adminSettingsPage,
  categoriesPage,
  errorPage,
  notFoundPage,
  passwordPage,
  tagsPage
} from "../html.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";
import { clean, redirect } from "../utils.js";

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

export async function renderCategories(env, session, error = "", values = {}) {
  return categoriesPage({ session, categories: await getCategories(env), error, values });
}

export async function handleSaveCategory(request, env, session, id = 0) {
  const form = await request.formData();
  const values = {
    id,
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    sortOrder: Number(form.get("sortOrder") || 0),
    isActive: id ? form.get("isActive") === "1" : true
  };
  const result = await upsertCategory(env, values, session);

  if (!result.ok) {
    return renderCategories(env, session, result.message, values);
  }

  return redirect("/categories?toast=saved");
}

export async function handleCategoryAction(request, env, session, routeInfo) {
  if (routeInfo.action === "edit") {
    return handleSaveCategory(request, env, session, routeInfo.id);
  }

  if (routeInfo.action !== "delete") {
    return notFoundPage(session);
  }

  const result = await deleteCategory(env, routeInfo.id, session);
  if (!result.ok) {
    return renderCategories(env, session, result.message);
  }

  return redirect("/categories?toast=saved");
}

export async function renderTags(env, session, error = "", values = {}) {
  return tagsPage({ session, tags: await getTags(env), error, values });
}

export async function handleSaveTag(request, env, session, id = 0) {
  const form = await request.formData();
  const values = {
    id,
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    isActive: id ? form.get("isActive") === "1" : true
  };
  const result = await upsertTag(env, values, session);

  if (!result.ok) {
    return renderTags(env, session, result.message, values);
  }

  return redirect("/tags?toast=saved");
}

export async function handleTagAction(request, env, session, routeInfo) {
  if (routeInfo.action === "edit") {
    return handleSaveTag(request, env, session, routeInfo.id);
  }

  if (routeInfo.action !== "delete") {
    return notFoundPage(session);
  }

  const result = await deleteTag(env, routeInfo.id, session);
  if (!result.ok) {
    return renderTags(env, session, result.message);
  }

  return redirect("/tags?toast=saved");
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

  if (newPassword.length < 8) {
    return renderPasswordResult(session, { error: "새 비밀번호는 8자 이상이어야 합니다." });
  }

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
