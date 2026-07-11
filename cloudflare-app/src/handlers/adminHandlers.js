import { changeUserPassword } from "../auth.js";
import {
  approveUser,
  deleteCategory,
  deleteTag,
  getAppUsers,
  getCategories,
  getDocumentQualitySummary,
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
  passwordPage,
  tagsPage
} from "../html.js";
import { clean, redirect } from "../utils.js";

export async function handleAdminDashboard(env, session) {
  const [users, quality] = await Promise.all([
    getAppUsers(env),
    getDocumentQualitySummary(env)
  ]);
  const pendingCount = users.filter((user) => user.status === "pending").length;

  return adminDashboardPage({ session, pendingCount, quality });
}

export async function handleAdminSettings(env, session) {
  const users = await getAppUsers(env);

  return adminSettingsPage({ session, users });
}

export async function handleAdminUserAction(env, session, routeInfo) {
  const result = routeInfo.action === "approve"
    ? await approveUser(env, routeInfo.id, session.username)
    : await rejectUser(env, routeInfo.id, session.username);

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
  const result = await upsertCategory(env, values);

  if (!result.ok) {
    return renderCategories(env, session, result.message, values);
  }

  return redirect("/categories?toast=saved");
}

export async function handleCategoryAction(request, env, session, routeInfo) {
  if (routeInfo.action === "edit") {
    return handleSaveCategory(request, env, session, routeInfo.id);
  }

  const result = await deleteCategory(env, routeInfo.id);
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
  const result = await upsertTag(env, values);

  if (!result.ok) {
    return renderTags(env, session, result.message, values);
  }

  return redirect("/tags?toast=saved");
}

export async function handleTagAction(request, env, session, routeInfo) {
  if (routeInfo.action === "edit") {
    return handleSaveTag(request, env, session, routeInfo.id);
  }

  const result = await deleteTag(env, routeInfo.id);
  if (!result.ok) {
    return renderTags(env, session, result.message);
  }

  return redirect("/tags?toast=saved");
}

export function renderPasswordPage(session) {
  return passwordPage({ session });
}

export async function handleChangePassword(request, env, session) {
  const form = await request.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword) {
    return passwordPage({ session, error: "모든 필드를 입력하세요." });
  }

  if (newPassword.length < 8) {
    return passwordPage({ session, error: "새 비밀번호는 8자 이상이어야 합니다." });
  }

  if (newPassword !== confirmPassword) {
    return passwordPage({ session, error: "새 비밀번호가 일치하지 않습니다." });
  }

  const result = await changeUserPassword(env, session.username, currentPassword, newPassword);
  if (!result.ok) {
    return passwordPage({ session, error: result.message });
  }

  return passwordPage({ session, success: true });
}
