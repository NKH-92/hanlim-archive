// 관리자 화면: 관리 설정·사용자 승인·분류/태그·비밀번호.

import { escapeHtml, readBoolean } from "../utils.js";
import { alertDanger, emptyState, page, sectionHeader } from "./layout.js";

export function adminDashboardPage({ session, pendingCount, quality = null }) {
  return page("관리 설정", `
    <section class="page-head">
      <div><h1>관리 설정</h1><p class="muted">문서고 운영에 필요한 기준정보와 관리 도구를 한곳에서 설정합니다.</p></div>
    </section>
    ${quality ? dataQualityPanel(quality) : ""}
    <div class="management-grid">
      ${managementGroup("사용자 및 접근", "계정 승인과 사용 권한을 관리합니다.", [
        ["/admin/settings", "fa-users-gear", "사용자 관리", `${pendingCount}건 승인 대기`]
      ])}
      ${managementGroup("문서고 기준정보", "보관 위치와 검색 분류 기준을 관리합니다.", [
        ["/racks", "fa-box-archive", "랙 관리", "랙 목록과 위치 확인"],
        ["/racks/configure", "fa-table-cells-large", "랙 구성", "구역별 랙 수 조정"],
        ["/categories", "fa-layer-group", "대분류 관리", "문서 분류 기준"],
        ["/tags", "fa-tags", "태그 관리", "검색 보조 키워드"]
      ])}
      ${managementGroup("데이터 및 검색", "초기 데이터 등록과 검색 품질을 확인합니다.", [
        ["/documents/import", "fa-file-csv", "초기 CSV 가져오기", "대량 등록 및 내보내기"],
        ["/admin/search-report", "fa-chart-simple", "검색 리포트", "자주 찾는·실패 검색어"]
      ])}
      ${managementGroup("고급 도구", "일상 업무에서는 사용하지 않는 보조 기능입니다.", [
        ["/sets", "fa-list-check", "문서 세트", "고급 묶음 관리 도구"]
      ], true)}
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
    ["중복 문서번호", quality.duplicateDocumentNumbers],
    ["누락 위치", quality.missingLocation],
    ["비활성/누락 분류", quality.missingCategory],
    ["단면 랙 2면 문서", quality.invalidRackFace],
    ["문자 깨짐 의심", quality.suspiciousText],
    ["태그 없음", quality.documentsWithoutTags]
  ].filter(([, value]) => Number(value) > 0);

  if (!issues.length) {
    return "";
  }

  return `<section class="quality-strip" aria-label="데이터 품질">${issues.map(([label, value]) => `<span class="warn"><strong>${value}</strong>${label}</span>`).join("")}</section>`;
}

export function adminSettingsPage({ session, users }) {
  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");
  const rejected = users.filter((u) => u.status === "rejected");
  return page("사용자 관리", `
    <section class="page-head"><div><h1>사용자 관리</h1><p class="muted">가입 요청과 승인된 계정을 관리합니다.</p></div><a class="button secondary" href="/admin">관리 설정</a></section>
    <section class="panel">${sectionHeader("가입 요청", `${pending.length}건`)}${pending.length ? userRequestTable(pending) : emptyState("대기 중인 가입 요청이 없습니다.")}</section>
    <section class="two-col">
      <article class="panel">${sectionHeader("승인된 사용자", `${approved.length}명`)}${approved.length ? userRequestTable(approved) : emptyState("승인된 사용자가 없습니다.")}</article>
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
  if (user.status === "approved") return `<form method="post" action="/admin/users/${user.id}/reject" data-confirm="승인을 취소할까요?"><button type="submit" class="danger-button sm">승인 취소</button></form>`;
  if (user.status === "rejected") return `<form method="post" action="/admin/users/${user.id}/approve"><button type="submit" class="primary sm">재승인</button></form>`;
  return `<div class="button-group"><form method="post" action="/admin/users/${user.id}/approve"><button type="submit" class="primary sm">승인</button></form><form method="post" action="/admin/users/${user.id}/reject"><button type="submit" class="danger-button sm">반려</button></form></div>`;
}

function userStatus(status) {
  if (status === "approved") return `<span class="status active">승인</span>`;
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
  const base = `/${type}/${row.id}`;
  return `
    <article class="master-row">
      <form method="post" action="${base}/edit" class="master-form">
        <input name="name" value="${escapeHtml(row.name)}" required>
        <input name="description" value="${escapeHtml(row.description || "")}" placeholder="설명">
        ${isCategory ? `<input name="sortOrder" type="number" value="${escapeHtml(row.sort_order ?? 0)}">` : ""}
        <label class="check-inline"><input type="checkbox" name="isActive" value="1" ${readBoolean(row.is_active) ? "checked" : ""}> 사용</label>
        <button type="submit">수정</button>
      </form>
      <form method="post" action="${base}/delete" data-confirm="삭제하면 신규 등록 화면에 표시되지 않습니다. 계속할까요?">
        <button type="submit" class="danger-button">삭제</button>
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
