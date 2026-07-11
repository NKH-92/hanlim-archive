// 페이지 골격(page)과 여러 화면이 공유하는 범용 프래그먼트.

import { bytesToBase64Url, escapeHtml } from "../utils.js";
import { htmlContentSecurityPolicy } from "../security.js";
import { clientScript } from "./clientScript.js";
import { styles } from "./styles.js";

export function page(title, body, session, status = 200) {
  const resolvedBody = session?.csrfToken ? withCsrfToken(body, session.csrfToken) : body;
  // 요청별 CSP nonce. 인라인 <script>/<style>에 주입하고 응답 헤더의 script-src와 짝을 맞춘다.
  const nonce = createNonce();

  const html = applyNonce(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - 한림문서고</title>
  <meta name="description" content="한림문서고 문서 검색 및 보관 위치 안내 시스템">
  ${session?.csrfToken ? `<meta name="csrf-token" content="${escapeHtml(session.csrfToken)}">` : ""}
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" integrity="sha384-GIdEBaqGN9mNkDkMkzMHW8EKUqtpPIe/sLj1X7DIrnc9uPtLROJgmuDlh+3rBw0j" crossorigin="anonymous" referrerpolicy="no-referrer">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" integrity="sha384-PPIZEGYM1v8zp5Py7UjFb79S58UeqCL9pYVnVPURKEqvioPROaVAJKKLzvH2rDnI" crossorigin="anonymous" referrerpolicy="no-referrer">
  <style>${styles()}</style>
  <script>${clientScript()}</script>
</head>
<body>
  <a href="#main-content" class="skip-nav">본문 바로가기</a>
  ${session ? header(session) : ""}
  <main id="main-content" class="${session ? "app-shell" : "login-main"}">${resolvedBody}</main>
  ${session ? commandPalette() : ""}
</body>
</html>`, nonce);

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
  const home = session.role === "Admin" ? "/admin" : "/app";
  const adminLinks = [
    ["/admin", "fa-user-shield", "관리자"],
    ["/app", "fa-magnifying-glass", "검색"],
    ["/documents", "fa-file-lines", "문서"],
    ["/sets", "fa-list-check", "세트"],
    ["/racks", "fa-box-archive", "랙"],
    ["/categories", "fa-layer-group", "대분류"],
    ["/tags", "fa-tags", "태그"]
  ];
  const userLinks = [
    ["/app", "fa-magnifying-glass", "검색"],
    ["/documents", "fa-file-lines", "전체 문서"],
    ["/sets", "fa-list-check", "세트"],
    ["/qa", "fa-circle-question", "Q&A"]
  ];
  const links = session.role === "Admin" ? adminLinks : userLinks;

  return `
    <header class="topbar">
      <a href="${home}" class="brand"><span class="brand-mark"><i class="fa-solid fa-building-columns"></i></span><span><strong>한림문서고</strong><small>통합 문서 위치 검색</small></span></a>
      <button type="button" class="hamburger" aria-label="메뉴 열기" data-hamburger><span></span><span></span><span></span></button>
      <nav aria-label="주 메뉴" data-nav-menu>
        <button type="button" class="drawer-close" data-drawer-close aria-label="메뉴 닫기">×</button>
        ${links.map(([href, icon, text]) => `<a href="${href}" class="archive-nav-item"><i class="fa-solid ${icon}"></i>${text}</a>`).join("")}
        <div class="nav-user">
          <span class="session-pill">${escapeHtml(session.displayName)} · ${session.role === "Admin" ? "관리자" : "사용자"}</span>
          <a href="/account/password" class="nav-sub-link"><i class="fa-solid fa-key"></i>비밀번호</a>
          <a href="/logout" class="logout-link"><i class="fa-solid fa-right-from-bracket"></i>로그아웃</a>
        </div>
      </nav>
      <div class="nav-scrim" data-nav-scrim></div>
    </header>
  `;
}

function commandPalette() {
  return `
    <dialog id="command-palette" class="cmd-palette">
      <div class="cmd-palette-content">
        <label class="cmd-search-wrap">
          <i class="fa-solid fa-magnifying-glass cmd-icon"></i>
          <span class="sr-only">명령 또는 문서 검색</span>
          <input type="text" id="cmdSearchInput" placeholder="문서명, 문서번호, 위치 또는 메뉴 검색" autocomplete="off">
        </label>
        <div class="cmd-results" id="cmdResults"></div>
      </div>
    </dialog>
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

// 문서 목록(/documents)과 뷰어 검색 폼(/app)이 같은 필터 select 5종을 공유한다.
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
          <label>${label("상태")}
            <select name="status">
              <option value="">${blank("상태")}</option>
              ${option("active", "보관중", filters.status)}
              ${option("disposed", "폐기", filters.status)}
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
