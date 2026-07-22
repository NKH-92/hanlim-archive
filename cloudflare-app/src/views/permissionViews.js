import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  PERMISSION_PRESETS,
  matchingPermissionPreset,
  permissionFlags
} from "../permissions.js";
import { escapeHtml } from "../ui/html/escape.js";
import { alertDanger, page } from "./layout.js";

export function userPermissionsPage({ session, user, error = "" }) {
  const flags = permissionFlags(user);
  const currentPreset = matchingPermissionPreset(flags);
  const currentPermissions = PERMISSION_KEYS.filter((permission) => flags[permission]);
  return page("사용자 권한", `
    <section class="page-head">
      <div><h1>사용자 권한</h1><p class="muted">${escapeHtml(user.display_name)} (${escapeHtml(user.username)}) 계정의 관리 범위를 설정합니다.</p></div>
      <a class="button secondary" href="/admin/settings">사용자 관리</a>
    </section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/admin/users/${Number(user.id)}/permissions" class="stack">
        <div class="permission-current" role="status">
          <strong>현재 구성: ${escapeHtml(PERMISSION_PRESETS[currentPreset].label)}</strong>
          <span>${currentPermissions.length ? currentPermissions.map((permission) => escapeHtml(PERMISSION_LABELS[permission])).join(" · ") : "조회 전용"}</span>
        </div>
        <label>권한 프리셋
          <select name="preset" data-permission-preset>
            ${Object.entries(PERMISSION_PRESETS).map(([value, preset]) => `<option value="${escapeHtml(value)}" data-permissions="${escapeHtml((preset.permissions || []).join(","))}" ${value === currentPreset ? "selected" : ""}>${escapeHtml(preset.label)}</option>`).join("")}
          </select>
        </label>
        <fieldset data-custom-permissions><legend>저장 후 적용 권한</legend>
          ${PERMISSION_KEYS.map((permission) => `<label class="check-inline"><input type="checkbox" name="${escapeHtml(permission)}" value="1" data-permission-key="${escapeHtml(permission)}" data-permission-label="${escapeHtml(PERMISSION_LABELS[permission])}" ${flags[permission] ? "checked" : ""}> ${escapeHtml(PERMISSION_LABELS[permission])}</label>`).join("")}
        </fieldset>
        <section class="permission-diff" aria-live="polite" data-permission-diff>
          <strong>변경 미리보기</strong>
          <p>현재 권한과 동일합니다.</p>
        </section>
        <p class="muted">프리셋을 선택하면 적용될 권한이 위 체크박스에 즉시 표시됩니다. 직접 조정하면 사용자 지정으로 전환됩니다.</p>
        <label class="checkbox"><input type="checkbox" name="confirmPermissions" value="1" required> 위 변경 결과를 확인했습니다.</label>
        <button type="submit" class="button">권한 저장</button>
      </form>
    </section>
    ${permissionPreviewScript(flags)}
  `, session);
}

function permissionPreviewScript(flags) {
  const initial = JSON.stringify(flags);
  return `<script>
    (function () {
      var initial = ${initial};
      var preset = document.querySelector('[data-permission-preset]');
      var boxes = Array.from(document.querySelectorAll('[data-permission-key]'));
      var diff = document.querySelector('[data-permission-diff]');
      function renderDiff() {
        var added = [];
        var removed = [];
        boxes.forEach(function (box) {
          var label = box.getAttribute('data-permission-label') || box.name;
          if (box.checked && !initial[box.name]) added.push(label);
          if (!box.checked && initial[box.name]) removed.push(label);
        });
        if (!diff) return;
        var heading = document.createElement('strong');
        heading.textContent = '변경 미리보기';
        if (!added.length && !removed.length) {
          var same = document.createElement('p');
          same.textContent = '현재 권한과 동일합니다.';
          diff.replaceChildren(heading, same);
          return;
        }
        var nodes = [heading];
        if (added.length) {
          var addedNode = document.createElement('p');
          addedNode.className = 'permission-added';
          addedNode.textContent = '추가: ' + added.join(', ');
          nodes.push(addedNode);
        }
        if (removed.length) {
          var removedNode = document.createElement('p');
          removedNode.className = 'permission-removed';
          removedNode.textContent = '제거: ' + removed.join(', ');
          nodes.push(removedNode);
        }
        diff.replaceChildren.apply(diff, nodes);
      }
      preset?.addEventListener('change', function () {
        if (preset.value !== 'custom') {
          var selected = preset.options[preset.selectedIndex];
          var permissions = (selected.getAttribute('data-permissions') || '').split(',').filter(Boolean);
          boxes.forEach(function (box) { box.checked = permissions.indexOf(box.name) !== -1; });
        }
        renderDiff();
      });
      boxes.forEach(function (box) {
        box.addEventListener('change', function () {
          if (preset) preset.value = 'custom';
          renderDiff();
        });
      });
      renderDiff();
    })();
  </script>`;
}
