// 관리자 화면: 관리 설정·사용자 승인·분류/태그·비밀번호.

import { escapeHtml, readBoolean } from "../utils.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";
import { alertDanger, emptyState, page, sectionHeader } from "./layout.js";

export function adminDashboardPage({ session, pendingCount, quality = null, searchIndex = null }) {
  const groups = [];
  if (hasPermission(session, PERMISSIONS.MANAGE_USERS)) {
    groups.push(managementGroup("사용자 및 접근", "계정 승인과 사용 권한을 관리합니다.", [
      ["/admin/settings", "fa-users-gear", "사용자 관리", `${pendingCount}건 승인 대기`]
    ]));
  }
  if (hasPermission(session, PERMISSIONS.MANAGE_MASTERS)) {
    groups.push(managementGroup("문서고 기준정보", "보관 위치와 검색 분류 기준을 관리합니다.", [
      ["/racks", "fa-box-archive", "랙 관리", "랙 목록과 위치 확인"],
      ["/racks/configure", "fa-table-cells-large", "랙 구성", "구역별 랙 수 조정"],
      ["/categories", "fa-layer-group", "대분류 관리", "문서 분류 기준"],
      ["/tags", "fa-tags", "태그 관리", "검색 보조 키워드"]
    ]));
  }
  const dataLinks = [];
  if (hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS)) {
    dataLinks.push(["/documents/import", "fa-file-csv", "CSV 가져오기", "분할 대량 등록 작업"]);
    dataLinks.push(["/admin/data-quality", "fa-list-check", "데이터 품질", "문제 문서 작업 목록"]);
  }
  if (hasPermission(session, PERMISSIONS.VIEW_AUDIT)) {
    dataLinks.push(["/admin/search-report", "fa-chart-simple", "검색 리포트", "자주 찾는·실패 검색어"]);
    dataLinks.push(["/admin/audit", "fa-list-check", "감사 이력", "전역 변경 이력"]);
  }
  if (hasPermission(session, PERMISSIONS.MOVE_DOCUMENTS) || hasPermission(session, PERMISSIONS.VIEW_AUDIT)) {
    dataLinks.push(["/admin/movements", "fa-location-crosshairs", "위치 이동 이력", "문서 위치 변경 조회"]);
  }
  if (dataLinks.length) {
    groups.push(managementGroup("데이터 및 감사", "데이터 품질과 변경 증적을 확인합니다.", dataLinks));
  }
  const workLinks = [];
  if (hasPermission(session, PERMISSIONS.MANAGE_DISPOSALS)) {
    workLinks.push(["/disposal-batches", "fa-box-archive", "폐기 캠페인", "검토·동결·분할 폐기"]);
  }
  if (hasPermission(session, PERMISSIONS.MANAGE_SETS)) {
    workLinks.push(["/sets", "fa-list-check", "문서 세트", "목록·잠금·CSV 출력"]);
  }
  if (workLinks.length) {
    groups.push(managementGroup("업무 도구", "권한이 부여된 운영 작업입니다.", workLinks));
  }
  return page("관리 설정", `
    <section class="page-head">
      <div><h1>관리 설정</h1><p class="muted">문서고 운영에 필요한 기준정보와 관리 도구를 한곳에서 설정합니다.</p></div>
    </section>
    ${quality ? dataQualityPanel(quality) : ""}
    ${searchIndex ? searchIndexPanel(searchIndex) : ""}
    <div class="management-grid">
      ${groups.join("")}
    </div>
  `, session);
}

function managementGroup(title, description, links, advanced = false) {
  return `
    <section class="panel management-section${advanced ? " is-advanced" : ""}">
      <div class="management-heading"><div><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(description)}</p></div>${advanced ? `<span class="count-badge">고급</span>` : ""}</div>
      <div class="admin-grid management-links">
        ${links.map(([href, icon, label, caption]) => `<a class="panel admin-tile" href="${href}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(caption)}</small></span></a>`).join("")}
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
  const estimated = formatBytes(stats.estimatedJsonBytes);
  const message = stats.level === "review"
    ? `검색 인덱스가 ${stats.reviewCount.toLocaleString("ko-KR")}건에 도달했습니다. 서버 페이지 검색 구조를 재검토하세요.`
    : stats.level === "warning"
      ? `검색 인덱스가 ${stats.warningCount.toLocaleString("ko-KR")}건을 넘었습니다. 크기와 초기 로딩 시간을 점검하세요.`
      : "현재 무료티어 운영 기준 안입니다.";
  return `<section class="panel search-index-health ${escapeHtml(stats.level)}">
    <div><strong>즉시검색 인덱스</strong><span>${Number(stats.documentCount).toLocaleString("ko-KR")}건 · 예상 ${escapeHtml(estimated)}</span></div><p>${escapeHtml(message)}</p>
  </section>`;
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function adminSettingsPage({ session, users }) {
  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");
  const disabled = users.filter((u) => u.status === "disabled");
  const rejected = users.filter((u) => u.status === "rejected");
  return page("사용자 관리", `
    <section class="page-head"><div><h1>사용자 관리</h1><p class="muted">가입 요청과 승인된 계정을 관리합니다.</p></div><a class="button secondary" href="/admin">관리 설정</a></section>
    <section class="panel">${sectionHeader("가입 요청", `${pending.length}건`)}${pending.length ? userRequestTable(pending) : emptyState("대기 중인 가입 요청이 없습니다.")}</section>
    <section class="two-col">
      <article class="panel">${sectionHeader("승인된 사용자", `${approved.length}명`)}${approved.length ? userRequestTable(approved) : emptyState("승인된 사용자가 없습니다.")}</article>
      <article class="panel">${sectionHeader("사용중지 사용자", `${disabled.length}명`)}${disabled.length ? userRequestTable(disabled) : emptyState("사용중지된 사용자가 없습니다.")}</article>
      <article class="panel">${sectionHeader("반려된 요청", `${rejected.length}건`)}${rejected.length ? userRequestTable(rejected) : emptyState("반려된 요청이 없습니다.")}</article>
    </section>
  `, session);
}

function userRequestTable(users) {
  return `
    <div class="table-wrap"><table>
      <caption class="sr-only">사용자 목록</caption>
      <thead><tr><th>아이디</th><th>이름</th><th>상태</th><th>요청일</th><th>처리</th></tr></thead>
      <tbody>${users.map((user) => `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.display_name)}</td><td>${userStatus(user.status)}</td><td>${escapeHtml(user.requested_at || "-")}</td><td>${userActions(user)}</td></tr>`).join("")}</tbody>
    </table></div>
  `;
}

function userActions(user) {
  if (user.role === "Admin") return `<span class="muted">관리자 계정</span>`;
  const permissions = `<a class="button secondary sm" href="/admin/users/${user.id}/permissions">권한</a>`;
  if (user.status === "approved") return `<div class="button-group">${permissions}<form method="post" action="/admin/users/${user.id}/disable" data-confirm="사용을 중지하시겠습니까?"><button type="submit" class="danger-button sm">사용중지</button></form></div>`;
  if (user.status === "disabled") return `<div class="button-group">${permissions}<form method="post" action="/admin/users/${user.id}/enable"><button type="submit" class="primary sm">다시 사용</button></form></div>`;
  if (user.status === "rejected") return `<div class="button-group">${permissions}<form method="post" action="/admin/users/${user.id}/approve"><button type="submit" class="primary sm">재승인</button></form></div>`;
  return `<div class="button-group">${permissions}<form method="post" action="/admin/users/${user.id}/approve"><button type="submit" class="primary sm">승인</button></form><form method="post" action="/admin/users/${user.id}/reject"><button type="submit" class="danger-button sm">반려</button></form></div>`;
}

function userStatus(status) {
  if (status === "approved") return `<span class="status active">승인</span>`;
  if (status === "disabled") return `<span class="status pending">사용중지</span>`;
  if (status === "rejected") return `<span class="status disposed">반려</span>`;
  return `<span class="status pending">대기</span>`;
}

export function categoriesPage({ session, categories, values = {}, error = "" }) {
  return masterPage({ session, title: "대분류 관리", action: "/categories", rows: categories, values, error, type: "categories" });
}

export function tagsPage({ session, tags, values = {}, error = "" }) {
  return masterPage({ session, title: "태그 관리", action: "/tags", rows: tags, values, error, type: "tags" });
}

function masterPage({ session, title, action, rows, values, error, type }) {
  const isCategory = type === "categories";
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${action}" class="stack">
        <label>이름<input name="name" value="${escapeHtml(values.name || "")}" required></label>
        <label>설명<input name="description" value="${escapeHtml(values.description || "")}"></label>
        ${isCategory ? `<label>정렬 순서<input name="sortOrder" type="number" value="${escapeHtml(values.sortOrder ?? 0)}"></label>` : ""}
        <button type="submit" class="primary">추가</button>
      </form>
    </section>
    <section class="panel">${masterList(rows, type)}</section>
  `, session);
}

function masterList(rows, type) {
  if (!rows.length) return emptyState("등록된 항목이 없습니다.");
  return `<div class="master-list">${rows.map((row) => masterRow(row, type)).join("")}</div>`;
}

function masterRow(row, type) {
  const isCategory = type === "categories";
  const active = readBoolean(row.is_active);
  const base = `/${type}/${row.id}`;
  return `
    <article class="master-row">
      <form method="post" action="${base}/edit" class="master-form">
        <input name="name" value="${escapeHtml(row.name)}" required>
        <input name="description" value="${escapeHtml(row.description || "")}" placeholder="설명">
        ${isCategory ? `<input name="sortOrder" type="number" value="${escapeHtml(row.sort_order ?? 0)}">` : ""}
        <label class="check-inline"><input type="checkbox" name="isActive" value="1" ${active ? "checked" : ""}> ${active ? "사용" : "다시 사용"}</label>
        <button type="submit">수정</button>
      </form>
      <form method="post" action="${base}/delete" data-confirm="사용을 중지하시겠습니까? 신규 등록 화면에는 더 이상 표시되지 않습니다.">
        <button type="submit" class="danger-button">사용중지</button>
      </form>
    </article>
  `;
}

export function passwordPage({ session, error = "", success = false }) {
  return page("비밀번호 변경", `
    <section class="page-head"><h1>비밀번호 변경</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      ${success ? `<div class="alert success">비밀번호가 변경되었습니다.</div>` : ""}
      <form method="post" action="/account/password" class="stack">
        <label>현재 비밀번호<input type="password" name="currentPassword" autocomplete="current-password" required></label>
        <label>새 비밀번호<input type="password" name="newPassword" autocomplete="new-password" required></label>
        <label>새 비밀번호 확인<input type="password" name="confirmPassword" autocomplete="new-password" required></label>
        <button type="submit" class="primary">변경</button>
      </form>
    </section>
  `, session);
}
