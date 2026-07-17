import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  PERMISSION_PRESETS,
  permissionFlags
} from "../permissions.js";
import { escapeHtml } from "../utils.js";
import { alertDanger, page } from "./layout.js";

export function userPermissionsPage({ session, user, error = "" }) {
  const flags = permissionFlags(user);
  return page("사용자 권한", `
    <section class="page-head">
      <div><h1>사용자 권한</h1><p class="muted">${escapeHtml(user.display_name)} (${escapeHtml(user.username)}) 계정의 관리 범위를 설정합니다.</p></div>
      <a class="button secondary" href="/admin/settings">사용자 관리</a>
    </section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/admin/users/${Number(user.id)}/permissions" class="stack">
        <label>권한 프리셋
          <select name="preset">
            ${Object.entries(PERMISSION_PRESETS).map(([value, preset]) => `<option value="${escapeHtml(value)}" ${value === "custom" ? "selected" : ""}>${escapeHtml(preset.label)}</option>`).join("")}
          </select>
        </label>
        <fieldset><legend>사용자 지정 권한</legend>
          ${PERMISSION_KEYS.map((permission) => `<label class="check-inline"><input type="checkbox" name="${escapeHtml(permission)}" value="1" ${flags[permission] ? "checked" : ""}> ${escapeHtml(PERMISSION_LABELS[permission])}</label>`).join("")}
        </fieldset>
        <p class="muted">프리셋을 선택하면 프리셋 구성이 우선 적용됩니다. 체크박스를 직접 적용하려면 사용자 지정을 선택하세요.</p>
        <button type="submit" class="button">권한 저장</button>
      </form>
    </section>
  `, session);
}
