import { changeUserPassword, createSessionCookie } from "../auth.js";
import {
  approveUser,
  getAppUsers,
  rejectUser,
} from "../domains/identity/index.js";
import {
  adminDashboardPage,
  adminSettingsPage,
  passwordPage,
} from "../views/adminViews.js";
import { errorPage, notFoundPage } from "../views/authViews.js";
import { redirect } from "../platform/http/responses.js";
import { validateNewPassword } from "../domains/identity/index.js";
import { loadAdminDashboardReadModel } from "../readModels/adminDashboard.js";

export {
  renderCategories,
  handleSaveCategory,
  handleCategoryAction,
  renderTags,
  handleSaveTag,
  handleTagAction
} from "../domains/masters/index.js";

export async function handleAdminDashboard(env, session) {
  return adminDashboardPage({ session, ...await loadAdminDashboardReadModel(env, session) });
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

  // forced-change 우회 방지: 길이와 무관하게 현재와 동일한 새 비밀번호를 거부한다.
  if (currentPassword === newPassword) {
    return renderPasswordResult(session, { error: "새 비밀번호는 현재 비밀번호와 달라야 합니다." });
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

  const refreshedSession = {
    ...session,
    mustChangePassword: false,
    sessionEpoch: result.sessionEpoch
  };
  const sessionCookie = await createSessionCookie(
    refreshedSession,
    env,
    new URL(request.url).protocol === "https:"
  );

  if (session.mustChangePassword) {
    return redirect("/app?toast=password-changed", { "Set-Cookie": sessionCookie });
  }

  return withSessionCookie(renderPasswordResult(refreshedSession, { success: true }), sessionCookie);
}

function renderPasswordResult(session, options = {}) {
  return passwordPage({ session, required: Boolean(session.mustChangePassword), ...options });
}

function withSessionCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
