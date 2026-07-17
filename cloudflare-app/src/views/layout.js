// 페이지 골격(page)과 여러 화면이 공유하는 범용 프래그먼트.

import { bytesToBase64Url, escapeHtml } from "../utils.js";
import { hasPermission, PERMISSIONS, sessionHasManagementAccess } from "../permissions.js";
import { htmlContentSecurityPolicy } from "../security.js";
import { clientScript } from "./clientScript.js";
import { styles } from "./styles.js";

export function page(title, body, session, status = 200) {
  // 요청별 CSP nonce. 인라인 <script>/<style>에 주입하고 응답 헤더의 script-src와 짝을 맞춘다.
  const nonce = createNonce();

  // CSRF는 헤더 로그아웃 폼까지 포함해 전체 HTML의 POST form에 주입한다.
  let html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - 한림문서고</title>
  <meta name="description" content="한림문서고 문서 검색 및 보관 위치 안내 시스템">
  ${session?.csrfToken ? `<meta name="csrf-token" content="${escapeHtml(session.csrfToken)}">` : ""}
  <style>${styles()}</style>
  <script>${clientScript()}</script>
</head>
<body>
  <a href="#main-content" class="skip-nav">본문 바로가기</a>
  ${session ? header(session) : ""}
  <main id="main-content" class="${session ? "app-shell" : "login-main"}">${body}</main>
</body>
</html>`;

  if (session?.csrfToken) {
    html = withCsrfToken(html, session.csrfToken);
  }
  html = applyNonce(html, nonce);

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": htmlContentSecurityPolicy(nonce)
    }
  });
}

function createNonce() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

// 인라인 <script>/<style> 태그에 CSP nonce를 주입한다. 본문의 사용자 값은 모두 escapeHtml로
// "<"가 이스케이프되므로 실제 스크립트/스타일 태그에만 매칭된다.
function applyNonce(html, nonce) {
  return html
    .replace(/<script(?=[\s>])(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`)
    .replace(/<style(?=[\s>])(?![^>]*\bnonce=)/gi, `<style nonce="${nonce}"`);
}

function withCsrfToken(body, token) {
  const hiddenInput = `<input type="hidden" name="csrf_token" value="${escapeHtml(token)}">`;
  return body.replace(/<form\b(?=[^>]*\bmethod=["']post["'])[^>]*>/gi, (formTag) => `${formTag}${hiddenInput}`);
}

function header(session) {
  const links = [
    ["/app", "fa-magnifying-glass", "검색"],
    ["/documents", "fa-file-lines", "전체 문서"],
    ["/sets", "fa-layer-group", "문서 세트"],
    ["/qa", "fa-circle-info", "Q&A"]
  ];
  if (hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS)) {
    links.push(["/documents/new", "fa-file-lines", "문서 등록"]);
    links.push(["/documents/import", "fa-file-csv", "CSV 가져오기"]);
  }
  if (hasPermission(session, PERMISSIONS.MANAGE_DISPOSALS)) {
    links.push(["/disposal-batches", "fa-box-archive", "폐기 캠페인"]);
  }
  if (hasPermission(session, PERMISSIONS.MANAGE_MASTERS)) {
    links.push(["/racks", "fa-table-cells-large", "랙"]);
    links.push(["/categories", "fa-list-check", "대분류"]);
    links.push(["/tags", "fa-tags", "태그"]);
  }
  if (hasPermission(session, PERMISSIONS.MANAGE_USERS)) {
    links.push(["/admin/settings", "fa-users-gear", "사용자·권한"]);
  }
  if (hasPermission(session, PERMISSIONS.VIEW_AUDIT)) {
    links.push(["/admin/audit", "fa-list-check", "감사 이력"]);
  }
  if (hasPermission(session, PERMISSIONS.MOVE_DOCUMENTS) || hasPermission(session, PERMISSIONS.VIEW_AUDIT)) {
    links.push(["/admin/movements", "fa-location-crosshairs", "위치 이동 이력"]);
  }
  if (sessionHasManagementAccess(session)) {
    links.push(["/admin", "fa-gear", "운영 관리"]);
  }
  const primaryPaths = new Set(["/app", "/documents", "/sets", "/qa", "/admin"]);
  const navigationLinks = links
    .filter(([href]) => primaryPaths.has(href))
    .map(([href, icon, text]) => `<a href="${href}" class="archive-nav-item"><i class="fa-solid ${icon}"></i>${text}</a>`)
    .join("");
  const commandLinks = links.map(([href, icon, text]) => `<a href="${href}" data-command-item data-command-label="${escapeHtml(text)}"><i class="fa-solid ${icon}"></i><span>${escapeHtml(text)}</span></a>`).join("");

  return `
    <header class="topbar">
      <a href="/app" class="brand"><span class="brand-mark"><i class="fa-solid fa-building-columns"></i></span><span><strong>한림문서고</strong><small>통합 문서 위치 검색</small></span></a>
      <button type="button" class="command-trigger" data-command-open aria-haspopup="dialog"><i class="fa-solid fa-magnifying-glass"></i><span>메뉴 찾기</span><kbd>Ctrl+K</kbd></button>
      <button type="button" class="hamburger" aria-label="메뉴 열기" data-hamburger><span></span><span></span><span></span></button>
      <nav aria-label="주 메뉴" data-nav-menu>
        <button type="button" class="drawer-close" data-drawer-close aria-label="메뉴 닫기">×</button>
        ${navigationLinks}
        <div class="nav-user">
          <span class="session-pill">${escapeHtml(session.displayName)} · ${session.role === "Admin" ? "관리자" : "사용자"}</span>
          <a href="/account/password" class="nav-sub-link"><i class="fa-solid fa-key"></i>비밀번호</a>
          <form method="post" action="/logout" class="logout-form">
            <button type="submit" class="logout-link"><i class="fa-solid fa-right-from-bracket"></i>로그아웃</button>
          </form>
        </div>
      </nav>
      <div class="nav-scrim" data-nav-scrim></div>
      <dialog class="command-palette" data-command-palette aria-labelledby="command-title">
        <div class="command-palette-head"><strong id="command-title">메뉴 찾기</strong><button type="button" class="icon-button" data-command-close aria-label="닫기">×</button></div>
        <label class="sr-only" for="command-filter">메뉴 검색</label>
        <input id="command-filter" type="search" placeholder="이동할 메뉴를 입력하세요" autocomplete="off" data-command-input>
        <div class="command-palette-list" data-command-list>${commandLinks}</div>
        <p class="muted">Ctrl+K로 열기 · Esc로 닫기</p>
      </dialog>
    </header>
  `;
}

export function alertDanger(message) {
  return `<div class="alert danger" role="alert" aria-live="assertive">${escapeHtml(message)}</div>`;
}

export function alertWarning(message) {
  return `<div class="alert warning" role="alert">${escapeHtml(message)}</div>`;
}

export function statusBadge(status) {
  return `<span class="status ${status === "active" ? "active" : "disposed"}">${status === "active" ? "보관중" : "폐기"}</span>`;
}

export function sectionHeader(title, count) {
  return `<div class="section-title"><h2>${escapeHtml(title)}</h2><span class="count-badge">${escapeHtml(count)}</span></div>`;
}

export function emptyState(message) {
  return `<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>${escapeHtml(message)}</p></div>`;
}

export function emptyResult(message, query = "") {
  return `
    <div class="empty-state">
      <i class="fa-regular fa-folder-open"></i>
      <p>${escapeHtml(message)}</p>
      ${query ? `<div class="empty-actions"><a class="button secondary sm" href="/documents">전체 문서 보기</a><a class="button secondary sm" href="/app">대분류로 찾기</a></div>` : ""}
    </div>
  `;
}

export function metric(label, value, caption) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small></article>`;
}

export function option(value, label, selected) {
  const sel = String(value) === String(selected ?? "") ? " selected" : "";
  return `<option value="${escapeHtml(String(value))}"${sel}>${escapeHtml(label)}</option>`;
}

export function formValue(values, camelKey, snakeKey) {
  return values?.[camelKey] ?? values?.[snakeKey] ?? "";
}

export function timeline(rows, renderer, emptyMessage) {
  return rows.length ? `<div class="timeline-container">${rows.map(renderer).join("")}</div>` : emptyState(emptyMessage);
}

export function timelineItem(title, meta, body) {
  return `<div class="timeline-item"><div class="timeline-badge"></div><div class="timeline-content"><div class="timeline-header"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta)}</span></div>${body ? `<p>${escapeHtml(body)}</p>` : ""}</div></div>`;
}

// 문서 목록(/documents)과 뷰어 검색 폼(/app)이 같은 검색 필터를 공유한다.
// viewer 변형은 라벨 노출·placeholder 문구·정렬 항목 순서만 다르고 구조는 동일하다.
export function filterSelectRow({ categories, tags, filters, viewer = false }) {
  const label = (text) => (viewer ? text : `<span class="sr-only">${text}</span>`);
  const blank = (text) => (viewer ? "전체" : `전체 ${text}`);
  const sortOptions = (viewer
    ? [["updated", "최신순"], ["location", "위치순"], ["docnum", "문서번호순"], ["category", "대분류순"]]
    : [["updated", "최신순"], ["docnum", "문서번호순"], ["category", "대분류순"], ["location", "랙 위치순"]])
    .map(([value, text]) => option(value, text, filters.sort))
    .join("\n              ");
  return `<div class="${viewer ? "viewer-filter-row" : "filter-row"}">
          <label>${label("대분류")}
            <select name="category">
              <option value="">${blank("대분류")}</option>
              ${categories.map((c) => option(c.id, viewer ? c.name : `${c.name}`, filters.categoryId)).join("")}
            </select>
          </label>
          <label>${label("태그")}
            <select name="tag">
              <option value="">${blank("태그")}</option>
              ${tags.map((tag) => option(tag.id, tag.name, filters.tagId)).join("")}
            </select>
          </label>
          <label>${label("구역")}
            <select name="zone">
              <option value="">${blank("구역")}</option>
              ${[1, 2, 3].map((zone) => option(zone, `${zone}구역`, filters.zoneNumber)).join("")}
            </select>
          </label>
          <label>${label("문서 상태")}
            <select name="status">
              ${option("active", "보관중 문서", filters.status || "active")}
              ${option("disposed", "폐기 문서만", filters.status || "active")}
            </select>
          </label>
          <label>${label("정렬")}
            <select name="sort">
              ${option("relevance", "정확도순", filters.sort || "relevance")}
              ${sortOptions}
            </select>
          </label>
${viewer ? `          <a class="button secondary sm" href="/app">초기화</a>
` : ""}        </div>`;
}

// /app과 /documents 목록이 같은 페이지 내비 마크업을 공유한다(호출부가 URL만 다르게 만든다).
export function paginationNav(page, totalPages, { previousUrl, nextUrl }) {
  return `
    <nav class="pagination" aria-label="검색 결과 페이지">
      <a class="button secondary sm ${page === 1 ? "disabled" : ""}" href="${previousUrl}">이전</a>
      <span>${page} / ${totalPages}</span>
      <a class="button secondary sm ${page === totalPages ? "disabled" : ""}" href="${nextUrl}">다음</a>
    </nav>
  `;
}

// 목록 URL 생성기. paramOrder 배열 순서가 곧 쿼리스트링 파라미터 순서다(기존 URL 형태 유지).
export function listUrl(basePath, { query, filters = {}, page = 1 }, paramOrder) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  for (const [param, key] of paramOrder) {
    if (filters[key]) params.set(param, filters[key]);
  }
  if (page > 1) params.set("page", page);
  const text = params.toString();
  return text ? `${basePath}?${text}` : basePath;
}
