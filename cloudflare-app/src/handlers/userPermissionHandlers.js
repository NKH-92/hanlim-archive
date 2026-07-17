import {
  disableUser,
  enableUser,
  getAppUser,
  updateUserPermissions
} from "../db.js";
import { errorPage, notFoundPage, userPermissionsPage } from "../html.js";
import {
  PERMISSION_KEYS,
  PERMISSION_PRESETS,
  permissionsForPreset
} from "../permissions.js";
import { redirect } from "../utils.js";

export async function renderUserPermissions(env, session, userId, error = "") {
  const user = await getAppUser(env, userId);
  if (!user) return notFoundPage(session);
  if (user.role === "Admin") {
    return errorPage("기존 Admin 계정은 항상 모든 권한을 가지므로 개별 권한을 변경하지 않습니다.", session, 400);
  }
  return userPermissionsPage({ session, user, error });
}

export async function handleUserPermissions(request, env, session, userId) {
  const form = await request.formData();
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
