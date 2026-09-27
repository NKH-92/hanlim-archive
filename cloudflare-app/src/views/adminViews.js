// 관리자 화면: 관리 설정·사용자 승인·분류/태그·비밀번호.

import { escapeHtml } from "../ui/html/escape.js";
import { hasReadPermission, isDemoReadOnly, PERMISSIONS } from "../permissions.js";
import { PASSWORD_POLICY } from "../domains/identity/index.js";
import { alertDanger, alertInfo, alertNote, alertWarning, emptyState, page, pageHead, sectionHeader } from "./layout.js";

export { categoriesPage, tagsPage } from "../domains/masters/index.js";

const USERS_PARENT = Object.freeze({ href: "/admin/settings", label: "사용자 관리" });

export function adminDashboardPage({ session, pendingCount, quality = null, capacity = null, searchIndex = null }) {
  const pending = Number(pendingCount || 0);
  const qualityIssues = qualityIssueCount(quality);
  const searchAttention = searchIndex?.level === "warning" ? 1 : 0;
  const capacityAttention = capacity && capacity.level !== "ok" ? 1 : 0;
  const attentionCount = pending + qualityIssues + searchAttention + capacityAttention;
  const groups = [];
  if (hasReadPermission(session, PERMISSIONS.MANAGE_USERS)) {
    groups.push(managementGroup("사용자 및 접근", [
      ["/admin/settings", "fa-users-gear", "사용자 관리", `${pending}건 승인 대기`]
    ]));
  }
  if (hasReadPermission(session, PERMISSIONS.MANAGE_MASTERS)) {
    groups.push(managementGroup("문서고 기준정보", [
      ["/racks", "fa-table-cells-large", "랙 관리", "랙 목록과 위치 확인"],
      ["/racks/configure", "fa-gear", "랙 구성", "구역별 랙 수 조정"],
      ["/categories", "fa-layer-group", "대분류 관리", "문서 분류 기준"],
      ["/tags", "fa-tags", "태그 관리", "검색 보조 키워드"]
    ]));
  }
  const dataLinks = [];
  if (hasReadPermission(session, PERMISSIONS.MANAGE_DOCUMENTS)) {
    dataLinks.push(["/documents/import", "fa-file-excel", "엑셀 대장 동기화", "엑셀 전체 동기화·검증·인쇄용 추출"]);
    dataLinks.push(["/documents/new", "fa-file-circle-plus", "문서 등록", "새 문서를 현재 대장에 바로 등록"]);
  }
  if (hasReadPermission(session, PERMISSIONS.VIEW_AUDIT)) {
    dataLinks.push(["/admin/audit", "fa-clock-rotate-left", "감사 이력", "전역 변경 이력"]);
  }
  if (hasReadPermission(session, PERMISSIONS.MOVE_DOCUMENTS) || hasReadPermission(session, PERMISSIONS.VIEW_AUDIT)) {
    dataLinks.push(["/admin/movements", "fa-location-crosshairs", "위치 이동 이력", "문서 위치 변경 조회"]);
  }
  if (dataLinks.length) {
    groups.push(managementGroup("데이터 및 감사", dataLinks));
  }
  const advancedLinks = [];
  if (hasReadPermission(session, PERMISSIONS.MANAGE_SETS)) {
    advancedLinks.push(["/sets", "fa-clone", "준비 문서 세트", "문서 묶음 생성·잠금·인쇄"]);
  }
  if (hasReadPermission(session, PERMISSIONS.MANAGE_DOCUMENTS)) {
    advancedLinks.push(["/document-import-jobs", "fa-file-csv", "CSV 가져오기", "이전 방식의 CSV 문서 등록 작업"]);
    advancedLinks.push(["/admin/data-quality", "fa-list-check", "데이터 품질", "문제 문서 작업 목록"]);
  }
  if (hasReadPermission(session, PERMISSIONS.VIEW_AUDIT)) {
    advancedLinks.push(["/admin/search-report", "fa-chart-simple", "검색 리포트", "자주 찾는·실패 검색어"]);
  }
  if (advancedLinks.length) {
    groups.push(managementGroup("관리자 고급 도구", advancedLinks, true));
  }
  const heroAction = pending && hasReadPermission(session, PERMISSIONS.MANAGE_USERS)
    ? `<a class="button action-button" href="/admin/settings">승인 요청 확인</a>`
    : qualityIssues && hasReadPermission(session, PERMISSIONS.MANAGE_DOCUMENTS)
      ? `<a class="button action-button" href="/admin/data-quality">품질 작업 보기</a>`
      : "";
  return page("운영 관리", `
    <section class="page-head">
      <h1>운영 관리</h1>
    </section>
    <section class="panel admin-status-panel ${attentionCount ? "is-attention" : "is-stable"}" aria-label="운영 상태 요약">
      <div class="admin-status-copy"><h2>${attentionCount ? `확인할 운영 항목이 ${attentionCount.toLocaleString("ko-KR")}건 있어요` : "문서고를 안정적으로 운영하고 있어요"}</h2><p>승인 대기 ${pending.toLocaleString("ko-KR")}건 · 데이터 품질 ${qualityIssues.toLocaleString("ko-KR")}건${searchIndex ? ` · 검색 색인 ${searchIndex.level === "ok" ? "정상" : "확인 필요"}` : ""}${capacity ? ` · 문서 ${Number(capacity.currentCount).toLocaleString("ko-KR")} / ${Number(capacity.hardCount).toLocaleString("ko-KR")}건` : ""}</p>${heroAction}</div>
    </section>
    ${quality ? dataQualityPanel(quality) : ""}
    ${capacity && capacity.level !== "ok" ? capacityPanel(capacity) : ""}
    ${searchIndex && searchIndex.level !== "ok" ? searchIndexPanel(searchIndex) : ""}
    <div class="management-grid">
      ${groups.join("")}
    </div>
  `, session);
}

function capacityPanel(capacity) {
  const level = capacity.level === "blocked" ? "review" : capacity.level;
  const message = capacity.level === "blocked"
    ? "기술 상한에 도달했어요. 새 문서 등록과 대장 반영을 할 수 없어요."
    : capacity.level === "warning"
      ? "운영 경고 구간이에요. 확장하거나 제외할 계획을 정해 주세요."
      : "30,000건 기술 상한까지 여유가 있어요.";
  return `<section class="panel search-index-health ${escapeHtml(level)}">
    <div><strong>문서 대장 용량</strong><span>${Number(capacity.currentCount).toLocaleString("ko-KR")} / ${Number(capacity.hardCount).toLocaleString("ko-KR")}건 · 잔여 ${Number(capacity.remainingCount).toLocaleString("ko-KR")}건</span></div><p>${escapeHtml(message)}</p>
  </section>`;
}

function qualityIssueCount(quality) {
  if (!quality) return 0;
  return [
    quality.duplicateDocumentNumbers,
    quality.missingLocation,
    quality.missingCategory,
    quality.invalidRackFace,
    quality.suspiciousText,
    quality.missingDisposalYear
  ].reduce((sum, value) => sum + Number(value || 0), 0);
}

function managementGroup(title, links, advanced = false) {
  return `
    <section class="panel management-section${advanced ? " is-advanced" : ""}">
      <div class="management-heading"><h2>${escapeHtml(title)}</h2></div>
      <div class="admin-grid management-links">
        ${links.map(([href, icon, label, caption]) => `<a class="panel admin-tile" href="${href}"><span class="icon-frame" aria-hidden="true"><i class="fa-solid ${icon}"></i></span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(caption)}</small></span></a>`).join("")}
      </div>
    </section>
  `;
}

function dataQualityPanel(quality) {
  const issues = [
    ["duplicate-number", "중복 문서번호·개정", quality.duplicateDocumentNumbers],
    ["missing-location", "누락 위치", quality.missingLocation],
    ["inactive-category", "비활성/누락 분류", quality.missingCategory],
    ["invalid-face", "단면 랙 2면 문서", quality.invalidRackFace],
    ["suspicious-text", "문자 깨짐 의심", quality.suspiciousText],
    ["missing-disposal-year", "폐기 예정 연도 누락", quality.missingDisposalYear]
  ].filter(([, , value]) => Number(value) > 0);

  if (!issues.length) {
    return "";
  }

  return `<section class="quality-strip" aria-label="데이터 품질">${issues.map(([issue, label, value]) => `<a class="warn" href="/admin/data-quality?issue=${issue}"><strong>${value}</strong>${label}</a>`).join("")}</section>`;
}

function searchIndexPanel(stats) {
  const readiness = stats.readiness;
  // 검색 색인 동기화는 /readyz 실패가 아니라 이 화면의 경고로 노출한다(파생 데이터 격리).
  const message = readiness ? searchIndexMessage(readiness) : `색인 ${count(stats.indexedDocumentCount)}건`;
  // 표시 등급은 read model이 Core schema와 projection 동기화 상태를 합쳐 계산한 값을 그대로 사용한다.
  const level = stats.level;
  return `<section class="panel search-index-health ${escapeHtml(level)}">
    <div><strong>문서 검색 색인</strong><span>색인 완료 ${count(stats.indexedDocumentCount)}건</span></div><p class="${escapeHtml(level)}">${escapeHtml(message)}</p>
  </section>`;
}

function count(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

// 내부 상태값(projection/reindex_status/dirty)을 운영자가 읽을 수 있는 한국어 상태와 다음 행동으로 옮긴다.
const SEARCH_INDEX_STATE_LABELS = Object.freeze({
  ready: "색인 최신 상태",
  building: "색인 재구성 중",
  pending: "색인 재구성 대기",
  unavailable: "색인 사용 불가"
});

function searchIndexMessage(readiness) {
  const projection = readiness.projection || {};
  const stateLabel = SEARCH_INDEX_STATE_LABELS[projection.reindexStatus] || "색인 상태 확인 필요";
  const parts = [stateLabel];
  const remaining = Number(projection.pendingDirtyCount || 0);
  if (remaining > 0) parts.push(`반영 대기 ${count(remaining)}건`);
  if (!readiness.checks?.coreDatabase) parts.push("데이터베이스 업데이트 필요");
  if (readiness.ok && !readiness.degraded) return `검색이 정상이에요 · ${parts.join(" · ")}`;
  parts.push("자동으로 재구성하고 있으니 끝나면 다시 확인해 주세요");
  return `검색 결과에서 일부 문서가 빠질 수 있어요 · ${parts.join(" · ")}`;
}

export function adminSettingsPage({ session, users }) {
  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");
  const disabled = users.filter((u) => u.status === "disabled");
  const rejected = users.filter((u) => u.status === "rejected");
  const templateManagement = session?.role === "Admin" || isDemoReadOnly(session)
    ? `<a class="button secondary" href="/admin/role-templates">역할 템플릿</a>`
    : "";
  const userCreation = session?.role === "Admin" || isDemoReadOnly(session)
    ? `<a class="button" href="/admin/users/new">승인 사용자 추가</a>`
    : "";
  return page("사용자 관리", `
    <section class="page-head"><h1>사용자 관리</h1><div class="button-group">${templateManagement}${userCreation}</div></section>
    ${pending.length ? `<section class="panel">${sectionHeader("가입 요청", `${pending.length}건`)}${userRequestTable(pending, session)}</section>` : ""}
    <div class="user-group-stack">
      ${pending.length ? "" : userGroupSection("가입 요청", "0건", pending, session, "대기 중인 가입 요청이 없어요.")}
      ${userGroupSection("승인된 사용자", `${approved.length}명`, approved, session, "승인된 사용자가 없어요.", true)}
      ${userGroupSection("사용중지 사용자", `${disabled.length}명`, disabled, session, "사용중지된 사용자가 없어요.")}
      ${userGroupSection("반려된 요청", `${rejected.length}건`, rejected, session, "반려된 요청이 없어요.")}
    </div>
  `, session);
}

export function approvedUserCreatePage({ session, values = {}, error = "", minLength = PASSWORD_POLICY.minLength }) {
  const username = String(values.username ?? "").trim().toLowerCase();
  const displayName = String(values.displayName ?? "").trim();
  const team = String(values.team ?? "").trim();
  return page("승인 사용자 추가", `
    ${pageHead({ title: "승인 사용자 추가", parent: USERS_PARENT })}
    <section class="panel narrow">
      ${alertNote("새 계정은 조회 전용으로 승인돼요. 사용자는 임시 비밀번호로 로그인한 뒤 새 비밀번호로 바꿔야 해요. 추가 권한은 계정을 만든 뒤 사용자 권한 화면에서 설정해 주세요.")}
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/admin/users/new" class="stack">
        <label>사용자 아이디(이메일)<input name="username" type="email" autocomplete="off" maxlength="254" value="${escapeHtml(username)}" required></label>
        <label>이름<input name="displayName" type="text" autocomplete="name" maxlength="60" value="${escapeHtml(displayName)}" required></label>
        <label>부서<input name="team" type="text" autocomplete="organization" maxlength="40" value="${escapeHtml(team)}"></label>
        <label>임시 비밀번호<input type="password" name="temporaryPassword" autocomplete="new-password" minlength="${Number(minLength)}" required></label>
        <label>임시 비밀번호 확인<input type="password" name="confirmPassword" autocomplete="new-password" minlength="${Number(minLength)}" required></label>
        <label class="checkbox"><input type="checkbox" name="confirmCreate" value="1" required><span>일반 사용자·조회 전용으로 승인하고, 다음 로그인 때 비밀번호를 바꾸게 한다는 것을 확인했어요.</span></label>
        <p class="muted">임시 비밀번호는 ${Number(minLength)}자 이상으로 정하고, 사용자에게는 별도 보안 채널로 전달해 주세요.</p>
        <button type="submit" class="button">승인 사용자 추가</button>
      </form>
    </section>
  `, session);
}

// 세 사용자 그룹은 한 행씩 쌓는다. 자주 보는 승인된 사용자만 펼쳐 두고 나머지는 건수만 보이게 접는다.
function userGroupSection(title, count, users, session, emptyMessage, open = false) {
  return `<details class="panel user-group"${open ? " open" : ""}>
    <summary><span class="user-group-title">${escapeHtml(title)}</span><span class="count-badge">${escapeHtml(count)}</span></summary>
    <div class="user-group-body">${users.length ? userRequestTable(users, session) : emptyState(emptyMessage)}</div>
  </details>`;
}

function userRequestTable(users, session) {
  return `
    <div class="table-wrap"><table class="doc-table">
      <caption class="sr-only">사용자 목록</caption>
      <thead><tr><th>아이디</th><th>이름</th><th>팀</th><th>역할</th><th>상태</th><th>요청일</th><th>처리</th></tr></thead>
      <tbody>${users.map((user) => `<tr><td data-label="아이디">${escapeHtml(user.username)}</td><td data-label="이름">${escapeHtml(user.display_name)}</td><td data-label="팀">${escapeHtml(user.team || "-")}</td><td data-label="역할">${escapeHtml(userRoleLabel(user))}</td><td data-label="상태">${userStatus(user)}</td><td data-label="요청일">${escapeHtml(user.requested_at || "-")}</td><td data-label="처리">${userActions(user, session)}</td></tr>`).join("")}</tbody>
    </table></div>
  `;
}

function userRoleLabel(user) {
  if (user.access_mode === "demo_readonly") return "시연 및 조회용";
  if (user.role === "Admin") return user.role_template_label || "시스템관리";
  return user.role_template_label || "사용자 지정";
}

function userActions(user, session) {
  const deletion = userDeleteLink(user, session);
  if (Number(user.security_review_required || 0) === 1) {
    return `<div class="button-group"><span class="muted">보안 검토 대상 · 일반 재승인 불가</span>${deletion}</div>`;
  }
  const canResetPassword = (session?.role === "Admin" || isDemoReadOnly(session))
    && Number(user.id) !== Number(session.userId)
    && user.username !== session.username
    && ["approved", "disabled"].includes(user.status);
  const passwordReset = canResetPassword
    ? `<a class="button secondary sm" href="/admin/users/${user.id}/reset-password">비밀번호 초기화</a>`
    : "";
  if (user.role === "Admin") {
    return `<div class="button-group">${passwordReset || `<span class="muted">현재 관리자 계정</span>`}${deletion}</div>`;
  }
  const permissions = `<a class="button secondary sm" href="/admin/users/${user.id}/permissions">권한</a>`;
  const target = `${user.display_name} (${user.username})`;
  if (user.status === "approved") return `<div class="button-group">${permissions}${passwordReset}<form method="post" action="/admin/users/${user.id}/disable" data-confirm="${escapeHtml(target)} 계정의 로그인을 중지할까요?"><button type="submit" class="danger-button sm">사용중지</button></form>${deletion}</div>`;
  if (user.status === "disabled") return `<div class="button-group">${permissions}${passwordReset}<form method="post" action="/admin/users/${user.id}/enable" data-confirm="${escapeHtml(target)} 계정을 다시 사용할 수 있게 할까요?"><button type="submit" class="primary sm">다시 사용</button></form>${deletion}</div>`;
  if (user.status === "rejected") return `<div class="button-group">${permissions}<form method="post" action="/admin/users/${user.id}/approve" data-confirm="${escapeHtml(target)} 계정을 재승인할까요? 저장된 권한도 함께 확인해 주세요."><button type="submit" class="primary sm">재승인</button></form>${deletion}</div>`;
  return `<div class="button-group">${permissions}<form method="post" action="/admin/users/${user.id}/approve" data-confirm="${escapeHtml(target)} 가입 요청을 승인할까요? 승인한 뒤 권한을 설정해 주세요."><button type="submit" class="primary sm">승인</button></form><form method="post" action="/admin/users/${user.id}/reject" data-confirm="${escapeHtml(target)} 가입 요청을 반려할까요?"><button type="submit" class="danger-button sm">반려</button></form>${deletion}</div>`;
}

// 완전삭제는 되돌릴 수 없으므로 목록에서 바로 실행하지 않고 전용 확인 화면으로 보낸다.
function userDeleteLink(user, session) {
  if (session?.role !== "Admin" && !isDemoReadOnly(session)) return "";
  if (Number(user.id) === Number(session.userId) || user.username === session.username) return "";
  return `<a class="button danger-button sm" href="/admin/users/${user.id}/delete">완전삭제</a>`;
}

export function userDeletePage({ session, user, error = "" }) {
  return page("계정 완전삭제", `
    ${pageHead({ title: "계정 완전삭제", parent: USERS_PARENT, subtitle: `${escapeHtml(user.display_name)} (${escapeHtml(user.username)})` })}
    <section class="panel narrow">
      ${alertWarning("계정 정보와 로그인 수단을 삭제하며 되돌릴 수 없어요. 이 계정이 남긴 문서 작업과 감사 이력은 그대로 남아요.")}
      ${error ? alertDanger(error) : ""}
      <dl class="user-delete-summary">
        <div><dt>아이디</dt><dd class="mono">${escapeHtml(user.username)}</dd></div>
        <div><dt>이름</dt><dd>${escapeHtml(user.display_name)}</dd></div>
        <div><dt>역할</dt><dd>${escapeHtml(userRoleLabel(user))}</dd></div>
        <div><dt>상태</dt><dd>${userStatus(user)}</dd></div>
        <div><dt>요청일</dt><dd>${escapeHtml(user.requested_at || "-")}</dd></div>
      </dl>
      <form method="post" action="/admin/users/${user.id}/delete" class="stack">
        <label>삭제하려면 계정 아이디를 그대로 입력해 주세요<input name="confirmedUsername" autocomplete="off" spellcheck="false" required></label>
        <label class="checkbox"><input type="checkbox" name="confirmDelete" value="1" required><span>이 계정을 완전삭제하면 복구할 수 없다는 것을 확인했어요.</span></label>
        <button type="submit" class="danger-button">계정 완전삭제</button>
      </form>
    </section>
  `, session);
}

export function userPasswordResetPage({ session, user, error = "", minLength = PASSWORD_POLICY.minLength }) {
  return page("비밀번호 초기화", `
    ${pageHead({ title: "비밀번호 초기화", parent: USERS_PARENT, subtitle: `${escapeHtml(user.display_name)} (${escapeHtml(user.username)})` })}
    <section class="panel narrow">
      ${alertWarning("초기화하면 이 계정의 기존 로그인 세션이 모두 바로 끝나요. 사용자는 임시 비밀번호로 로그인한 뒤 새 비밀번호로 바꿔야 시스템을 쓸 수 있어요.")}
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/admin/users/${user.id}/reset-password" class="stack">
        <label>임시 비밀번호<input type="password" name="temporaryPassword" autocomplete="new-password" minlength="${Number(minLength)}" required></label>
        <label>임시 비밀번호 확인<input type="password" name="confirmPassword" autocomplete="new-password" minlength="${Number(minLength)}" required></label>
        <label class="checkbox"><input type="checkbox" name="confirmReset" value="1" required><span>기존 세션이 끝나고, 다음 로그인 때 비밀번호를 바꿔야 한다는 것을 확인했어요.</span></label>
        <p class="muted">임시 비밀번호는 ${Number(minLength)}자 이상으로 정하고, 사용자에게는 별도 보안 채널로 전달해 주세요.</p>
        <button type="submit" class="danger-button">비밀번호 초기화</button>
      </form>
    </section>
  `, session);
}

function userStatus(user) {
  if (Number(user.security_review_required || 0) === 1) return `<span class="status account-review">보안 검토 필요</span>`;
  if (user.status === "approved") return `<span class="status account-approved">승인</span>`;
  if (user.status === "disabled") return `<span class="status account-disabled">사용중지</span>`;
  if (user.status === "rejected") return `<span class="status account-rejected">반려</span>`;
  return `<span class="status account-pending">대기</span>`;
}

export function passwordPage({ session, error = "", success = false, required = false }) {
  const passwordFields = `
    <label>현재 비밀번호<input type="password" name="currentPassword" autocomplete="current-password" required></label>
    <label>새 비밀번호<input type="password" name="newPassword" autocomplete="new-password" required></label>
    <label>새 비밀번호 확인<input type="password" name="confirmPassword" autocomplete="new-password" required></label>
    <p class="muted">새 비밀번호는 ${PASSWORD_POLICY.minLength}자 이상이어야 해요. 바꾸면 지금 쓰고 있는 화면을 뺀 다른 로그인 세션은 모두 끝나요.</p>
    <button type="submit" class="primary">비밀번호 변경</button>
  `;

  if (required) {
    return page("비밀번호 변경", `
      <section class="page-head"><h1>비밀번호 변경</h1></section>
      <dialog id="required-password-change" class="modal" open data-auto-open-modal data-forced-modal aria-labelledby="required-password-change-title">
        <form method="post" action="/account/password" class="modal-body">
          <h2 id="required-password-change-title">첫 로그인 비밀번호 변경</h2>
          ${alertInfo("처음 로그인했어요. 계속 사용하려면 기본 비밀번호를 새 비밀번호로 바꿔 주세요.")}
          ${error ? alertDanger(error) : ""}
          ${passwordFields}
        </form>
      </dialog>
    `, session);
  }

  return page("비밀번호 변경", `
    <section class="page-head"><h1>비밀번호 변경</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      ${success ? `<div class="alert success" role="status">비밀번호를 바꿨어요.</div>` : ""}
      <form method="post" action="/account/password" class="stack">
        ${passwordFields}
      </form>
    </section>
  `, session);
}
