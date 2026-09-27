import {
  CUSTOM_ROLE_TEMPLATE_KEY,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  permissionFlags,
  samePermissions
} from "../permissions.js";
import { escapeHtml } from "../ui/html/escape.js";
import { alertDanger, alertWarning, emptyState, page, pageHead, sectionHeader } from "./layout.js";

export function userPermissionsPage({ session, user, templates, error = "" }) {
  const flags = permissionFlags(user);
  const currentTemplate = templates.find((template) => (
    template.key === user.role_template_key && samePermissions(flags, template)
  ));
  const currentKey = currentTemplate?.key || CUSTOM_ROLE_TEMPLATE_KEY;
  const currentLabel = currentTemplate?.label || "사용자 지정";
  const currentPermissions = PERMISSION_KEYS.filter((permission) => flags[permission]);
  // 역할을 선택한 저장은 서버가 템플릿 값을 다시 읽어 적용한다. 화면이 본 버전을 함께
  // 보내 편집 중 템플릿이 바뀐 경우 stale 저장을 거부한다.
  const templateVersions = JSON.stringify(Object.fromEntries(
    templates.map((template) => [template.key, Number(template.row_version)])
  ));
  return page("사용자 권한", `
    ${pageHead({ title: "사용자 권한", parent: { href: "/admin/settings", label: "사용자 관리" }, subtitle: `${escapeHtml(user.display_name)} (${escapeHtml(user.username)})` })}
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/admin/users/${Number(user.id)}/permissions" class="stack">
        <input type="hidden" name="expectedRowVersion" value="${Number(user.row_version)}">
        <input type="hidden" name="templateVersions" value="${escapeHtml(templateVersions)}">
        <div class="permission-current" role="status">
          <strong>현재 구성: ${escapeHtml(currentLabel)}</strong>
          <span>${currentPermissions.length ? currentPermissions.map((permission) => escapeHtml(PERMISSION_LABELS[permission])).join(" · ") : "조회 전용"}</span>
        </div>
        <label>역할 템플릿
          <select name="templateKey" data-permission-preset>
            ${templates.map((template) => `<option value="${escapeHtml(template.key)}" data-permissions="${escapeHtml(enabledPermissions(template).join(","))}" ${template.key === currentKey ? "selected" : ""}>${escapeHtml(template.label)}</option>`).join("")}
            <option value="${CUSTOM_ROLE_TEMPLATE_KEY}" ${currentKey === CUSTOM_ROLE_TEMPLATE_KEY ? "selected" : ""}>사용자 지정</option>
          </select>
        </label>
        <fieldset data-custom-permissions><legend>사용자 지정 권한</legend>
          ${permissionCheckboxes(flags)}
        </fieldset>
        <section class="permission-diff" aria-live="polite" data-permission-diff>
          <strong>변경 미리보기</strong>
          <p>현재 권한과 같아요.</p>
        </section>
        <label class="checkbox" data-permission-confirm><input type="checkbox" name="confirmPermissions" value="1" required> 위 변경 결과를 확인했어요.</label>
        <button type="submit" class="button" data-permission-submit>역할·권한 저장</button>
      </form>
    </section>
    ${permissionPreviewScript(flags, currentKey)}
  `, session);
}

export function roleTemplatesPage({ session, templates }) {
  return page("역할 템플릿", `
    ${pageHead({ title: "역할 템플릿", parent: { href: "/admin/settings", label: "사용자 관리" } })}
    <section class="panel">
      <div class="table-wrap"><table class="doc-table">
        <caption class="sr-only">역할 템플릿 목록</caption>
        <thead><tr><th>역할</th><th>권한</th><th>관리</th></tr></thead>
        <tbody>${templates.map((template) => `<tr>
          <td data-label="역할"><strong>${escapeHtml(template.label)}</strong>${template.fixed ? `<br><span class="muted">수정 불가</span>` : ""}</td>
          <td data-label="권한">${permissionSummary(template)}</td>
          <td data-label="관리"><a class="button secondary sm" href="/admin/role-templates/${escapeHtml(template.key)}/edit">${template.fixed ? "사용자 반영" : "편집·반영"}</a></td>
        </tr>`).join("")}</tbody>
      </table></div>
    </section>
  `, session);
}

export function roleTemplateEditPage({ session, template, users, error = "" }) {
  const flags = permissionFlags(template);
  return page("역할 템플릿 편집", `
    ${pageHead({ title: template.label, parent: { href: "/admin/role-templates", label: "역할 템플릿" } })}
    ${error ? `<section class="panel narrow">${alertDanger(error)}</section>` : ""}
    ${template.fixed ? `<section class="panel narrow">${alertWarning("시스템관리 역할은 운영 복구 경계라서 이름과 권한을 수정할 수 없어요.")}<h2>고정 권한</h2><p>${permissionSummary(template)}</p></section>` : `
      <section class="panel narrow">
        <h2>템플릿 편집</h2>
        <form method="post" action="/admin/role-templates/${escapeHtml(template.key)}/edit" class="stack">
          <input type="hidden" name="expectedRowVersion" value="${Number(template.row_version)}">
          <label>역할 이름<input type="text" name="label" value="${escapeHtml(template.label)}" maxlength="50" required></label>
          <fieldset><legend>표준 권한</legend>${permissionCheckboxes(flags, false)}</fieldset>
          <label class="checkbox"><input type="checkbox" name="confirmTemplate" value="1" required> 템플릿을 바꿔도 기존 사용자에게 자동으로 반영되지 않는다는 점을 확인했어요.</label>
          <button type="submit" class="button">템플릿 저장</button>
        </form>
      </section>`}
    <section class="panel">
      ${sectionHeader("사용자에게 명시적으로 반영", `후보 ${users.length}명`)}
      <p class="muted">승인된 일반 사용자에게 한 번에 최대 38명까지 반영할 수 있어요.</p>
      ${users.length ? `<form method="post" action="/admin/role-templates/${escapeHtml(template.key)}/apply" class="stack">
        <input type="hidden" name="expectedTemplateRowVersion" value="${Number(template.row_version)}">
        <div class="table-wrap"><table class="doc-table">
          <caption class="sr-only">역할을 반영할 사용자 선택</caption>
          <thead><tr><th>선택</th><th>사용자</th><th>팀</th><th>현재 역할</th></tr></thead>
          <tbody>${users.map((user) => `<tr>
            <td data-label="선택"><input type="checkbox" name="userId" value="${Number(user.id)}" aria-label="${escapeHtml(user.display_name)} 선택"><input type="hidden" name="rowVersion_${Number(user.id)}" value="${Number(user.row_version)}"></td>
            <td data-label="사용자">${escapeHtml(user.display_name)}<br><span class="muted">${escapeHtml(user.username)}</span></td>
            <td data-label="팀">${escapeHtml(user.team || "-")}</td>
            <td data-label="현재 역할">${escapeHtml(user.role_template_label || "사용자 지정")}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        <p class="muted" role="status" data-bulk-selection>선택한 사용자 없음</p>
        <label class="checkbox"><input type="checkbox" name="confirmBulkApply" value="1" required> 선택한 사용자의 현재 개별 예외가 이 템플릿 값으로 바뀌는 것을 확인했어요.</label>
        <button type="submit" class="danger-button">선택 사용자에게 반영</button>
      </form>
      ${bulkSelectionScript()}` : emptyState("반영할 수 있는 승인된 일반 사용자가 없어요.")}
    </section>
  `, session);
}

// 확인 문구 자체에는 건수를 넣지 않는다(script 없이도 문장이 사실이어야 한다).
// 아래 status 줄만 선택 수를 따라간다.
function bulkSelectionScript() {
  return `<script>
    (function () {
      var status = document.querySelector('[data-bulk-selection]');
      var boxes = Array.from(document.querySelectorAll('input[name="userId"]'));
      if (!status || !boxes.length) return;
      function render() {
        var count = boxes.filter(function (box) { return box.checked; }).length;
        status.textContent = count ? '선택한 사용자 ' + count + '명' : '선택한 사용자 없음';
      }
      boxes.forEach(function (box) { box.addEventListener('change', render); });
      render();
    })();
  </script>`;
}

function permissionCheckboxes(flags, includeData = true) {
  return PERMISSION_KEYS.map((permission) => `<label class="check-inline"><input type="checkbox" name="${escapeHtml(permission)}" value="1"${includeData ? ` data-permission-key="${escapeHtml(permission)}" data-permission-label="${escapeHtml(PERMISSION_LABELS[permission])}"` : ""} ${flags[permission] ? "checked" : ""}> ${escapeHtml(PERMISSION_LABELS[permission])}</label>`).join("");
}

function permissionSummary(source) {
  const permissions = enabledPermissions(source);
  return permissions.length
    ? permissions.map((permission) => escapeHtml(PERMISSION_LABELS[permission])).join(" · ")
    : "조회 전용";
}

function enabledPermissions(source) {
  const flags = permissionFlags(source);
  return PERMISSION_KEYS.filter((permission) => flags[permission]);
}

function permissionPreviewScript(flags, currentKey) {
  const initial = JSON.stringify(flags);
  return `<script>
    (function () {
      var initial = ${initial};
      var initialKey = ${JSON.stringify(currentKey)};
      var preset = document.querySelector('[data-permission-preset]');
      var boxes = Array.from(document.querySelectorAll('[data-permission-key]'));
      var diff = document.querySelector('[data-permission-diff]');
      var confirmRow = document.querySelector('[data-permission-confirm]');
      var submit = document.querySelector('[data-permission-submit]');
      function syncConfirm(changed) {
        if (confirmRow) confirmRow.hidden = !changed;
        if (submit) submit.disabled = !changed;
      }
      function renderDiff() {
        var added = [];
        var removed = [];
        boxes.forEach(function (box) {
          var label = box.getAttribute('data-permission-label') || box.name;
          if (box.checked && !initial[box.name]) added.push(label);
          if (!box.checked && initial[box.name]) removed.push(label);
        });
        syncConfirm(Boolean(added.length || removed.length || (preset && preset.value !== initialKey)));
        if (!diff) return;
        var heading = document.createElement('strong');
        heading.textContent = '변경 미리보기';
        if (!added.length && !removed.length) {
          var same = document.createElement('p');
          same.textContent = '현재 권한과 같아요.';
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
        if (preset.value !== '${CUSTOM_ROLE_TEMPLATE_KEY}') {
          var selected = preset.options[preset.selectedIndex];
          var permissions = (selected.getAttribute('data-permissions') || '').split(',').filter(Boolean);
          boxes.forEach(function (box) { box.checked = permissions.indexOf(box.name) !== -1; });
        }
        renderDiff();
      });
      boxes.forEach(function (box) {
        box.addEventListener('change', function () {
          if (preset) preset.value = '${CUSTOM_ROLE_TEMPLATE_KEY}';
          renderDiff();
        });
      });
      renderDiff();
    })();
  </script>`;
}
