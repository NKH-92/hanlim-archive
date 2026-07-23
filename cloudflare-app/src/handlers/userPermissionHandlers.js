import {
  disableUser,
  enableUser,
  getAppUser,
  PASSWORD_POLICY,
  resetUserPassword,
  updateUserPermissions
} from "../domains/identity/index.js";
import { errorPage, notFoundPage } from "../views/authViews.js";
import { userPermissionsPage } from "../views/permissionViews.js";
import { userPasswordResetPage } from "../views/adminViews.js";
import {
  PERMISSION_KEYS,
  PERMISSION_PRESETS,
  permissionsForPreset
} from "../permissions.js";
import { redirect } from "../platform/http/responses.js";

export async function renderUserPermissions(env, session, userId, error = "") {
  const user = await getAppUser(env, userId);
  if (!user) return notFoundPage(session);
  if (Number(user.security_review_required || 0) === 1) {
    return errorPage("보안 검토 대상 계정은 일반 사용자 승인·권한 변경 절차로 복구할 수 없습니다.", session, 400);
  }
  if (user.role === "Admin") {
    return errorPage("기존 Admin 계정은 항상 모든 권한을 가지므로 개별 권한을 변경하지 않습니다.", session, 400);
  }
  return userPermissionsPage({ session, user, error });
}

export async function handleUserPermissions(request, env, session, userId) {
  const form = await request.formData();
  if (form.get("confirmPermissions") !== "1") {
    return renderUserPermissions(env, session, userId, "저장 후 적용될 권한 변경 결과를 확인하세요.");
  }
  const preset = String(form.get("preset") || "custom");
  const selectedPreset = Object.hasOwn(PERMISSION_PRESETS, preset) ? preset : "custom";
  const custom = Object.fromEntries(PERMISSION_KEYS.map((permission) => [permission, form.get(permission) === "1"]));
  const result = await updateUserPermissions(env, userId, permissionsForPreset(selectedPreset, custom), session);
  if (!result.ok) {
    return renderUserPermissions(env, session, userId, result.message);
  }
  return redirect("/admin/settings?toast=permissions-saved");
}

export async function handleUserStatusAction(env, session, userId, action) {
  const mutation = action === "disable" ? disableUser : action === "enable" ? enableUser : null;
  if (!mutation) return errorPage("지원하지 않는 사용자 상태 변경입니다.", session, 400);
  const result = await mutation(env, userId, session);
  if (!result.ok) return errorPage(result.message, session, 400);
  return redirect(`/admin/settings?toast=${action === "disable" ? "disabled" : "enabled"}`);
}

export async function renderUserPasswordReset(env, session, userId, error = "") {
  const user = await getAppUser(env, userId);
  if (!user) return notFoundPage(session);
  if (
    !["approved", "disabled"].includes(user.status)
    || Number(user.security_review_required || 0) === 1
  ) {
    return errorPage("승인 또는 사용중지 상태의 일반 계정만 비밀번호를 초기화할 수 있습니다.", session, 400);
  }
  if (Number(user.id) === Number(session.userId) || user.username === session.username) {
    return errorPage("현재 로그인한 계정은 비밀번호 변경 화면을 이용하세요.", session, 400);
  }
  return userPasswordResetPage({ session, user, error, minLength: PASSWORD_POLICY.minLength });
}

export async function handleUserPasswordReset(request, env, session, userId) {
  const form = await request.formData();
  const temporaryPassword = String(form.get("temporaryPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  if (!temporaryPassword || !confirmPassword) {
    return renderUserPasswordReset(env, session, userId, "임시 비밀번호와 확인값을 모두 입력하세요.");
  }
  if (temporaryPassword !== confirmPassword) {
    return renderUserPasswordReset(env, session, userId, "임시 비밀번호가 일치하지 않습니다.");
  }
  if (form.get("confirmReset") !== "1") {
    return renderUserPasswordReset(env, session, userId, "기존 세션 종료와 다음 로그인 시 변경 강제를 확인하세요.");
  }

  const result = await resetUserPassword(env, userId, temporaryPassword, session);
  if (!result.ok) return renderUserPasswordReset(env, session, userId, result.message);
  return redirect("/admin/settings?toast=password-reset");
}
