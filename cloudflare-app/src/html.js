import { bytesToBase64Url, escapeHtml, locationLabel, rackFaceLabel, readBoolean } from "./utils.js";
import { createSearchCore } from "./searchCore.js";
import { htmlContentSecurityPolicy } from "./security.js";

// 서버 렌더 하이라이트와 클라이언트 즉시 검색이 같은 코어를 쓴다.
const searchCore = createSearchCore();

function highlight(text, query) {
  return query ? searchCore.highlightHtml(text, query, escapeHtml) : escapeHtml(text ?? "");
}

// 즉시 검색 페이지에 검색 코어 원본을 그대로 내려보낸다(로직 단일 출처).
// wrangler(esbuild) 번들이 함수 소스에 __name() 헬퍼를 주입하므로 브라우저용 shim을 함께 보낸다.
function searchCoreScript() {
  return `<script>window.__name = window.__name || function (target) { return target; }; window.SearchCore = window.SearchCore || (${createSearchCore.toString()})();</script>`;
}

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

export function loginPage({ returnUrl, error, setupWarning, signupSubmitted }) {
  return page("로그인", `
    <section class="login-shell">
      <div class="login-side">
        <span class="login-logo">HA</span>
        <h1>한림문서고</h1>
        <p>문서 정보와 실제 보관 위치를 한 번에 찾는 전용 검색 시스템입니다.</p>
      </div>
      <div class="login-panel">
        <h2>로그인</h2>
        ${setupWarning ? alertWarning(setupWarning) : ""}
        ${error ? alertDanger(error === "locked"
          ? "로그인 실패가 반복되어 이 계정은 잠시 잠금되었습니다. 10분 후 다시 시도하세요."
          : "아이디 또는 비밀번호가 올바르지 않습니다.") : ""}
        ${signupSubmitted ? `<div class="alert success" role="alert">가입 요청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.</div>` : ""}
        <form method="post" action="/login" class="stack">
          <input type="hidden" name="returnUrl" value="${escapeHtml(returnUrl)}">
          <label>아이디<input name="username" autocomplete="username" required></label>
          <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit" class="primary">로그인</button>
        </form>
        <p class="muted form-foot"><a href="/signup">계정이 없으면 가입 요청</a></p>
      </div>
    </section>
  `, null);
}

export function signupPage({ values = {}, error = "" }) {
  return page("가입 요청", `
    <section class="login-shell">
      <div class="login-side">
        <span class="login-logo">HA</span>
        <h1>한림문서고</h1>
        <p>관리자 승인 후 문서 검색과 위치 조회를 이용할 수 있습니다.</p>
      </div>
      <div class="login-panel">
        <h2>가입 요청</h2>
        ${error ? alertDanger(error) : ""}
        <form method="post" action="/signup" class="stack">
          <label>아이디<input name="username" value="${escapeHtml(values.username)}" autocomplete="username" required></label>
          <label>이름<input name="displayName" value="${escapeHtml(values.displayName)}" required></label>
          <label>비밀번호<input name="password" type="password" autocomplete="new-password" required></label>
          <button type="submit" class="primary">가입 요청</button>
        </form>
        <p class="muted form-foot"><a href="/login">로그인으로 돌아가기</a></p>
      </div>
    </section>
  `, null);
}

export function dashboardPage({
  session,
  query,
  racks = [],
  viewerSearch = { items: [], pagination: { totalItems: 0, totalPages: 1, page: 1, pageSize: 12 }, facets: {}, suggestions: [] },
  floorPlan = [],
  categories = [],
  tags = [],
  filters = {},
  parsedQuery = null,
  didYouMean = [],
  mode = "results"
}) {
  const viewerContext = JSON.stringify({
    categories: categories.map((item) => ({ id: Number(item.id), name: String(item.name || "") })),
    tags: tags.map((item) => ({ id: Number(item.id), name: String(item.name || "") }))
  }).replace(/</g, "\\u003c");

  // 홈 모드: 검색창 + 문서고 도면. 즉시 검색 결과가 뜨면 도면 위 해당 랙이 파랗게 강조된다.
  if (mode === "home") {
    const isAdmin = session.role === "Admin";
    const totalRacks = floorPlan.reduce((sum, region) => sum + region.racks.length, 0);
    return page("문서 검색", `
      <section class="search-home" data-search-home>
        <div class="search-home-hero">
          <span class="search-home-mark"><i class="fa-solid fa-building-columns"></i></span>
          <h1 id="viewer-title">한림문서고</h1>
          <p class="search-home-sub">문서명, 문서번호, 초성, 위치 단서를 입력하면 보관 위치를 바로 찾아드립니다.</p>
        </div>
        ${viewerSearchForm({ query: "", suggestions: [], categories, tags, filters, home: true })}
        <div class="quick-row viewer-recents" data-recent-searches></div>

        <section class="viewer-workspace is-home" data-viewer-app hidden>
          <article class="panel results-panel" aria-labelledby="viewer-results-title" data-viewer-results aria-live="polite">
            <div class="section-title">
              <h2 id="viewer-results-title" data-results-title>검색 결과</h2>
              <span class="count-badge" data-results-count>0건</span>
            </div>
            <div data-results-body></div>
          </article>
        </section>

        ${floorPlan.length ? `
        <section class="panel home-floor-plan" aria-labelledby="home-floor-plan-title">
          <div class="section-title"><h2 id="home-floor-plan-title">문서고 도면</h2><span class="count-badge">${totalRacks}개 랙</span></div>
          ${floorPlanView(floorPlan, new Set())}
        </section>` : ""}

        <div class="search-home-extras" data-home-extras>
          <nav class="search-home-links" aria-label="바로가기">
            <a href="/documents"><i class="fa-solid fa-file-lines"></i>전체 문서</a>
            <a href="/sets"><i class="fa-solid fa-list-check"></i>문서 세트</a>
            ${isAdmin
              ? `<a href="/racks"><i class="fa-solid fa-box-archive"></i>랙 목록</a><a href="/admin/search-report"><i class="fa-solid fa-chart-simple"></i>검색 리포트</a>`
              : `<a href="/qa"><i class="fa-solid fa-circle-question"></i>Q&amp;A</a>`}
          </nav>
        </div>
      </section>
      <script type="application/json" data-viewer-context>${viewerContext}</script>
      ${searchCoreScript()}
    `, session);
  }

  // 검색 모드: 정답 카드 + 결과 리스트 + 위치 도면.
  const documents = viewerSearch.items || [];
  const suggestions = viewerSearch.suggestions || [];
  const hits = new Set(documents.map((document) => document.location?.rackCode).filter(Boolean));
  const totalItems = Number(viewerSearch.pagination?.totalItems || 0);
  const answer = query && (filters.sort || "relevance") === "relevance" ? pickDominantAnswer(documents, query) : null;
  const rest = answer ? documents.filter((item) => item.id !== answer.id) : documents;

  return page("문서 검색", `
    <section class="panel search-band" aria-labelledby="viewer-title">
      <h1 id="viewer-title">문서 위치 검색</h1>
      ${viewerSearchForm({ query, suggestions, categories, tags, filters })}
      ${parsedChipRow(parsedQuery, query)}
      <div class="quick-row viewer-recents" data-recent-searches></div>
    </section>

    <section class="viewer-workspace" data-viewer-app>
      <article class="panel results-panel" aria-labelledby="viewer-results-title" data-viewer-results aria-live="polite">
        <div class="section-title">
          <h2 id="viewer-results-title" data-results-title>${query ? `"${escapeHtml(query)}" 검색 결과` : "최근 등록·수정 문서"}</h2>
          <span class="count-badge" data-results-count>${totalItems}건</span>
        </div>
        <div data-results-body>
          ${answer ? answerCard(answer, query, dominantGrade(answer, documents, query)) : ""}
          ${answer && rest.length ? `<p class="rest-label">다른 결과 ${totalItems - 1}건</p>` : ""}
          ${answer && !rest.length ? "" : viewerDocumentResults(rest, query)}
          ${!documents.length && didYouMean.length ? didYouMeanView(didYouMean) : ""}
          ${viewerPagination(viewerSearch.pagination, { query, filters })}
        </div>
      </article>

      <aside class="panel viewer-location-panel" aria-labelledby="viewer-location-title" data-viewer-map>
        <div class="section-title">
          <h2 id="viewer-location-title">문서고 도면</h2>
          ${session.role === "Admin" ? `<a class="button secondary sm" href="/racks">랙 목록</a>` : ""}
        </div>
        ${floorPlanView(floorPlan, hits)}
      </aside>
    </section>
    <script type="application/json" data-viewer-context>${viewerContext}</script>
    ${searchCoreScript()}
  `, session);
}

// 정답 판정: 문서번호/보관코드 정확 일치는 무조건, 그 외엔 1위가 2위의 1.5배 이상일 때.
function pickDominantAnswer(items, query = "") {
  if (!items.length) return null;
  const first = items[0];
  if (!Number(first.relevanceScore || 0)) return null;
  const compactQuery = searchCore.compactSearchText(query);
  if (compactQuery && [first.documentNumber, first.storageCode].some(
    (value) => value && searchCore.compactSearchText(value) === compactQuery
  )) {
    return first;
  }
  if (items.length === 1) return first;
  const second = Number(items[1].relevanceScore || 0);
  return Number(first.relevanceScore) >= second * 1.5 ? first : null;
}

// 확신 등급: 문서번호·보관코드 정확 일치는 '확실'(초록), 관련도 우위로 뽑힌 답은 '유력·확인 권장'(노랑).
// 애매한 답이 확실한 답처럼 보이는 거짓 확신을 없앤다.
function dominantGrade(item, items, query) {
  const compactQuery = searchCore.compactSearchText(query);
  const exact = compactQuery && [item.documentNumber, item.storageCode].some(
    (value) => value && searchCore.compactSearchText(value) === compactQuery
  );
  return exact ? "certain" : "likely";
}

function answerGradeChip(grade) {
  return grade === "certain"
    ? `<span class="answer-grade certain">확실</span>`
    : `<span class="answer-grade likely">유력 · 확인 권장</span>`;
}

function answerCard(item, query, grade = "likely") {
  const location = item.location || {};
  const slot = [
    location.columnNumber ? `${location.columnNumber}열` : "",
    location.shelfNumber ? `${location.shelfNumber}선반` : ""
  ].filter(Boolean).join(" ");
  return `
    <section class="answer-card" data-answer-card>
      <div class="answer-head"><small class="answer-label">가장 정확한 결과</small>${answerGradeChip(grade)}</div>
      <div class="answer-loc">
        ${location.zoneNumber ? `${location.zoneNumber}구역 ` : ""}${location.rackLabel ? `${escapeHtml(location.rackLabel)}번 랙` : escapeHtml(location.rackCode || "")}
        ${slot ? `<span>${slot}</span>` : ""}
      </div>
      <div class="answer-doc">
        <a href="/documents/${item.id}" data-doc-click="${item.id}">${highlight(item.documentName || "문서명 없음", query)}</a>
        ${item.status !== "active" ? statusBadge(item.status) : ""}
        <div class="answer-meta">
          <span class="mono">${highlight(item.documentNumber, query)}</span>
          <span>${escapeHtml(item.revisionNumber)}</span>
          <span>${escapeHtml(item.categoryName || "-")}</span>
        </div>
      </div>
      <div class="answer-actions">
        <a class="button" href="/documents/${item.id}" data-doc-click="${item.id}"><i class="fa-solid fa-circle-info"></i>상세 정보</a>
        <button type="button" class="button secondary" data-copy-text="${escapeHtml(location.label || "")}">위치 복사</button>
      </div>
    </section>
  `;
}

// "2구역 PV"처럼 해석된 검색어를 칩으로 보여주고 클릭으로 해제한다.
function parsedChipRow(parsedQuery, query) {
  const chips = parsedQuery?.chips || [];
  if (!chips.length) return "";
  const typeLabels = { zone: "구역", category: "대분류", tag: "태그", status: "상태" };
  return `
    <div class="parsed-chip-row" aria-label="검색어에서 인식한 조건">
      <span>자동 적용</span>
      ${chips.map((chip) => {
        const remaining = String(query).split(/\s+/).filter((part) => part !== chip.token).join(" ");
        return `<a class="chip active" href="/app?q=${encodeURIComponent(remaining)}" title="조건 해제">${escapeHtml(typeLabels[chip.type] || chip.type)}: ${escapeHtml(chip.label)} ×</a>`;
      }).join("")}
    </div>
  `;
}

function didYouMeanView(candidates) {
  return `
    <div class="didyoumean" data-didyoumean>
      <p>혹시 이 문서를 찾으셨나요?</p>
      ${candidates.map((doc) => `
        <a href="/documents/${doc.id}">
          <strong>${escapeHtml(doc.document_name)}</strong>
          <span class="mono">${escapeHtml(doc.document_number)}</span>
          <small>${escapeHtml(locationLabel(doc))}</small>
        </a>
      `).join("")}
    </div>
  `;
}

export function documentsPage({
  session,
  query,
  parsedQuery = null,
  documents,
  categories = [],
  tags = [],
  filters = {},
  suggestions = [],
  didYouMean = [],
  pagination = { page: 1, pageSize: 30, totalDocuments: documents.length, totalPages: 1 }
}) {
  return page("문서 검색", `
    <section class="page-head">
      <h1>전체 문서</h1>
      ${documentToolbar(session)}
    </section>

    <section class="panel search-panel">
      <form method="get" action="/documents" class="filter-bar" id="documentFilterForm" data-search-form data-auto-submit>
        ${searchInputBlock(query, suggestions)}
        <div class="filter-row">
          <label><span class="sr-only">대분류</span>
            <select name="category">
              <option value="">전체 대분류</option>
              ${categories.map((c) => option(c.id, `${c.name}`, filters.categoryId)).join("")}
            </select>
          </label>
          <label><span class="sr-only">태그</span>
            <select name="tag">
              <option value="">전체 태그</option>
              ${tags.map((tag) => option(tag.id, tag.name, filters.tagId)).join("")}
            </select>
          </label>
          <label><span class="sr-only">구역</span>
            <select name="zone">
              <option value="">전체 구역</option>
              ${[1, 2, 3].map((zone) => option(zone, `${zone}구역`, filters.zoneNumber)).join("")}
            </select>
          </label>
          <label><span class="sr-only">상태</span>
            <select name="status">
              <option value="">전체 상태</option>
              ${option("active", "보관중", filters.status)}
              ${option("disposed", "폐기", filters.status)}
            </select>
          </label>
          <label><span class="sr-only">정렬</span>
            <select name="sort">
              ${option("relevance", "정확도순", filters.sort || "relevance")}
              ${option("updated", "최신순", filters.sort)}
              ${option("docnum", "문서번호순", filters.sort)}
              ${option("category", "대분류순", filters.sort)}
              ${option("location", "랙 위치순", filters.sort)}
            </select>
          </label>
        </div>
      </form>
    </section>

    ${parsedChipRow(parsedQuery, query) ? `<section class="panel chip-panel">${parsedChipRow(parsedQuery, query)}</section>` : ""}

    <section class="panel results-panel">
      <div class="section-title">
        <h2>${query ? `"${escapeHtml(query)}" 검색 결과` : "전체 보유문서"}</h2>
        <span class="count-badge">${pagination.totalDocuments}건</span>
      </div>
      ${documentResults(documents, { bulk: session.role === "Admin", emptyQuery: query, showScore: Boolean(query), query })}
      ${!documents.length && didYouMean.length ? didYouMeanView(didYouMean) : ""}
      ${paginationView(pagination, { query, filters })}
      ${session.role === "Admin" ? bulkActionBar() : ""}
    </section>
  `, session);
}

export function qaPage({ session }) {
  return page("Q&A", `
    <section class="page-head">
      <h1>Q&amp;A</h1>
      <a class="button secondary" href="mailto:nkh92@hanlim.com">담당자 문의</a>
    </section>
    <section class="content-grid">
      <article class="panel">
        <h2>검색 방법</h2>
        <ul class="manual-list">
          <li><strong>문서번호 일부</strong><span>예: PV-2026 대신 2026 또는 PV만 입력해도 검색합니다.</span></li>
          <li><strong>문서명 키워드</strong><span>띄어쓰기와 일부 오타를 허용해 유사한 문서를 우선 보여줍니다.</span></li>
          <li><strong>위치 검색</strong><span>1구역, 2번 랙, 1-01처럼 보관 위치 단서로도 찾을 수 있습니다.</span></li>
        </ul>
      </article>
      <article class="panel">
        <h2>담당자</h2>
        <dl class="contact-list">
          <div><dt>부서 / 이름</dt><dd>SQA팀 담당자</dd></div>
          <div><dt>이메일</dt><dd><a href="mailto:nkh92@hanlim.com">nkh92@hanlim.com</a></dd></div>
        </dl>
      </article>
    </section>
  `, session);
}

export function adminDashboardPage({ session, pendingCount, quality = null }) {
  return page("관리자", `
    <section class="page-head">
      <h1>문서고 운영 관리</h1>
    </section>
    ${quality ? dataQualityPanel(quality) : ""}
    <section class="admin-grid">
      <a class="panel admin-tile" href="/admin/settings"><small>가입 요청</small><strong>${pendingCount}건 대기</strong></a>
      <a class="panel admin-tile" href="/documents"><small>문서 관리</small><strong>검색 / 수정 / 폐기</strong></a>
      <a class="panel admin-tile" href="/admin/search-report"><small>검색 리포트</small><strong>자주 찾는 / 실패 검색어</strong></a>
      <a class="panel admin-tile" href="/documents/import"><small>CSV</small><strong>대량 등록 / 내보내기</strong></a>
      <a class="panel admin-tile" href="/racks/configure"><small>랙 설정</small><strong>구역별 랙 수 조정</strong></a>
      <a class="panel admin-tile" href="/categories"><small>분류</small><strong>대분류 관리</strong></a>
      <a class="panel admin-tile" href="/tags"><small>태그</small><strong>검색 보조 키워드 관리</strong></a>
    </section>
  `, session);
}

export function adminSettingsPage({ session, users }) {
  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");
  const rejected = users.filter((u) => u.status === "rejected");
  return page("관리자 설정", `
    <section class="page-head"><h1>사용자 승인 관리</h1></section>
    <section class="panel">${sectionHeader("가입 요청", `${pending.length}건`)}${pending.length ? userRequestTable(pending) : emptyState("대기 중인 가입 요청이 없습니다.")}</section>
    <section class="two-col">
      <article class="panel">${sectionHeader("승인된 사용자", `${approved.length}명`)}${approved.length ? userRequestTable(approved) : emptyState("승인된 사용자가 없습니다.")}</article>
      <article class="panel">${sectionHeader("반려된 요청", `${rejected.length}건`)}${rejected.length ? userRequestTable(rejected) : emptyState("반려된 요청이 없습니다.")}</article>
    </section>
  `, session);
}

export function documentFormPage({ session, title, action, values = {}, categories, tags, slots, selectedTags = [], error = "", showLocation = true }) {
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        ${formValue(values, "updatedAt", "updated_at") ? `<input type="hidden" name="expectedUpdatedAt" value="${escapeHtml(formValue(values, "updatedAt", "updated_at"))}">` : ""}
        <label>문서번호 <em>*</em><input name="documentNumber" value="${escapeHtml(formValue(values, "documentNumber", "document_number"))}" required></label>
        <label>개정번호 <em>*</em><input name="revisionNumber" value="${escapeHtml(formValue(values, "revisionNumber", "revision_number") || "Rev.0")}" required></label>
        <label>문서명 <em>*</em><input name="documentName" value="${escapeHtml(formValue(values, "documentName", "document_name"))}" required></label>
        <label>대분류 <em>*</em><select name="categoryId" required>${categories.map((c) => option(c.id, c.name, formValue(values, "categoryId", "category_id"))).join("")}</select></label>
        ${showLocation ? `${locationPicker(slots, formValue(values, "rackSlotId", "rack_slot_id"))}
        <label>보관 면 <em>*</em><select name="rackFace" required data-rack-face>${option("A", "1면", formValue(values, "rackFace", "rack_face") || "A")}${option("B", "2면", formValue(values, "rackFace", "rack_face"))}</select></label>
        <p class="muted" data-face-hint>양면 랙은 13-1(1면)/13-2(2면)처럼 면 단위로 표기합니다. 단면 랙은 면 구분이 없습니다.</p>` : ""}
        <fieldset class="check-grid">
          <legend>태그</legend>
          ${tags.map((tag) => `<label class="check-item"><input type="checkbox" name="tagIds" value="${tag.id}" ${selectedTags.includes(tag.id) ? "checked" : ""}><span>${escapeHtml(tag.name)}</span></label>`).join("")}
        </fieldset>
        <label>비고<textarea name="note" rows="3">${escapeHtml(formValue(values, "note", "note"))}</textarea></label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
    ${showLocation ? locationPickerScript() : ""}
  `, session);
}

// 위치 입력 편의 스크립트. 서버 검증(validateDocumentInput)이 최종 방어선이다.
// 1) 랙당 42칸이 되면서 길어진 단일 목록 대신 랙 → 열 → 선반 3단으로 고른다(JS 미지원 시 원래 목록 사용).
// 2) 선택된 랙에 맞춰 면 선택지를 실물 표기(13-1/13-2)로 바꾸고, 단면 랙이면 2면을 잠근다.
function locationPickerScript() {
  return `
    <script>
      (function () {
        var slotSelect = document.querySelector('select[name="rackSlotId"]');
        var faceSelect = document.querySelector('select[data-rack-face]');
        if (!slotSelect) return;

        var faceA = faceSelect ? faceSelect.querySelector('option[value="A"]') : null;
        var faceB = faceSelect ? faceSelect.querySelector('option[value="B"]') : null;
        var syncFace = function () {
          if (!faceSelect) return;
          var opt = slotSelect.options[slotSelect.selectedIndex];
          var rackNumber = opt ? opt.getAttribute('data-rack-number') || '' : '';
          var single = opt ? opt.getAttribute('data-single-sided') === '1' : false;
          if (single) {
            faceSelect.value = 'A';
            faceB.disabled = true;
            faceA.textContent = rackNumber ? rackNumber + ' (단면 · 면 구분 없음)' : '단면 · 면 구분 없음';
            faceB.textContent = '단면 랙 · 2면 없음';
          } else {
            faceB.disabled = false;
            faceA.textContent = rackNumber ? rackNumber + '-1 (1면)' : '1면';
            faceB.textContent = rackNumber ? rackNumber + '-2 (2면)' : '2면';
          }
        };
        slotSelect.addEventListener('change', syncFace);

        var slotOptions = Array.prototype.slice.call(slotSelect.options).filter(function (o) { return o.value; });
        var racks = [];
        var rackByKey = {};
        slotOptions.forEach(function (o) {
          var key = o.getAttribute('data-zone') + ':' + o.getAttribute('data-rack-number');
          var rack = rackByKey[key];
          if (!rack) {
            rack = {
              key: key,
              zone: o.getAttribute('data-zone'),
              rackNumber: o.getAttribute('data-rack-number'),
              single: o.getAttribute('data-single-sided') === '1',
              columns: {},
              shelves: {},
              slots: {}
            };
            rackByKey[key] = rack;
            racks.push(rack);
          }
          var column = o.getAttribute('data-column');
          var shelf = o.getAttribute('data-shelf');
          rack.columns[column] = true;
          rack.shelves[shelf] = true;
          rack.slots[column + ':' + shelf] = o.value;
        });
        if (!racks.length) { syncFace(); return; }

        var numericKeys = function (map) {
          return Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
        };
        var fillSelect = function (select, placeholder, items, toLabel, selectedValue) {
          select.innerHTML = '';
          var blank = document.createElement('option');
          blank.value = '';
          blank.textContent = placeholder;
          select.appendChild(blank);
          items.forEach(function (item) {
            var option = document.createElement('option');
            option.value = String(item);
            option.textContent = toLabel(item);
            if (String(item) === String(selectedValue)) option.selected = true;
            select.appendChild(option);
          });
        };

        var row = document.createElement('div');
        row.className = 'picker-row';
        var rackSel = document.createElement('select');
        var colSel = document.createElement('select');
        var shelfSel = document.createElement('select');
        [rackSel, colSel, shelfSel].forEach(function (select) {
          select.required = true;
          row.appendChild(select);
        });

        var currentRack = function () { return rackByKey[rackSel.value] || null; };
        var refreshCells = function (selectedColumn, selectedShelf) {
          var rack = currentRack();
          colSel.disabled = shelfSel.disabled = !rack;
          fillSelect(colSel, '열 선택', rack ? numericKeys(rack.columns) : [], function (n) { return n + '열 (왼쪽에서)'; }, selectedColumn);
          fillSelect(shelfSel, '선반 선택', rack ? numericKeys(rack.shelves) : [], function (n) { return n + '선반 (아래에서)'; }, selectedShelf);
        };
        var apply = function () {
          var rack = currentRack();
          var slotId = rack && colSel.value && shelfSel.value ? rack.slots[colSel.value + ':' + shelfSel.value] || '' : '';
          slotSelect.value = slotId;
          syncFace();
        };

        fillSelect(rackSel, '랙 선택', racks.map(function (rack) { return rack.key; }), function (key) {
          var rack = rackByKey[key];
          return rack.zone + '구역 ' + rack.rackNumber + '번 랙 · ' + (rack.single ? '단면' : '양면 ' + rack.rackNumber + '-1/' + rack.rackNumber + '-2');
        }, '');

        var initial = slotSelect.options[slotSelect.selectedIndex];
        if (initial && initial.value) {
          rackSel.value = initial.getAttribute('data-zone') + ':' + initial.getAttribute('data-rack-number');
          refreshCells(initial.getAttribute('data-column'), initial.getAttribute('data-shelf'));
        } else {
          refreshCells('', '');
        }

        rackSel.addEventListener('change', function () { refreshCells('', ''); apply(); });
        colSel.addEventListener('change', apply);
        shelfSel.addEventListener('change', apply);

        // 원래 목록은 값 운반용으로만 남긴다. required를 3단 선택 쪽으로 옮겨
        // 숨긴 select가 브라우저 필수 검증(포커스 불가 오류)에 걸리지 않게 한다.
        slotSelect.required = false;
        slotSelect.style.display = 'none';
        slotSelect.insertAdjacentElement('afterend', row);
        syncFace();
      })();
    </script>
  `;
}

export function documentDetailsPage({ session, document, tags, disposalLogs, auditLogs, floorPlan = [] }) {
  const isAdmin = session.role === "Admin";
  return page(document.document_name, `
    <section class="page-head">
      <div>
        <nav class="breadcrumb" aria-label="경로"><a href="/app">홈</a><span>/</span><a href="/documents">문서 검색</a><span>/</span><span>상세</span></nav>
        <h1>${escapeHtml(document.document_name)}</h1>
      </div>
      <div class="head-actions">
        ${statusBadge(document.status)}
        ${isAdmin ? documentActions(document) : ""}
      </div>
    </section>
    <section class="locator-hero">
      <div>
        <small>보관 위치</small>
        <strong class="loc-label-lg">${escapeHtml(locationLabel(document))}</strong>
        <span class="mono">${escapeHtml(document.rack_code)} · ${escapeHtml(document.storage_code)}</span>
      </div>
      <div class="button-group">
        <button type="button" class="button secondary sm" data-copy-text="${escapeHtml(locationLabel(document))}">위치 복사</button>
        <a class="button secondary sm" href="/documents?q=${encodeURIComponent(document.rack_code)}">같은 랙 문서 보기</a>
      </div>
    </section>
    <div class="tab-nav" role="tablist" aria-label="문서 상세 정보">
      <button role="tab" aria-selected="true" data-tab="info" id="tab-info" aria-controls="panel-info">기본 정보</button>
      <button role="tab" aria-selected="false" data-tab="audit" id="tab-audit" aria-controls="panel-audit">감사 이력 <span class="tab-count">${auditLogs.length}</span></button>
      <button role="tab" aria-selected="false" data-tab="disposal" id="tab-disposal" aria-controls="panel-disposal">폐기 이력 <span class="tab-count">${disposalLogs.length}</span></button>
    </div>
    <div class="tab-panel" id="panel-info" role="tabpanel" aria-labelledby="tab-info">
      <section class="panel detail-grid">
        ${detail("문서번호", document.document_number)}
        ${detail("개정번호", document.revision_number)}
        ${detail("보관코드", document.storage_code)}
        ${detail("대분류", document.category_name)}
        ${detail("태그", tags.length ? tags.map((t) => t.name).join(", ") : "-")}
        ${detail("상태", document.status === "active" ? "보관중" : "폐기")}
        ${detail("비고", document.note || "-")}
      </section>
      ${renderDocumentFloorPlan(document, floorPlan)}
      ${renderMiniVisualizer(document)}
    </div>
    <div class="tab-panel" id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden><section class="panel">${timeline(auditLogs, renderAuditLog, "감사 이력이 없습니다.")}</section></div>
    <div class="tab-panel" id="panel-disposal" role="tabpanel" aria-labelledby="tab-disposal" hidden><section class="panel">${timeline(disposalLogs, renderDisposalLog, "폐기 이력이 없습니다.")}</section></div>
    ${isAdmin && document.status === "active" ? disposeModal(document) : ""}
    ${isAdmin && document.status !== "active" ? deleteModal(document) : ""}
  `, session);
}

export function documentImportPage({ session, result = null, error = "" }) {
  return page("CSV 가져오기", `
    <section class="page-head">
      <h1>문서 대량 등록</h1>
      <a class="button secondary" href="/documents/export.csv">CSV 내보내기</a>
    </section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      ${result ? importResult(result) : ""}
      <form method="post" action="/documents/import" class="stack" enctype="multipart/form-data">
        <label>CSV 파일<input type="file" name="csvFile" accept=".csv,text/csv"></label>
        <label>또는 CSV 붙여넣기<textarea name="csvText" rows="10" placeholder="documentNumber,revisionNumber,documentName,category,rackCode,rackColumn,shelfNumber,rackFace,tags,note,status"></textarea></label>
        <button type="submit" class="primary">가져오기</button>
      </form>
      <p class="muted">필수 열: documentNumber, revisionNumber, documentName, category, rackCode, rackColumn, shelfNumber, rackFace</p>
      <p class="muted">rackFace는 1 또는 2로 적습니다(예: 13번 양면 랙 = 13-1/13-2, 구표기 A/B도 허용). 단면 랙은 1만 가능합니다. rackColumn은 1~7열, shelfNumber는 1~6선반입니다.</p>
    </section>
  `, session);
}

export function racksPage({ session, racks }) {
  return page("랙 관리", `
    <section class="page-head"><h1>보관 랙 목록</h1><div class="button-group"><a class="button secondary" href="/racks/configure">구역별 설정</a><a class="button" href="/racks/new">랙 추가</a></div></section>
    <section class="rack-grid">
      ${racks.map((rack) => `
        <a class="panel rack-card" href="/racks/${rack.id}">
          <small>${rack.zone_number}구역</small>
          <strong>${rack.rack_number}번 랙</strong>
          <span>${escapeHtml(rack.code)} · ${readBoolean(rack.is_single_sided) ? "단면" : `양면 ${rack.rack_number}-1·${rack.rack_number}-2`} · ${rack.active_document_count || 0}건</span>
        </a>
      `).join("")}
    </section>
  `, session);
}

export function rackConfigurePage({ session, counts, error = "" }) {
  return page("랙 설정", `
    <section class="page-head"><h1>구역별 랙 수</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/racks/configure" class="stack">
        ${[1, 2, 3].map((zone) => `<label>${zone}구역 랙 수<input type="number" name="zone${zone}Count" min="0" max="15" value="${escapeHtml(counts[zone] ?? 0)}"></label>`).join("")}
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}

export function rackDetailsPage({ session, rack, documents }) {
  return page(`${rack.code} 랙`, `
    <section class="page-head">
      <h1>${rack.zone_number}구역 ${rack.rack_number}번 랙</h1>
      <a class="button" href="/racks/${rack.id}/edit">랙 수정</a>
    </section>
    <section class="locator-hero">
      <div><strong class="mono">${escapeHtml(rack.code)}</strong><span>${readBoolean(rack.is_single_sided) ? `단면 ${rack.rack_number}` : `양면 ${rack.rack_number}-1 / ${rack.rack_number}-2`} · 면당 ${rack.column_count || 7}열 × ${rack.shelf_count || 6}선반 = ${(rack.column_count || 7) * (rack.shelf_count || 6)}칸 · 문서 ${documents.length}건</span></div>
      <a class="button secondary" href="/documents?zone=${rack.zone_number}&sort=location">구역 문서 보기</a>
    </section>
    <section class="panel">${documentResults(documents, { emptyMessage: "이 랙에 등록된 문서가 없습니다." })}</section>
  `, session);
}

export function rackFormPage({ session, values = {}, action, title, error = "" }) {
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        <label>구역<input type="number" name="zoneNumber" min="1" max="3" value="${escapeHtml(values.zone_number ?? values.zoneNumber ?? 1)}" required></label>
        <label>랙 번호<input type="number" name="rackNumber" min="1" max="15" value="${escapeHtml(values.rack_number ?? values.rackNumber ?? 1)}" required></label>
        <p class="muted">랙 구조는 면당 7열 × 6선반(42칸)으로 고정되어 있습니다.</p>
        <label>이름<input name="name" value="${escapeHtml(values.name || "")}"></label>
        <label>설명<textarea name="description" rows="3">${escapeHtml(values.description || "")}</textarea></label>
        <label class="check-inline"><input type="checkbox" name="isSingleSided" value="1" ${readBoolean(values.is_single_sided ?? values.isSingleSided) ? "checked" : ""}> 단면 랙</label>
        <p class="muted">양면 랙은 13-1/13-2처럼 면 단위로, 단면 랙은 13처럼 번호만으로 표기됩니다.</p>
        <label class="check-inline"><input type="checkbox" name="isActive" value="1" ${readBoolean(values.is_active ?? values.isActive ?? 1) ? "checked" : ""}> 사용</label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}

export function setsPage({ session, sets }) {
  const isAdmin = session.role === "Admin";
  return page("문서 세트", `
    <section class="page-head">
      <h1>문서 세트</h1>
      <div class="button-group">
        ${isAdmin ? `<a class="button" href="/sets/new">세트 만들기</a>` : ""}
      </div>
    </section>
    <p class="muted">감사 준비문서 목록처럼 자주 찾는 문서 묶음을 저장해 두고 한눈에 관리합니다.</p>
    ${sets.length ? `<section class="rack-grid">
      ${sets.map((set) => `
        <a class="panel rack-card" href="/sets/${set.id}">
          <small>문서 ${Number(set.document_count || 0)}건${Number(set.disposed_count || 0) ? ` · 폐기 ${Number(set.disposed_count)}건 포함` : ""}</small>
          <strong>${escapeHtml(set.name)}</strong>
          <span>${escapeHtml(set.description || "설명 없음")}</span>
        </a>
      `).join("")}
    </section>` : emptyState(isAdmin ? "아직 세트가 없습니다. 세트를 만들고 준비문서를 등록하세요." : "아직 등록된 세트가 없습니다.")}
  `, session);
}

export function setFormPage({ session, values = {}, action, title, error = "" }) {
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        <label>세트 이름 <em>*</em><input name="name" value="${escapeHtml(values.name || "")}" maxlength="100" required placeholder="예: 2026년 정기감사 준비문서"></label>
        <label>설명<textarea name="description" rows="3" placeholder="세트 용도나 기준을 기록해 두세요.">${escapeHtml(values.description || "")}</textarea></label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}

export function setDetailsPage({ session, set, documents, racks, logs = [], addQuery = "", addCandidates = null, addResult = null, error = "" }) {
  const isAdmin = session.role === "Admin";
  const disposedCount = documents.filter((doc) => doc.status !== "active").length;
  const rackCount = new Set(documents.map((doc) => doc.rack_code)).size;
  const zoneCount = new Set(documents.map((doc) => doc.zone_number)).size;
  const hits = new Set(documents.map((doc) => `${doc.rack_code}:${doc.rack_face}`));

  return page(`${set.name} 세트`, `
    <section class="page-head">
      <div><h1>${escapeHtml(set.name)}</h1>${set.description ? `<p class="page-sub">${escapeHtml(set.description)}</p>` : ""}</div>
      <div class="button-group">
        <button type="button" class="button secondary" data-print><i class="fa-solid fa-print"></i> 목록 인쇄</button>
        ${isAdmin ? `<a class="button secondary" href="/sets/${set.id}/edit">세트 수정</a>` : ""}
      </div>
    </section>
    ${error ? alertDanger(error) : ""}
    ${addResult ? setAddResultView(addResult) : ""}
    <section class="metric-strip" aria-label="세트 요약">
      ${metric("문서", documents.length, "세트에 등록된 문서")}
      ${metric("보관 랙", rackCount, `${zoneCount}개 구역`)}
      ${metric("폐기 포함", disposedCount, disposedCount ? "목록 확인 필요" : "없음")}
    </section>
    <section class="panel">
      ${sectionHeader("보관 위치 목록", `${documents.length}건`)}
      ${documents.length ? `<p class="muted">구역 → 랙 → 열 → 선반 순으로 정렬되어 있어 문서고에서 한 번에 돌며 꺼낼 수 있습니다.</p>` : ""}
      ${setDocumentTable(set, documents, isAdmin)}
    </section>
    ${documents.length ? `<section class="panel">
      ${sectionHeader("랙 지도", `${rackCount}개 랙`)}
      ${archiveMap(racks, hits)}
    </section>` : ""}
    ${isAdmin ? setAdminTools(set, addQuery, addCandidates) : ""}
    ${logs.length ? `<section class="panel">
      ${sectionHeader("세트 변경 이력", `${logs.length}건`)}
      ${timeline(logs, renderSetLog, "변경 이력이 없습니다.")}
    </section>` : ""}
  `, session);
}

function renderSetLog(log) {
  const labels = { create: "세트 생성", update: "정보 수정", delete: "세트 삭제", add: "문서 추가", remove: "문서 제외" };
  return timelineItem(labels[log.action] || log.action, `${log.actor} / ${log.created_at}`, log.details || "");
}

function setDocumentTable(set, documents, isAdmin) {
  if (!documents.length) {
    return emptyState(isAdmin ? "아직 세트에 담긴 문서가 없습니다. 아래에서 문서를 추가하세요." : "아직 세트에 담긴 문서가 없습니다.");
  }

  return `
    <div class="table-wrap"><table class="set-doc-table">
      <caption class="sr-only">${escapeHtml(set.name)} 세트 문서 위치 목록</caption>
      <thead><tr><th>순번</th><th>보관 위치</th><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>상태</th>${isAdmin ? "<th>관리</th>" : ""}</tr></thead>
      <tbody>${documents.map((doc, index) => `
        <tr class="${doc.status !== "active" ? "is-disposed" : ""}">
          <td>${index + 1}</td>
          <td><strong>${escapeHtml(locationLabel(doc))}</strong></td>
          <td>${escapeHtml(doc.document_number)}</td>
          <td>${escapeHtml(doc.revision_number)}</td>
          <td><a href="/documents/${doc.id}">${escapeHtml(doc.document_name)}</a></td>
          <td>${escapeHtml(doc.category_name)}</td>
          <td>${statusBadge(doc.status)}</td>
          ${isAdmin ? `<td><form method="post" action="/sets/${set.id}/remove" data-confirm="세트에서 이 문서를 제외할까요?"><input type="hidden" name="documentId" value="${doc.id}"><button type="submit" class="danger-button sm">제외</button></form></td>` : ""}
        </tr>
      `).join("")}</tbody>
    </table></div>
  `;
}

function setAddResultView(result) {
  const added = `<div class="alert success" role="status">${result.added}건을 세트에 추가했습니다.</div>`;
  const missing = result.missing.length
    ? alertWarning(`찾지 못한 번호 ${result.missing.length}건: ${result.missing.join(", ")}`)
    : "";
  return `${added}${missing}`;
}

function setAdminTools(set, addQuery, addCandidates) {
  return `
    <section class="panel set-admin-tools">
      ${sectionHeader("문서 추가", "관리자")}
      <div class="set-add-grid">
        <form method="post" action="/sets/${set.id}/add" class="stack">
          <label>문서번호 일괄 추가
            <textarea name="numbers" rows="4" placeholder="문서번호 또는 보관코드를 줄바꿈이나 쉼표로 구분해 붙여넣으세요.&#10;예) MR-2026-001, PV-2026-014"></textarea>
          </label>
          <button type="submit" class="primary">일괄 추가</button>
        </form>
        <div class="stack">
          <form method="get" action="/sets/${set.id}" class="stack">
            <label>문서 검색으로 추가
              <input name="add-q" value="${escapeHtml(addQuery)}" placeholder="문서명, 문서번호, 위치 검색">
            </label>
            <button type="submit" class="button secondary">검색</button>
          </form>
          ${addCandidates ? setCandidateList(set, addQuery, addCandidates) : ""}
        </div>
      </div>
      <div class="set-danger-row">
        <form method="post" action="/sets/${set.id}/delete" data-confirm="세트를 삭제할까요? 세트에 담긴 문서 자체는 삭제되지 않습니다.">
          <button type="submit" class="danger-button">세트 삭제</button>
        </form>
      </div>
    </section>
  `;
}

function setCandidateList(set, addQuery, candidates) {
  if (!candidates.length) {
    return `<p class="muted">검색 결과가 없습니다.</p>`;
  }

  return `<div class="set-candidate-list">${candidates.map((doc) => `
    <div class="set-candidate ${doc.status !== "active" ? "is-disposed" : ""}">
      <div>
        <strong>${escapeHtml(doc.document_name)}</strong> ${statusBadge(doc.status)}
        <small>${escapeHtml(doc.document_number)} · ${escapeHtml(doc.revision_number)} · ${escapeHtml(locationLabel(doc))}</small>
      </div>
      ${doc.inSet ? `<span class="muted">이미 포함됨</span>` : `
        <form method="post" action="/sets/${set.id}/add">
          <input type="hidden" name="documentId" value="${doc.id}">
          <input type="hidden" name="add-q" value="${escapeHtml(addQuery)}">
          <button type="submit" class="button sm">추가</button>
        </form>
      `}
    </div>
  `).join("")}</div>`;
}

// 관리자 검색 리포트: 자주 찾는 검색어와 실패 검색어로 태그·문서명을 보강한다.
export function searchReportPage({ session, report }) {
  const { topQueries = [], failedQueries = [], topDocuments = [] } = report || {};
  return page("검색 리포트", `
    <section class="page-head">
      <h1>검색 리포트</h1>
      <a class="button secondary" href="/admin">관리자 홈</a>
    </section>
    ${report?.unavailable ? alertWarning("검색 로그 테이블이 아직 없습니다. 0014_search_analytics 마이그레이션을 적용하면 집계가 시작됩니다.") : ""}
    <section class="content-grid">
      <article class="panel">
        ${sectionHeader("자주 찾는 검색어", `${topQueries.length}건`)}
        ${topQueries.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>검색어</th><th>횟수</th><th>최근 결과</th><th>마지막 검색</th></tr></thead>
          <tbody>${topQueries.map((row) => `
            <tr>
              <td><a href="/app?q=${encodeURIComponent(row.query_text)}">${escapeHtml(row.query_text)}</a></td>
              <td>${Number(row.hits || 0)}회</td>
              <td>${Number(row.last_result_count || 0)}건</td>
              <td>${escapeHtml(row.last_searched_at || "-")}</td>
            </tr>
          `).join("")}</tbody>
        </table></div>` : emptyState("아직 집계된 검색어가 없습니다.")}
      </article>
      <article class="panel">
        ${sectionHeader("결과 없는 검색어", `${failedQueries.length}건`)}
        <p class="muted">자주 실패하는 표현은 해당 문서의 태그나 문서명에 추가하면 다음 검색부터 찾을 수 있습니다.</p>
        ${failedQueries.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>검색어</th><th>시도</th><th>마지막 검색</th><th></th></tr></thead>
          <tbody>${failedQueries.map((row) => `
            <tr>
              <td>${escapeHtml(row.query_text)}</td>
              <td>${Number(row.hits || 0)}회</td>
              <td>${escapeHtml(row.last_searched_at || "-")}</td>
              <td><a class="button secondary sm" href="/tags">태그 보강</a></td>
            </tr>
          `).join("")}</tbody>
        </table></div>` : emptyState("실패한 검색이 없습니다.")}
      </article>
    </section>
    <section class="panel">
      ${sectionHeader("많이 찾는 문서", `${topDocuments.length}건`)}
      ${topDocuments.length ? `
      <div class="index-list">
        ${topDocuments.map((row) => `
          <a class="index-row" href="/documents/${row.id}">
            <span><span class="mono">${escapeHtml(row.document_number)}</span> ${escapeHtml(row.document_name)}</span>
            <strong>${Number(row.click_count || 0)}회</strong>
          </a>
        `).join("")}
      </div>` : emptyState("아직 클릭 집계가 없습니다.")}
    </section>
  `, session);
}

export function categoriesPage({ session, categories, values = {}, error = "" }) {
  return masterPage({ session, title: "대분류 관리", action: "/categories", rows: categories, values, error, type: "categories" });
}

export function tagsPage({ session, tags, values = {}, error = "" }) {
  return masterPage({ session, title: "태그 관리", action: "/tags", rows: tags, values, error, type: "tags" });
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

export function accessDeniedPage(session) {
  return errorPage("접근 권한이 없습니다.", session, 403);
}

export function notFoundPage(session) {
  return errorPage("요청한 페이지를 찾을 수 없습니다.", session, 404);
}

export function errorPage(message, session, status = 500) {
  return page("오류", `<section class="panel narrow">${alertDanger(message)}<a class="button secondary" href="/app">검색 화면으로 이동</a></section>`, session, status);
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

function viewerSearchForm({ query, suggestions, categories, tags, filters, home = false }) {
  const activeFilterCount = [filters.categoryId, filters.tagId, filters.zoneNumber, filters.status].filter(Boolean).length;
  return `
    <form method="get" action="/app" class="viewer-search-form ${home ? "is-home" : ""}" data-search-form data-viewer-form data-auto-submit>
      ${searchInputBlock(query, suggestions)}
      <details class="filter-details" ${activeFilterCount ? "open" : ""}>
        <summary><i class="fa-solid fa-sliders"></i>상세 필터${activeFilterCount ? `<span class="filter-count">${activeFilterCount}</span>` : ""}</summary>
        <div class="viewer-filter-row">
          <label>대분류
            <select name="category">
              <option value="">전체</option>
              ${categories.map((category) => option(category.id, category.name, filters.categoryId)).join("")}
            </select>
          </label>
          <label>태그
            <select name="tag">
              <option value="">전체</option>
              ${tags.map((tag) => option(tag.id, tag.name, filters.tagId)).join("")}
            </select>
          </label>
          <label>구역
            <select name="zone">
              <option value="">전체</option>
              ${[1, 2, 3].map((zone) => option(zone, `${zone}구역`, filters.zoneNumber)).join("")}
            </select>
          </label>
          <label>상태
            <select name="status">
              <option value="">전체</option>
              ${option("active", "보관중", filters.status)}
              ${option("disposed", "폐기", filters.status)}
            </select>
          </label>
          <label>정렬
            <select name="sort">
              ${option("relevance", "정확도순", filters.sort || "relevance")}
              ${option("updated", "최신순", filters.sort)}
              ${option("location", "위치순", filters.sort)}
              ${option("docnum", "문서번호순", filters.sort)}
              ${option("category", "대분류순", filters.sort)}
            </select>
          </label>
          <a class="button secondary sm" href="/app">초기화</a>
        </div>
      </details>
    </form>
  `;
}

function searchInputBlock(query, suggestions = []) {
  const id = `searchSuggestions-${Math.random().toString(36).slice(2)}`;
  return `
    <div class="search-box">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input name="q" value="${escapeHtml(query)}" placeholder="문서명, 문서번호, 키워드, 대분류, 랙 위치 검색" aria-label="검색어" list="${id}" autocomplete="off" data-suggest-input>
      <datalist id="${id}" data-suggest-list>
        ${suggestions.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label || item.value)}</option>`).join("")}
      </datalist>
      <button type="submit" class="primary">검색</button>
    </div>
  `;
}

function viewerDocumentResults(documents, query) {
  if (!documents.length) {
    return emptyResult("조건에 맞는 문서가 없습니다.", query);
  }
  return `<div class="viewer-result-list">${documents.map((document) => viewerDocumentCard(document, query)).join("")}</div>`;
}

function viewerDocumentCard(document, query = "") {
  const location = document.location || {};
  const locationText = location.label || "위치 미지정";
  const rackCode = location.rackCode || "";
  const slot = [
    location.columnNumber ? `${location.columnNumber}열` : "",
    location.shelfNumber ? `${location.shelfNumber}선반` : ""
  ].filter(Boolean).join(" ");
  return `
    <article class="doc-row ${document.status !== "active" ? "is-disposed" : ""}">
      <div class="doc-row-loc">
        <div>
          <span class="loc-code">${location.rackLabel ? `${location.zoneNumber ? `${location.zoneNumber}구역 ` : ""}${escapeHtml(location.rackLabel)}` : rackCode ? escapeHtml(rackCode) : "위치 미지정"}</span>
          ${slot ? `<small class="loc-sub">${escapeHtml(slot)}</small>` : ""}
        </div>
        <button type="button" class="icon-button" data-copy-text="${escapeHtml(locationText)}" title="위치 복사" aria-label="위치 복사"><i class="fa-regular fa-copy"></i></button>
      </div>
      <div class="doc-row-main">
        <div class="doc-row-title">
          <a href="/documents/${document.id}" data-doc-click="${document.id}">${highlight(document.documentName || "문서명 없음", query)}</a>
          ${document.status !== "active" ? statusBadge(document.status) : ""}
        </div>
        <div class="doc-row-meta">
          <span class="mono">${highlight(document.documentNumber, query)}</span>
          <span>${escapeHtml(document.revisionNumber)}</span>
          <span>${escapeHtml(document.categoryName || "-")}</span>
          ${document.matchReason ? `<span class="match-line">${escapeHtml(document.matchReason)}</span>` : ""}
        </div>
      </div>
      <div class="doc-row-actions">
        <a class="button secondary sm" href="/documents/${document.id}" data-doc-click="${document.id}"><i class="fa-solid fa-circle-info"></i>상세</a>
      </div>
    </article>
  `;
}

// 도면 위 랙 실루엣 한 개. 양면 랙은 좌(N-1면)·우(N-2면) 두 칸을 세로 점선으로 나눈다.
// hit: 랙 전체 강조(검색 일치), hitFace('A'|'B'): 양면 랙에서 해당 면(반쪽)만 강조(문서 상세).
function floorRackMarkup(rack, { hit = false, hitFace = "" } = {}) {
  const classes = ["floor-rack", rack.isSingleSided ? "is-single" : "is-double"];
  if (hit) classes.push("is-hit");
  const faceAttr = !rack.isSingleSided && hitFace ? ` data-face-hit="${escapeHtml(hitFace)}"` : "";
  const faces = rack.isSingleSided
    ? ""
    : `<span class="rack-face rack-face-a"></span><span class="rack-face rack-face-b"></span>`;
  const title = rack.isSingleSided
    ? `${rack.code} · 단면 · ${rack.documentCount}건`
    : `${rack.code} · 양면 (좌 ${rack.rackNumber}-1 / 우 ${rack.rackNumber}-2) · ${rack.documentCount}건`;
  return `<a class="${classes.join(" ")}"${faceAttr} href="/documents?q=${encodeURIComponent(rack.code)}&sort=location" style="--rack-left:${rack.leftPct}%;--rack-width:${rack.widthPct}%;" data-rack-code="${escapeHtml(rack.code)}" title="${escapeHtml(title)}">${faces}<span class="rack-num">${escapeHtml(String(rack.rackNumber))}</span></a>`;
}

function floorPlanView(regions, hits, opts = {}) {
  const activeRackCount = regions.reduce((sum, region) => sum + region.racks.filter((rack) => hits.has(rack.code)).length, 0);
  return `
    <div class="floor-plan-shell">
      <div class="floor-plan-media">
        <img src="/images/Archive.png" alt="한림 문서고 도면">
        ${regions.map((region) => `
          <section class="floor-region" aria-label="${escapeHtml(region.label)}" style="--top:${region.topPct}%;--left:${region.leftPct}%;--width:${region.widthPct}%;--height:${region.heightPct}%;">
            <span class="floor-region-label">${escapeHtml(region.label)}</span>
            ${region.racks.map((rack) => floorRackMarkup(rack, { hit: hits.has(rack.code) })).join("")}
          </section>
        `).join("")}
      </div>
      ${opts.compact ? "" : `
      <div class="floor-plan-summary">
        ${activeRackCount ? `<span>일치 랙 ${activeRackCount}개</span>` : ""}
        <span><i class="legend-box"></i>양면 랙</span>
        <span><i class="legend-box single"></i>단면 랙</span>
        ${activeRackCount ? `<span><i class="legend-box hit"></i>검색 위치</span>` : ""}
      </div>
      <div class="zone-list">
        ${regions.map((region) => `<a href="/app?zone=${region.zoneNumber}&sort=location"><strong>${escapeHtml(region.label)}</strong><span>${region.racks.length}개 랙</span></a>`).join("")}
      </div>`}
    </div>
  `;
}

// 한 구역만 확대한 도면. 전체 도면 이미지를 스케일·이동해 해당 구역이 뷰포트를 꽉 채운다.
// 구역의 픽셀 비율(1024*W : 797*H)을 뷰포트 aspect-ratio로 두면 CSS 스케일이 왜곡 없이 맞아떨어진다.
function zoneFloorPlanView(region, { hitCode = "", hitFace = "" } = {}) {
  const aspectW = Math.max(1, Math.round(1024 * region.widthPct));
  const aspectH = Math.max(1, Math.round(797 * region.heightPct));
  return `
    <div class="floor-zoom" style="--z-aw:${aspectW};--z-ah:${aspectH};">
      <div class="floor-zoom-canvas" style="--zw:${region.widthPct};--zh:${region.heightPct};--zl:${region.leftPct};--zt:${region.topPct};">
        <img class="floor-zoom-img" src="/images/Archive.png" alt="${escapeHtml(region.label)} 도면">
        <section class="floor-region" aria-label="${escapeHtml(region.label)}" style="--top:${region.topPct}%;--left:${region.leftPct}%;--width:${region.widthPct}%;--height:${region.heightPct}%;">
          <span class="floor-region-label">${escapeHtml(region.label)}</span>
          ${region.racks.map((rack) => {
            const isHitRack = rack.code === hitCode;
            return floorRackMarkup(rack, {
              hit: isHitRack && (rack.isSingleSided || !hitFace),
              hitFace: isHitRack && !rack.isSingleSided ? hitFace : ""
            });
          }).join("")}
        </section>
      </div>
    </div>
  `;
}

function viewerPagination(pagination = {}, { query, filters }) {
  const totalPages = Number(pagination.totalPages || 1);
  if (totalPages <= 1) return "";
  const page = Number(pagination.page || 1);
  return `
    <nav class="pagination" aria-label="검색 결과 페이지">
      <a class="button secondary sm ${page === 1 ? "disabled" : ""}" href="${viewerUrl({ query, filters, page: Math.max(1, page - 1) })}">이전</a>
      <span>${page} / ${totalPages}</span>
      <a class="button secondary sm ${page === totalPages ? "disabled" : ""}" href="${viewerUrl({ query, filters, page: Math.min(totalPages, page + 1) })}">다음</a>
    </nav>
  `;
}

function viewerUrl({ query, filters = {}, patch = {}, page = 1 }) {
  const merged = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (merged.categoryId) params.set("category", merged.categoryId);
  if (merged.tagId) params.set("tag", merged.tagId);
  if (merged.zoneNumber) params.set("zone", merged.zoneNumber);
  if (merged.status) params.set("status", merged.status);
  if (merged.sort) params.set("sort", merged.sort);
  if (page > 1) params.set("page", page);
  const text = params.toString();
  return text ? `/app?${text}` : "/app";
}

function metric(label, value, caption) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small></article>`;
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

function archiveMap(racks, hits) {
  // 랙이 있는 구역만 그린다 (현재는 1구역뿐, 증설 시 자동 확장).
  const zones = [...new Set(racks.map((rack) => Number(rack.zone_number)))].sort((a, b) => a - b);
  return `
    <div class="archive-map">
      ${zones.map((zone) => {
        const zoneRacks = racks.filter((rack) => Number(rack.zone_number) === zone);
        return `<section class="rack-zone" aria-label="${zone}구역"><h3>${zone}구역</h3><div class="rack-zone-grid">
          ${zoneRacks.map((rack) => {
            const hitA = hits.has(`${rack.code}:A`);
            const hitB = hits.has(`${rack.code}:B`);
            const isHit = hitA || hitB;
            const single = readBoolean(rack.is_single_sided);
            const faceSummary = single
              ? `단면${hitA ? " 일치" : ""}`
              : `${rack.rack_number}-1${hitA ? " 일치" : ""} · ${rack.rack_number}-2${hitB ? " 일치" : ""}`;
            return `<a class="rack-tile ${isHit ? "is-hit" : ""}" href="/documents?q=${encodeURIComponent(rack.code)}" title="${escapeHtml(rack.code)} ${rack.document_count || 0}건">
              <strong>${rack.rack_number}</strong>
              <span>${escapeHtml(rack.code)}</span>
              <small>${faceSummary}</small>
            </a>`;
          }).join("")}
        </div></section>`;
      }).join("")}
    </div>
  `;
}

function documentResults(documents, opts = {}) {
  if (!documents.length) {
    return emptyResult(opts.emptyMessage || "조건에 맞는 문서가 없습니다.", opts.emptyQuery);
  }
  return `
    <div class="table-wrap" data-paginate-root>
      <table class="doc-table">
        <thead><tr>
          ${opts.bulk ? `<th class="check-col"><span class="sr-only">선택</span></th>` : ""}
          <th class="loc-col">보관 위치</th>
          <th>문서번호</th>
          <th>개정</th>
          <th>문서명</th>
          <th>대분류</th>
          <th>상태</th>
        </tr></thead>
        <tbody>${documents.map((doc) => documentRow(doc, opts)).join("")}</tbody>
      </table>
    </div>
  `;
}

function documentRow(doc, opts = {}) {
  return `
    <tr class="${doc.status !== "active" ? "is-disposed" : ""}">
      ${opts.bulk ? `<td class="check-col"><input type="checkbox" name="docId" value="${doc.id}" data-bulk-item aria-label="${escapeHtml(doc.document_name)} 선택"></td>` : ""}
      <td class="loc-cell" title="${escapeHtml(locationLabel(doc))}">
        <span class="loc-cell-main">${doc.zone_number ? `${doc.zone_number}구역 ` : ""}${escapeHtml(rackFaceLabel(doc) || doc.rack_code)}</span>
        <small class="loc-cell-sub">${escapeHtml(doc.column_number)}열 ${escapeHtml(doc.shelf_number)}선반</small>
      </td>
      <td class="mono-cell">${highlight(doc.document_number, opts.query || "")}</td>
      <td>${escapeHtml(doc.revision_number)}</td>
      <td class="name-cell">
        <a href="/documents/${doc.id}" data-doc-click="${doc.id}">${highlight(doc.document_name, opts.query || "")}</a>
        ${doc.note ? `<small>${escapeHtml(doc.note)}</small>` : ""}
        ${opts.showScore && doc.match_reason ? `<small class="match-line">${escapeHtml(doc.match_reason)}</small>` : ""}
      </td>
      <td>${escapeHtml(doc.category_name)}</td>
      <td class="status-cell">${statusBadge(doc.status)}</td>
    </tr>
  `;
}

function emptyResult(message, query = "") {
  return `
    <div class="empty-state">
      <i class="fa-regular fa-folder-open"></i>
      <p>${escapeHtml(message)}</p>
      ${query ? `<div class="empty-actions"><a class="button secondary sm" href="/documents">전체 문서 보기</a><a class="button secondary sm" href="/app">대분류로 찾기</a></div>` : ""}
    </div>
  `;
}

function paginationView(pagination, { query, filters }) {
  if (pagination.totalPages <= 1) return "";
  const previous = pagination.page > 1 ? pagination.page - 1 : 1;
  const next = pagination.page < pagination.totalPages ? pagination.page + 1 : pagination.totalPages;
  return `
    <nav class="pagination" aria-label="검색 결과 페이지">
      <a class="button secondary sm ${pagination.page === 1 ? "disabled" : ""}" href="${documentListUrl({ query, filters, page: previous })}">이전</a>
      <span>${pagination.page} / ${pagination.totalPages}</span>
      <a class="button secondary sm ${pagination.page === pagination.totalPages ? "disabled" : ""}" href="${documentListUrl({ query, filters, page: next })}">다음</a>
    </nav>
  `;
}

function documentListUrl({ query, filters = {}, page = 1 }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.zoneNumber) params.set("zone", filters.zoneNumber);
  if (filters.tagId) params.set("tag", filters.tagId);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort) params.set("sort", filters.sort);
  if (page > 1) params.set("page", page);
  const text = params.toString();
  return text ? `/documents?${text}` : "/documents";
}

function statusBadge(status) {
  return `<span class="status ${status === "active" ? "active" : "disposed"}">${status === "active" ? "보관중" : "폐기"}</span>`;
}

function bulkActionBar() {
  return `
    <div class="bulk-bar" data-bulk-bar hidden>
      <span data-bulk-count>0건 선택</span>
      <form method="post" action="/documents/bulk-dispose" data-bulk-form>
        <input type="hidden" name="ids" data-bulk-ids>
        <label class="bulk-reason"><input name="reason" placeholder="폐기 사유" required></label>
        <button type="submit" class="danger-button sm">일괄 폐기</button>
      </form>
    </div>
  `;
}

function documentActions(document) {
  if (document.status === "active") {
    return `<div class="button-group"><a class="button sm" href="/documents/${document.id}/edit">수정</a><button type="button" class="danger-button sm" data-open-modal="dispose-modal">폐기</button></div>`;
  }
  return `<div class="button-group"><form method="post" action="/documents/${document.id}/restore"><button type="submit" class="button sm">폐기 해제</button></form><button type="button" class="danger-button sm" data-open-modal="delete-modal">완전 삭제</button></div>`;
}

function disposeModal(document) {
  return `<dialog id="dispose-modal" class="modal"><form method="post" action="/documents/${document.id}/dispose" class="modal-body"><h3>문서 폐기</h3><label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">폐기 확인</button></div></form></dialog>`;
}

function deleteModal(document) {
  return `<dialog id="delete-modal" class="modal"><form method="post" action="/documents/${document.id}/delete-permanent" class="modal-body"><h3>완전 삭제</h3><p class="danger-text">이 작업은 되돌릴 수 없습니다.</p><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">완전 삭제</button></div></form></dialog>`;
}

function timeline(rows, renderer, emptyMessage) {
  return rows.length ? `<div class="timeline-container">${rows.map(renderer).join("")}</div>` : emptyState(emptyMessage);
}

function renderDisposalLog(log) {
  return timelineItem(log.action === "disposed" ? "문서 폐기" : "폐기 해제", `${log.performed_by} / ${log.created_at}`, log.reason || "-");
}

function renderAuditLog(log) {
  const labels = { legacy_import: "기존 데이터", create: "등록", update: "수정", move: "이동", dispose: "폐기", restore: "폐기 해제", delete_permanent: "완전 삭제" };
  return timelineItem(`${labels[log.action] || log.action}: ${log.summary}`, `${log.actor} (${log.actor_role}) / ${log.created_at}`, log.details || "");
}

function timelineItem(title, meta, body) {
  return `<div class="timeline-item"><div class="timeline-badge"></div><div class="timeline-content"><div class="timeline-header"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta)}</span></div>${body ? `<p>${escapeHtml(body)}</p>` : ""}</div></div>`;
}

// 문서 상세 기본정보: 문서 정보와 서가 위치 사이에, 해당 구역만 확대한 도면을 넣고
// 문서가 보관된 랙(양면이면 그 면의 반쪽)만 파란색으로 강조한다.
function renderDocumentFloorPlan(document, floorPlan = []) {
  if (!floorPlan.length) {
    return "";
  }
  const region = floorPlan.find((item) => item.racks.some((rack) => rack.code === document.rack_code));
  const rackLabel = rackFaceLabel(document);
  const badge = `${document.zone_number ? `${document.zone_number}구역 ` : ""}${escapeHtml(rackLabel || document.rack_code)}번 랙`;

  if (!region) {
    return `
      <section class="panel doc-floor-plan">
        <div class="section-title"><h2>문서고 도면</h2><span class="count-badge">${badge}</span></div>
        <p class="muted">이 문서의 랙은 현재 도면에 표시되지 않는 구역에 있습니다.</p>
      </section>
    `;
  }

  const single = readBoolean(document.is_single_sided);
  return `
    <section class="panel doc-floor-plan">
      <div class="section-title">
        <h2>문서고 도면 · ${escapeHtml(region.label)}</h2>
        <span class="count-badge">${badge}</span>
      </div>
      ${zoneFloorPlanView(region, { hitCode: document.rack_code, hitFace: document.rack_face })}
      <p class="muted">파란색이 이 문서가 보관된 ${single ? "랙" : `${escapeHtml(rackLabel)} 면(양면 랙의 ${document.rack_face === "B" ? "우측" : "좌측"})`}입니다.</p>
    </section>
  `;
}

function renderMiniVisualizer(document) {
  const cols = Math.max(1, Number(document.column_count || 1));
  const rows = Math.max(1, Number(document.shelf_count || 3));
  const activeCol = Number(document.column_number || 0);
  const activeRow = Number(document.shelf_number || 0);
  let slots = "";

  for (let row = rows; row >= 1; row -= 1) {
    for (let col = 1; col <= cols; col += 1) {
      const active = col === activeCol && row === activeRow;
      slots += `<div class="mini-slot ${active ? "active" : ""}" title="${col}열 ${row}행"><span>${col}-${row}</span>${active ? `<i class="fa-solid fa-location-dot" aria-hidden="true"></i>` : ""}</div>`;
    }
  }

  // 선반 나침반: 추상 좌표를 랙 앞에 선 사람의 몸 기준 서수·방향으로 번역해 '어디부터 세지' 혼동을 없앤다.
  const ordinal = [
    activeRow ? `아래에서 ${activeRow}번째 선반` : "",
    activeCol ? `왼쪽에서 ${activeCol}번째 열` : ""
  ].filter(Boolean).join(" · ");

  const rackLabel = rackFaceLabel(document);
  return `
    <section class="panel minimap-card">
      <div class="section-title"><h2>서가 위치 · ${document.zone_number ? `${document.zone_number}구역 ` : ""}${escapeHtml(rackLabel || document.rack_code)}번 랙</h2><span class="count-badge">${activeCol}열 ${activeRow}행</span></div>
      <div class="mini-rack-stage">
        <div class="mini-axis" aria-hidden="true"><span>위 ↑</span><span>아래 ↓</span></div>
        <div class="mini-rack-grid" style="--cols:${cols};--rows:${rows}">${slots}</div>
      </div>
      ${ordinal ? `<p class="mini-compass"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> ${escapeHtml(ordinal)}${readBoolean(document.is_single_sided) ? "" : ` · 양면 랙 ${escapeHtml(rackLabel)} 면`}</p>` : ""}
    </section>
  `;
}

function detail(label, value) {
  return `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function importResult(result) {
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const summary = `<div class="alert ${failures.length ? "warning" : "success"}">${result.created}건 가져오기 완료${result.disposed ? `, 폐기 ${result.disposed}건 반영` : ""}${failures.length ? `, 실패 ${failures.length}건` : ""}</div>`;
  if (!failures.length) {
    return summary;
  }
  const items = failures.slice(0, 20).map((message) => `<li>${escapeHtml(message)}</li>`).join("");
  const more = failures.length > 20 ? `<li>… 외 ${failures.length - 20}건</li>` : "";
  return `${summary}<ul class="import-failures">${items}${more}</ul>`;
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

function locationPicker(slots, selectedRackSlotId) {
  // 위치 선택 스크립트(locationPickerScript)가 랙 → 열 → 선반 3단 선택과 면 표기 동기화에
  // 쓸 수 있도록 각 칸의 좌표·단면 여부를 data 속성으로 싣는다.
  return `
    <label>보관 위치 <em>*</em>
      <select name="rackSlotId" required>
        <option value="">위치 선택</option>
        ${slots.map((slot) => {
          const selected = String(slot.id) === String(selectedRackSlotId ?? "") ? " selected" : "";
          const label = slot.label || `${slot.zone_number}구역 / ${slot.rack_number}번 랙 / ${slot.column_number}열 / ${slot.shelf_number}선반`;
          const data = [
            `data-zone="${escapeHtml(String(slot.zone_number ?? ""))}"`,
            `data-rack-number="${escapeHtml(String(slot.rack_number ?? ""))}"`,
            `data-column="${escapeHtml(String(slot.column_number ?? ""))}"`,
            `data-shelf="${escapeHtml(String(slot.shelf_number ?? ""))}"`,
            `data-single-sided="${readBoolean(slot.is_single_sided) ? "1" : "0"}"`
          ].join(" ");
          return `<option value="${escapeHtml(String(slot.id))}" ${data}${selected}>${escapeHtml(label)}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function sectionHeader(title, count) {
  return `<div class="section-title"><h2>${escapeHtml(title)}</h2><span class="count-badge">${escapeHtml(count)}</span></div>`;
}

function documentToolbar(session) {
  if (session.role !== "Admin") return "";
  return `<div class="button-group"><a class="button" href="/documents/new">문서 등록</a><a class="button secondary" href="/documents/import">CSV 가져오기</a><a class="button secondary" href="/documents/export.csv">CSV 내보내기</a></div>`;
}

function option(value, label, selected) {
  const sel = String(value) === String(selected ?? "") ? " selected" : "";
  return `<option value="${escapeHtml(String(value))}"${sel}>${escapeHtml(label)}</option>`;
}

function formValue(values, camelKey, snakeKey) {
  return values?.[camelKey] ?? values?.[snakeKey] ?? "";
}

function alertDanger(message) {
  return `<div class="alert danger" role="alert" aria-live="assertive">${escapeHtml(message)}</div>`;
}

function alertWarning(message) {
  return `<div class="alert warning" role="alert">${escapeHtml(message)}</div>`;
}

function emptyState(message) {
  return `<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>${escapeHtml(message)}</p></div>`;
}

function clientScript() {
  return `
    document.addEventListener('DOMContentLoaded', function () {
      var nav = document.querySelector('[data-nav-menu]');
      var scrim = document.querySelector('[data-nav-scrim]');
      var hamburger = document.querySelector('[data-hamburger]');
      var close = document.querySelector('[data-drawer-close]');
      function setNav(open) {
        if (!nav) return;
        nav.classList.toggle('is-open', open);
        if (scrim) scrim.classList.toggle('is-open', open);
      }
      if (hamburger) hamburger.addEventListener('click', function () { setNav(true); });
      if (close) close.addEventListener('click', function () { setNav(false); });
      if (scrim) scrim.addEventListener('click', function () { setNav(false); });

      document.querySelectorAll('[data-confirm]').forEach(function (form) {
        form.addEventListener('submit', function (event) {
          if (!window.confirm(form.dataset.confirm)) event.preventDefault();
        });
      });

      document.querySelectorAll('[data-print]').forEach(function (button) {
        button.addEventListener('click', function () { window.print(); });
      });

      document.querySelectorAll('[data-auto-submit] select').forEach(function (select) {
        select.addEventListener('change', function () {
          if (select.form) select.form.submit();
        });
      });

      document.querySelectorAll('[data-tab]').forEach(function (tab) {
        tab.addEventListener('click', function () {
          var id = tab.dataset.tab;
          var nav = tab.closest('.tab-nav');
          if (nav) nav.querySelectorAll('[role="tab"]').forEach(function (item) { item.setAttribute('aria-selected', 'false'); });
          tab.setAttribute('aria-selected', 'true');
          document.querySelectorAll('.tab-panel').forEach(function (panel) { panel.hidden = panel.id !== 'panel-' + id; });
        });
      });

      document.querySelectorAll('[data-open-modal]').forEach(function (button) {
        button.addEventListener('click', function () {
          var modal = document.getElementById(button.dataset.openModal);
          if (modal && modal.showModal) modal.showModal();
        });
      });
      document.querySelectorAll('[data-close-modal]').forEach(function (button) {
        button.addEventListener('click', function () {
          var modal = button.closest('dialog');
          if (modal) modal.close();
        });
      });

      document.querySelectorAll('[data-search-form]').forEach(function (form) {
        form.addEventListener('submit', function () {
          var input = form.querySelector('input[name="q"]');
          var value = input ? input.value.trim() : '';
          if (!value) return;
          try {
            var recent = JSON.parse(localStorage.getItem('hanlimRecentSearches') || '[]').filter(function (item) { return item !== value; });
            recent.unshift(value);
            localStorage.setItem('hanlimRecentSearches', JSON.stringify(recent.slice(0, 6)));
          } catch {}
        });
      });

      var recentBox = document.querySelector('[data-recent-searches]');
      if (recentBox) {
        try {
          var recent = JSON.parse(localStorage.getItem('hanlimRecentSearches') || '[]');
          if (recent.length) {
            recentBox.innerHTML = '<span>최근 검색</span>' + recent.map(function (item) {
              return '<a class="chip" href="/app?q=' + encodeURIComponent(item) + '">' + escapeHtmlClient(item) + '</a>';
            }).join('');
          }
        } catch {}
      }

      document.querySelectorAll('[data-copy-text]').forEach(function (button) {
        button.addEventListener('click', function () {
          var text = button.dataset.copyText || '';
          if (!text) return;
          function done() {
            var original = button.textContent;
            button.textContent = '복사됨';
            setTimeout(function () { button.textContent = original; }, 1400);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () {});
          } else {
            var input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', '');
            input.style.position = 'fixed';
            input.style.left = '-9999px';
            document.body.appendChild(input);
            input.select();
            try { document.execCommand('copy'); done(); } catch {}
            input.remove();
          }
        });
      });

      document.querySelectorAll('[data-suggest-input]').forEach(function (input) {
        var datalist = input.parentElement ? input.parentElement.querySelector('[data-suggest-list]') : null;
        var timer = null;
        input.addEventListener('input', function () {
          clearTimeout(timer);
          var q = input.value.trim();
          if (!datalist || q.length < 2) return;
          timer = setTimeout(function () {
            fetch('/api/search-suggestions?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
              .then(function (response) { return response.ok ? response.json() : { suggestions: [] }; })
              .then(function (data) {
                datalist.innerHTML = (data.suggestions || []).map(function (item) {
                  return '<option value="' + escapeHtmlClient(item.value) + '">' + escapeHtmlClient(item.label || item.value) + '</option>';
                }).join('');
              })
              .catch(function () {});
          }, 180);
        });
      });

      var bulkBar = document.querySelector('[data-bulk-bar]');
      var bulkIds = document.querySelector('[data-bulk-ids]');
      var bulkCount = document.querySelector('[data-bulk-count]');
      function syncBulk() {
        var checked = Array.from(document.querySelectorAll('[data-bulk-item]:checked')).map(function (item) { return item.value; });
        if (bulkBar) bulkBar.hidden = checked.length === 0;
        if (bulkIds) bulkIds.value = checked.join(',');
        if (bulkCount) bulkCount.textContent = checked.length + '건 선택';
      }
      document.querySelectorAll('[data-bulk-item]').forEach(function (item) { item.addEventListener('change', syncBulk); });

      var bulkForm = document.querySelector('[data-bulk-form]');
      if (bulkForm) {
        bulkForm.addEventListener('submit', function (event) {
          var count = document.querySelectorAll('[data-bulk-item]:checked').length;
          if (!window.confirm('선택한 ' + count + '건을 일괄 폐기 처리할까요? 폐기 후에는 관리자만 해제할 수 있습니다.')) {
            event.preventDefault();
          }
        });
      }

      var cmd = document.getElementById('command-palette');
      var cmdInput = document.getElementById('cmdSearchInput');
      var cmdResults = document.getElementById('cmdResults');
      var routes = [
        { title: '검색', path: '/app', icon: 'fa-magnifying-glass' },
        { title: '문서 전체', path: '/documents', icon: 'fa-file-lines' },
        { title: '문서 등록', path: '/documents/new', icon: 'fa-plus' },
        { title: '랙 목록', path: '/racks', icon: 'fa-box-archive' },
        { title: '대분류 관리', path: '/categories', icon: 'fa-layer-group' },
        { title: '태그 관리', path: '/tags', icon: 'fa-tags' }
      ];
      function renderCmd() {
        if (!cmdResults || !cmdInput) return;
        var q = cmdInput.value.trim();
        var lower = q.toLowerCase();
        var html = '';
        if (q) {
          html += '<a href="/app?q=' + encodeURIComponent(q) + '" class="cmd-item"><i class="fa-solid fa-file-lines cmd-item-icon"></i><span>"' + escapeHtmlClient(q) + '" 문서 검색</span></a>';
        }
        routes.filter(function (route) { return !q || route.title.toLowerCase().includes(lower); }).forEach(function (route) {
          html += '<a href="' + route.path + '" class="cmd-item"><i class="fa-solid ' + route.icon + ' cmd-item-icon"></i><span>' + route.title + '</span></a>';
        });
        cmdResults.innerHTML = html;
      }
      document.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          if (cmd && cmd.showModal) {
            cmd.showModal();
            renderCmd();
            setTimeout(function () { if (cmdInput) cmdInput.focus(); }, 0);
          }
        } else if (event.key === 'Escape' && cmd && cmd.open) {
          cmd.close();
        }
      });
      if (cmdInput) cmdInput.addEventListener('input', renderCmd);

      var currentPath = location.pathname;
      document.querySelectorAll('.archive-nav-item').forEach(function (item) {
        var href = item.getAttribute('href') || '';
        if (href === currentPath || (href.length > 1 && currentPath.indexOf(href + '/') === 0)) {
          item.classList.add('active');
        }
      });

      var toastKey = new URLSearchParams(location.search).get('toast');
      if (toastKey) {
        var toastMessages = {
          created: '문서가 등록되었습니다.',
          updated: '문서 정보가 수정되었습니다.',
          disposed: '폐기 처리되었습니다.',
          restored: '폐기가 해제되었습니다.',
          deleted: '문서가 완전 삭제되었습니다.',
          saved: '저장되었습니다.',
          'bulk-disposed': '선택한 문서를 폐기 처리했습니다.',
          approved: '가입 요청을 승인했습니다.',
          rejected: '가입 요청을 거절했습니다.',
          error: '요청을 처리하지 못했습니다. 입력값을 확인하세요.'
        };
        var toastMessage = toastMessages[toastKey];
        if (toastMessage) {
          var toast = document.createElement('div');
          toast.className = 'app-toast' + (toastKey === 'error' ? ' is-error' : '');
          toast.setAttribute('role', 'status');
          toast.textContent = toastMessage;
          document.body.appendChild(toast);
          setTimeout(function () { toast.classList.add('is-visible'); }, 30);
          setTimeout(function () { toast.classList.remove('is-visible'); }, 3200);
          setTimeout(function () { toast.remove(); }, 3700);
        }
        try {
          var cleanUrl = new URL(location.href);
          cleanUrl.searchParams.delete('toast');
          history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        } catch {}
      }

      // 검색 결과 클릭 학습 (아이디어 8): 클릭된 문서를 검색어와 함께 집계한다.
      document.addEventListener('click', function (event) {
        var target = event.target instanceof Element ? event.target : null;
        var link = target && target.closest ? target.closest('[data-doc-click]') : null;
        if (!link) return;
        var input = document.querySelector('[data-search-form] input[name="q"]');
        var q = input ? input.value.trim() : '';
        var csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (!q || !csrfMeta || !navigator.sendBeacon) return;
        var payload = new FormData();
        payload.append('q', q);
        payload.append('documentId', link.getAttribute('data-doc-click'));
        payload.append('csrf_token', csrfMeta.getAttribute('content') || '');
        navigator.sendBeacon('/api/search-click', payload);
      });

      // 즉시 검색 (아이디어 3): /app에서 타이핑 즉시 로컬 인덱스를 스코어링해 렌더한다.
      var viewerApp = document.querySelector('[data-viewer-app]');
      var viewerForm = document.querySelector('[data-viewer-form]');
      var viewerInput = viewerForm ? viewerForm.querySelector('input[name="q"]') : null;
      if (viewerApp && viewerInput && window.SearchCore) {
        var core = window.SearchCore;
        var contextEl = document.querySelector('[data-viewer-context]');
        var searchContext = { categories: [], tags: [] };
        try { searchContext = JSON.parse(contextEl ? contextEl.textContent : '{}') || searchContext; } catch {}
        var searchIndex = null;
        var indexLoading = false;
        var resultsBody = document.querySelector('[data-results-body]');
        var resultsTitle = document.querySelector('[data-results-title]');
        var resultsCount = document.querySelector('[data-results-count]');
        var homeExtras = document.querySelector('[data-home-extras]');
        var initialResults = {
          body: resultsBody ? resultsBody.innerHTML : '',
          title: resultsTitle ? resultsTitle.textContent : '',
          count: resultsCount ? resultsCount.textContent : ''
        };
        var initialHitCodes = Array.prototype.slice.call(document.querySelectorAll('.floor-rack.is-hit')).map(function (rack) {
          return rack.getAttribute('data-rack-code') || '';
        });
        var renderTimer = null;

        var instantLocation = function (doc) {
          var faceLabel = core.rackFaceLabel(doc);
          return {
            main: (doc.zone_number ? doc.zone_number + '구역 ' : '') + (faceLabel || doc.rack_code || ''),
            sub: (doc.column_number || '') + '열 ' + (doc.shelf_number || '') + '선반',
            label: [
              doc.zone_number ? doc.zone_number + '구역' : '',
              faceLabel ? faceLabel + '번 랙' : doc.rack_code,
              doc.column_number ? doc.column_number + '열' : '',
              doc.shelf_number ? doc.shelf_number + '선반' : ''
            ].filter(Boolean).join(' / ')
          };
        };

        var instantBadges = function (doc) {
          var html = '';
          if (doc.status !== 'active') html += '<span class="status disposed">폐기</span>';
          return html;
        };

        var instantRow = function (doc, q) {
          var loc = instantLocation(doc);
          var rail = doc.status !== 'active' ? ' is-disposed' : '';
          return '<article class="doc-row' + rail + '">' +
            '<div class="doc-row-loc"><div>' +
            '<span class="loc-code">' + escapeHtmlClient(loc.main) + '</span>' +
            '<small class="loc-sub">' + escapeHtmlClient(loc.sub) + '</small>' +
            '</div><button type="button" class="icon-button" data-copy-text="' + escapeHtmlClient(loc.label) + '" title="위치 복사" aria-label="위치 복사"><i class="fa-regular fa-copy"></i></button></div>' +
            '<div class="doc-row-main"><div class="doc-row-title">' +
            '<a href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '">' + core.highlightHtml(doc.document_name || '문서명 없음', q, escapeHtmlClient) + '</a>' +
            instantBadges(doc) +
            '</div><div class="doc-row-meta">' +
            '<span class="mono">' + core.highlightHtml(doc.document_number || '', q, escapeHtmlClient) + '</span>' +
            '<span>' + escapeHtmlClient(doc.revision_number || '') + '</span>' +
            '<span>' + escapeHtmlClient(doc.category_name || '-') + '</span>' +
            (doc.match_reason ? '<span class="match-line">' + escapeHtmlClient(doc.match_reason) + '</span>' : '') +
            '</div></div>' +
            '<div class="doc-row-actions"><a class="button secondary sm" href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '"><i class="fa-solid fa-circle-info"></i>상세</a></div>' +
            '</article>';
        };

        var instantAnswer = function (doc, q, grade) {
          var loc = instantLocation(doc);
          var faceLabel = core.rackFaceLabel(doc);
          var head = (doc.zone_number ? doc.zone_number + '구역 ' : '') + (faceLabel ? faceLabel + '번 랙' : (doc.rack_code || ''));
          var gradeChip = grade === 'certain'
            ? '<span class="answer-grade certain">확실</span>'
            : '<span class="answer-grade likely">유력 · 확인 권장</span>';
          return '<section class="answer-card" data-answer-card>' +
            '<div class="answer-head"><small class="answer-label">가장 정확한 결과</small>' + gradeChip + '</div>' +
            '<div class="answer-loc">' + escapeHtmlClient(head) + '<span>' + escapeHtmlClient(loc.sub) + '</span></div>' +
            '<div class="answer-doc"><a href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '">' + core.highlightHtml(doc.document_name || '', q, escapeHtmlClient) + '</a>' + instantBadges(doc) +
            '<div class="answer-meta"><span class="mono">' + core.highlightHtml(doc.document_number || '', q, escapeHtmlClient) + '</span><span>' + escapeHtmlClient(doc.revision_number || '') + '</span><span>' + escapeHtmlClient(doc.category_name || '-') + '</span></div></div>' +
            '<div class="answer-actions">' +
            '<a class="button" href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '"><i class="fa-solid fa-circle-info"></i>상세 정보</a>' +
            '<button type="button" class="button secondary" data-copy-text="' + escapeHtmlClient(loc.label) + '">위치 복사</button>' +
            '</div></section>';
        };

        var currentSelectFilters = function () {
          var num = function (name) {
            var el = viewerForm.querySelector('select[name="' + name + '"]');
            return el ? Number(el.value) || 0 : 0;
          };
          var statusEl = viewerForm.querySelector('select[name="status"]');
          var sortEl = viewerForm.querySelector('select[name="sort"]');
          return {
            categoryId: num('category'),
            tagId: num('tag'),
            zoneNumber: num('zone'),
            status: statusEl ? statusEl.value : '',
            sort: sortEl ? sortEl.value : 'relevance'
          };
        };

        var tagNameById = function (id) {
          var tags = searchContext.tags || [];
          for (var i = 0; i < tags.length; i++) {
            if (Number(tags[i].id) === Number(id)) return tags[i].name;
          }
          return '';
        };

        var matchesFilters = function (doc, f) {
          if (f.categoryId && Number(doc.category_id) !== f.categoryId) return false;
          if (f.zoneNumber && Number(doc.zone_number) !== f.zoneNumber) return false;
          if (f.status && doc.status !== f.status) return false;
          if (f.tagId) {
            var name = core.compactSearchText(tagNameById(f.tagId));
            if (!name) return false;
            if (core.compactSearchText(doc.tag_names || '').indexOf(name) === -1) return false;
          }
          return true;
        };

        var updateFloorHits = function (codes) {
          Array.prototype.forEach.call(document.querySelectorAll('.floor-rack'), function (rack) {
            var code = rack.getAttribute('data-rack-code') || '';
            rack.classList.toggle('is-hit', codes.indexOf(code) !== -1);
          });
        };

        var restoreInitial = function () {
          if (resultsBody) resultsBody.innerHTML = initialResults.body;
          if (resultsTitle) resultsTitle.textContent = initialResults.title;
          if (resultsCount) resultsCount.textContent = initialResults.count;
          if (homeExtras) homeExtras.hidden = false;
          if (viewerApp.classList.contains('is-home')) viewerApp.hidden = true;
          updateFloorHits(initialHitCodes);
        };

        var renderInstant = function () {
          var q = viewerInput.value.trim();
          if (!q) { restoreInitial(); return; }
          if (!searchIndex) { loadSearchIndex(); return; }
          var f = currentSelectFilters();
          var parsed = core.parseSearchQuery(q, {
            categories: searchContext.categories,
            tags: searchContext.tags,
            explicit: f
          });
          var merged = {
            categoryId: f.categoryId || parsed.filters.categoryId || 0,
            tagId: f.tagId || parsed.filters.tagId || 0,
            zoneNumber: f.zoneNumber || parsed.filters.zoneNumber || 0,
            status: f.status || parsed.filters.status || '',
            sort: f.sort || 'relevance'
          };
          var text = parsed.text;
          var hasText = Boolean(text);
          var scored = [];
          for (var i = 0; i < searchIndex.length; i++) {
            var doc = searchIndex[i];
            if (!matchesFilters(doc, merged)) continue;
            var result = core.scoreDocumentMatch(doc, text);
            if (hasText && result.relevance_score <= 0) continue;
            var item = Object.assign({}, doc, result);
            if (item.relevance_score > 0) item.relevance_score += core.popularityBoost(doc.popularity);
            scored.push(item);
          }
          scored.sort(function (left, right) {
            return core.compareSearchResults(left, right, hasText ? (merged.sort || 'relevance') : 'updated', hasText);
          });
          var top = scored.slice(0, 30);
          var html = '';
          var chips = parsed.chips || [];
          if (chips.length) {
            var chipLabels = { zone: '구역', category: '대분류', tag: '태그', status: '상태' };
            html += '<div class="parsed-chip-row"><span>자동 적용</span>' + chips.map(function (chip) {
              return '<span class="chip active">' + escapeHtmlClient((chipLabels[chip.type] || chip.type) + ': ' + chip.label) + '</span>';
            }).join('') + '</div>';
          }
          var answer = null;
          var answerGrade = 'likely';
          if (hasText && (merged.sort || 'relevance') === 'relevance' && top.length) {
            var compactQ = core.compactSearchText(text);
            var exactCode = compactQ && (
              core.compactSearchText(top[0].document_number || '') === compactQ ||
              core.compactSearchText(top[0].storage_code || '') === compactQ
            );
            if (exactCode || top.length === 1 || Number(top[0].relevance_score) >= Number(top[1].relevance_score || 0) * 1.5) {
              answer = top[0];
              answerGrade = exactCode ? 'certain' : 'likely';
            }
          }
          if (answer) {
            html += instantAnswer(answer, text, answerGrade);
            var rest = top.filter(function (item) { return item.id !== answer.id; });
            if (rest.length) {
              html += '<p class="rest-label">다른 결과 ' + (scored.length - 1) + '건</p>';
              html += '<div class="viewer-result-list">' + rest.map(function (item) { return instantRow(item, text); }).join('') + '</div>';
            }
          } else if (top.length) {
            html += '<div class="viewer-result-list">' + top.map(function (item) { return instantRow(item, text); }).join('') + '</div>';
          } else {
            html += '<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>조건에 맞는 문서가 없습니다.</p></div>';
            var loose = [];
            for (var j = 0; j < searchIndex.length; j++) {
              var candidate = searchIndex[j];
              if (candidate.status !== 'active') continue;
              var looseScore = core.scoreDocumentMatch(candidate, text, { minCoverage: 0.2 });
              if (looseScore.relevance_score > 0) loose.push(Object.assign({}, candidate, looseScore));
            }
            loose.sort(function (l, r) { return r.relevance_score - l.relevance_score; });
            if (loose.length) {
              html += '<div class="didyoumean"><p>혹시 이 문서를 찾으셨나요?</p>' + loose.slice(0, 3).map(function (item) {
                var loc = instantLocation(item);
                return '<a href="/documents/' + item.id + '"><strong>' + escapeHtmlClient(item.document_name || '') + '</strong><span class="mono">' + escapeHtmlClient(item.document_number || '') + '</span><small>' + escapeHtmlClient(loc.label) + '</small></a>';
              }).join('') + '</div>';
            }
          }
          if (scored.length > top.length) {
            html += '<nav class="pagination"><a class="button secondary sm" href="/app?q=' + encodeURIComponent(q) + '">전체 ' + scored.length + '건 모두 보기</a></nav>';
          }
          if (resultsBody) resultsBody.innerHTML = html;
          if (resultsTitle) resultsTitle.textContent = '"' + q + '" 검색 결과';
          if (resultsCount) resultsCount.textContent = scored.length + '건';
          if (homeExtras) homeExtras.hidden = true;
          viewerApp.hidden = false;
          updateFloorHits(top.map(function (item) { return item.rack_code; }));
        };

        var loadSearchIndex = function () {
          if (searchIndex || indexLoading) return;
          indexLoading = true;
          fetch('/api/search-index', { headers: { Accept: 'application/json' } })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (data) {
              searchIndex = data && data.documents ? data.documents : [];
              indexLoading = false;
              renderInstant();
            })
            .catch(function () { indexLoading = false; });
        };

        viewerInput.addEventListener('input', function () {
          clearTimeout(renderTimer);
          renderTimer = setTimeout(renderInstant, 100);
        });
        viewerInput.addEventListener('focus', loadSearchIndex);
        setTimeout(loadSearchIndex, 400);
      }

      function escapeHtmlClient(value) {
        return String(value || '').replace(/[&<>"']/g, function (char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }
    });
  `;
}

function styles() {
  return `
    :root {
      color-scheme: light;
      --gray-50: #f7f9fb;
      --gray-100: #eef1f5;
      --gray-200: #e1e6ed;
      --gray-300: #cbd3dd;
      --gray-400: #9aa7b8;
      --gray-500: #5a6a7d;
      --gray-600: #55647a;
      --gray-700: #3d4a5c;
      --gray-800: #283445;
      --gray-900: #18212f;
      --bg: #f3f5f8;
      --surface: #ffffff;
      --ink: var(--gray-900);
      --muted: var(--gray-500);
      --line: var(--gray-200);
      --primary: #1e55c4;
      --primary-strong: #17439f;
      --primary-soft: #e9effb;
      --primary-deep: #122c63;
      --success: #0c7a43;
      --success-soft: #e5f4eb;
      --warning: #9a5b00;
      --warning-soft: #fdf1dd;
      --danger: #c22f2f;
      --danger-soft: #fbecec;
      --ring: rgba(30, 85, 196, .22);
      --scrim: rgba(24, 33, 47, .5);
      --shadow-1: 0 4px 16px rgba(24, 33, 47, .08);
      --shadow-2: 0 12px 40px rgba(24, 33, 47, .18);
      --r-lg: 10px;
      --r-md: 8px;
      --r-sm: 6px;
      --sp-1: 4px;
      --sp-2: 8px;
      --sp-3: 12px;
      --sp-4: 16px;
      --sp-5: 20px;
      --sp-6: 24px;
      --sp-8: 32px;
      --font-mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html, body { overflow-x: hidden; }
    [hidden] { display: none !important; }
    body { margin: 0; font-family: "Pretendard Variable", Pretendard, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; background: var(--bg); color: var(--ink); line-height: 1.55; letter-spacing: -.01em; -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums; }
    a { color: inherit; }
    ::selection { background: var(--primary-soft); }
    .mono { font-family: var(--font-mono); }
    .skip-nav { position: absolute; left: -1000px; top: var(--sp-4); z-index: 1000; padding: var(--sp-2) var(--sp-3); background: var(--gray-900); color: var(--surface); border-radius: var(--r-md); }
    .skip-nav:focus { left: var(--sp-4); }

    h1, h2, h3, p { overflow-wrap: anywhere; }
    h1 { margin: 0; font-size: 19px; font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
    h2 { margin: 0; font-size: 15px; font-weight: 700; line-height: 1.35; letter-spacing: -.01em; }
    h3 { margin: 0; font-size: 13.5px; font-weight: 700; line-height: 1.4; }
    .page-sub { margin: var(--sp-1) 0 0; color: var(--gray-500); font-size: 12.5px; font-weight: 500; }
    .muted { color: var(--gray-500); font-size: 13px; }

    .topbar { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) clamp(12px, 3vw, 24px); background: var(--surface); border-bottom: 1px solid var(--line); }
    .brand { display: inline-flex; align-items: center; gap: var(--sp-2); text-decoration: none; min-width: max-content; }
    .brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--r-md); background: var(--primary); color: var(--surface); font-size: 14px; }
    .brand strong, .brand small { display: block; }
    .brand strong { font-weight: 700; font-size: 14px; letter-spacing: -.01em; }
    .brand small { color: var(--gray-500); font-size: 11.5px; font-weight: 500; }
    .topbar nav { display: flex; align-items: center; gap: var(--sp-1); flex: 1; }
    .archive-nav-item, .nav-sub-link, .logout-link { display: inline-flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-radius: var(--r-md); text-decoration: none; color: var(--gray-600); font-weight: 600; font-size: 13.5px; transition: background .15s ease, color .15s ease; }
    .archive-nav-item i, .nav-sub-link i, .logout-link i { font-size: .9em; opacity: .85; width: 16px; text-align: center; }
    .archive-nav-item:hover, .nav-sub-link:hover, .logout-link:hover { background: var(--gray-100); color: var(--gray-900); }
    .archive-nav-item.active { background: var(--primary-soft); color: var(--primary); }
    .nav-user { margin-left: auto; display: flex; align-items: center; gap: var(--sp-1); }
    .session-pill { padding: var(--sp-1) var(--sp-3); background: var(--gray-100); border-radius: 999px; color: var(--gray-700); font-size: 12px; font-weight: 600; white-space: nowrap; }
    .hamburger, .drawer-close { display: none; }

    .app-shell { width: min(1440px, calc(100% - var(--sp-8))); margin: 0 auto; padding: var(--sp-5) 0 var(--sp-8); }
    .login-main { min-height: 100vh; display: grid; place-items: center; padding: var(--sp-4); }
    .login-shell { width: min(920px, 100%); display: grid; grid-template-columns: 1fr 1.05fr; min-height: 520px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow-2); overflow: hidden; }
    .login-side { display: flex; flex-direction: column; justify-content: flex-end; gap: var(--sp-3); padding: var(--sp-8); background: var(--primary-deep); color: var(--surface); }
    .login-side h1 { color: var(--surface); font-size: 24px; }
    .login-side p { color: rgba(255, 255, 255, .82); margin: 0; font-size: 13.5px; }
    .login-logo { width: 48px; height: 48px; display: grid; place-items: center; background: rgba(255, 255, 255, .14); border-radius: var(--r-lg); font-weight: 800; font-size: 15px; letter-spacing: .02em; }
    .login-panel { padding: var(--sp-8); align-self: center; width: 100%; }
    .login-panel h2 { font-size: 19px; margin-bottom: var(--sp-4); }
    .form-foot { margin-top: var(--sp-4); text-align: center; font-size: 13px; }
    .form-foot a { color: var(--gray-500); text-decoration: none; font-weight: 600; }
    .form-foot a:hover { color: var(--primary); }

    .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); margin: var(--sp-1) 0 var(--sp-4); }
    .head-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
    .breadcrumb { display: flex; gap: var(--sp-2); color: var(--gray-500); font-size: 12px; margin-bottom: var(--sp-1); }
    .breadcrumb a { text-decoration: none; }
    .breadcrumb a:hover { color: var(--primary); }

    .search-band { display: grid; gap: var(--sp-3); }
    .viewer-search-form { display: grid; gap: var(--sp-2); }
    .viewer-search-form .search-box input { min-height: 40px; font-size: 14px; }
    .filter-details summary { display: inline-flex; align-items: center; gap: var(--sp-2); width: max-content; padding: var(--sp-1); color: var(--gray-500); font-size: 12.5px; font-weight: 600; cursor: pointer; list-style: none; border-radius: var(--r-sm); }
    .filter-details summary::-webkit-details-marker { display: none; }
    .filter-details summary:hover { color: var(--gray-700); }
    .filter-details summary i { font-size: .85em; }
    .filter-details[open] summary { margin-bottom: var(--sp-2); color: var(--gray-700); }
    .filter-count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 var(--sp-1); border-radius: 999px; background: var(--primary); color: var(--surface); font-size: 11px; font-weight: 700; }
    .viewer-filter-row { display: grid; grid-template-columns: repeat(5, minmax(110px, 1fr)) auto; gap: var(--sp-2); align-items: center; }
    .quick-filter-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); color: var(--gray-500); font-weight: 600; font-size: 12.5px; }
    .viewer-recents:empty { display: none; }
    .quick-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); color: var(--gray-500); font-weight: 600; font-size: 12.5px; }

    .filter-bar { display: grid; gap: var(--sp-2); }
    .search-box { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--sp-2); padding: var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-3); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); transition: border-color .15s ease, box-shadow .15s ease; }
    .search-box:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
    .search-box i { color: var(--gray-400); }
    .search-box input { background: transparent; border: 0; min-height: 36px; padding: 0 var(--sp-1); }
    .search-box input:focus { outline: 0; box-shadow: none; border: 0; background: transparent; }

    input, select, textarea { width: 100%; min-height: 36px; padding: var(--sp-2) var(--sp-3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font: inherit; font-size: 13.5px; transition: border-color .15s ease, box-shadow .15s ease; }
    textarea { resize: vertical; }
    input::placeholder, textarea::placeholder { color: var(--gray-400); }
    input:hover, select:hover, textarea:hover { border-color: var(--gray-300); }
    input:focus, select:focus, textarea:focus { outline: 0; border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
    label { display: block; font-weight: 600; font-size: 12.5px; color: var(--gray-600); }
    label > input, label > select, label > textarea { margin-top: var(--sp-1); }
    em { color: var(--danger); font-style: normal; }

    button, .button { display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2); min-height: 36px; padding: var(--sp-2) var(--sp-4); border: 1px solid transparent; border-radius: var(--r-md); background: var(--primary); color: var(--surface); font: inherit; font-weight: 600; font-size: 13.5px; text-decoration: none; cursor: pointer; white-space: nowrap; transition: background .15s ease, border-color .15s ease, color .15s ease; }
    button:hover, .button:hover { background: var(--primary-strong); }
    .button.secondary, button.secondary, .secondary { background: var(--surface); border-color: var(--line); color: var(--gray-700); }
    .button.secondary:hover, button.secondary:hover, .secondary:hover { background: var(--gray-50); border-color: var(--gray-300); color: var(--gray-900); }
    .danger-button { background: var(--danger-soft); color: var(--danger); border: 1px solid transparent; }
    .danger-button:hover { background: var(--danger); color: var(--surface); }
    .sm { min-height: 30px; padding: var(--sp-1) var(--sp-3); font-size: 12.5px; border-radius: var(--r-sm); }
    .icon-button { min-height: 26px; width: 26px; padding: 0; background: transparent; color: var(--gray-400); border-radius: var(--r-sm); }
    .icon-button:hover { background: var(--gray-100); color: var(--gray-700); }
    .disabled { pointer-events: none; opacity: .45; }
    button:disabled { opacity: .45; pointer-events: none; }
    button:focus-visible, .button:focus-visible, a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

    .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: var(--sp-5); margin-bottom: var(--sp-4); }
    .narrow { max-width: 640px; margin-inline: auto; }
    .content-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, .8fr); gap: var(--sp-4); align-items: start; }
    .viewer-workspace { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(360px, .75fr); gap: var(--sp-4); align-items: start; }
    .viewer-location-panel { position: sticky; top: var(--sp-4); }
    .viewer-secondary { grid-template-columns: minmax(0, 1fr) minmax(280px, .7fr); }
    .two-col, .admin-grid, .rack-grid { display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
    .section-title { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
    .filter-row { display: grid; grid-template-columns: repeat(5, minmax(110px, 1fr)); gap: var(--sp-2); }
    .stack { display: grid; gap: var(--sp-4); }
    .picker-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-2); margin-top: var(--sp-2); }
    .button-group { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }

    .metric-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); margin-bottom: var(--sp-4); }
    .metric-card { padding: var(--sp-4) var(--sp-5); display: grid; gap: var(--sp-1); }
    .metric-card + .metric-card { border-left: 1px solid var(--line); }
    .metric-card span { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .metric-card strong { font-size: 22px; font-weight: 700; line-height: 1.2; letter-spacing: -.02em; }
    .metric-card small { color: var(--gray-500); font-size: 12px; }

    .count-badge { display: inline-flex; align-items: center; padding: 0 var(--sp-2); line-height: 20px; border-radius: 999px; background: var(--gray-100); color: var(--gray-600); font-size: 12px; font-weight: 600; white-space: nowrap; }
    .chip { display: inline-flex; align-items: center; gap: var(--sp-1); padding: var(--sp-1) var(--sp-3); border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--gray-600); font-size: 12.5px; font-weight: 600; text-decoration: none; transition: background .15s ease, color .15s ease, border-color .15s ease; }
    .chip:hover { background: var(--gray-50); color: var(--gray-900); }
    .chip.active { background: var(--primary-soft); border-color: var(--primary-soft); color: var(--primary); }
    .quality-strip { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-4); }
    .quality-strip .warn { display: inline-flex; align-items: center; gap: var(--sp-1); padding: var(--sp-1) var(--sp-3); border-radius: 999px; background: var(--warning-soft); color: var(--warning); font-size: 12.5px; font-weight: 600; }

    .viewer-result-list { display: grid; border-top: 1px solid var(--gray-100); }
    .doc-row { display: grid; grid-template-columns: minmax(150px, 180px) minmax(0, 1fr) auto; gap: var(--sp-4); align-items: center; padding: var(--sp-3) var(--sp-2); border-bottom: 1px solid var(--gray-100); transition: background .15s ease; }
    .doc-row:hover { background: var(--gray-50); }
    /* 폐기 문서만 좌측 회색 레일로 표시(레이아웃 불변 inset). 보관중은 무표시. */
    .doc-row.is-disposed { opacity: .55; box-shadow: inset 3px 0 0 var(--gray-300); }
    .doc-row-loc { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-1); }
    .loc-code { display: block; font-family: var(--font-mono); font-size: 12.5px; font-weight: 600; color: var(--primary); line-height: 1.5; }
    .loc-sub { display: block; margin-top: var(--sp-1); color: var(--gray-500); font-size: 11.5px; line-height: 1.4; }
    .doc-row-main { min-width: 0; }
    .doc-row-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
    .doc-row-title a { font-weight: 600; text-decoration: none; }
    .doc-row-title a:hover { color: var(--primary); text-decoration: underline; }
    .doc-row-meta { display: flex; flex-wrap: wrap; align-items: center; row-gap: var(--sp-1); margin-top: var(--sp-1); color: var(--gray-500); font-size: 12.5px; }
    .doc-row-meta > span + span { margin-left: var(--sp-3); padding-left: var(--sp-3); border-left: 1px solid var(--line); }
    .doc-row-meta .mono { font-size: 12px; }
    .match-line { color: var(--gray-500); }
    .doc-row-actions { display: flex; flex-direction: column; align-items: stretch; gap: var(--sp-1); }

    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    th, td { padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--gray-100); text-align: left; }
    th { background: var(--gray-50); color: var(--gray-600); font-size: 12px; font-weight: 600; white-space: nowrap; border-bottom: 1px solid var(--line); }
    tbody tr { transition: background .12s ease; }
    tbody tr:hover { background: var(--gray-50); }
    tr.is-disposed td { opacity: .55; }
    .check-col { width: 32px; }
    .check-col input { width: auto; min-height: auto; accent-color: var(--primary); }
    .loc-cell { white-space: nowrap; }
    .loc-cell-main { display: block; font-family: var(--font-mono); font-size: 12.5px; font-weight: 600; color: var(--primary); }
    .loc-cell-sub { display: block; color: var(--gray-500); font-size: 11.5px; }
    .mono-cell { font-family: var(--font-mono); font-size: 12.5px; white-space: nowrap; }
    .name-cell a { font-weight: 600; text-decoration: none; }
    .name-cell a:hover { color: var(--primary); text-decoration: underline; }
    .name-cell small { display: block; color: var(--gray-500); font-size: 12px; margin-top: var(--sp-1); }
    .status-cell .status { margin: 0 var(--sp-1) 0 0; }

    .status { display: inline-flex; align-items: center; width: max-content; padding: 0 var(--sp-2); line-height: 20px; border-radius: 999px; font-size: 11.5px; font-weight: 700; }
    .status.active { background: var(--success-soft); color: var(--success); }
    .status.disposed { background: var(--danger-soft); color: var(--danger); }
    .status.pending { background: var(--warning-soft); color: var(--warning); }

    .index-list { display: grid; }
    .index-row { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-1); border-bottom: 1px solid var(--gray-100); text-decoration: none; font-size: 13.5px; font-weight: 600; color: var(--gray-700); transition: color .15s ease; }
    .index-row:last-child { border-bottom: 0; }
    .index-row strong { color: var(--gray-500); font-weight: 600; font-size: 12.5px; }
    .index-row:hover, .index-row:hover strong { color: var(--primary); }
    .tip-list { margin: 0; padding-left: var(--sp-4); color: var(--gray-600); font-size: 13px; display: grid; gap: var(--sp-2); }

    .archive-stage { overflow-x: auto; }
    .archive-map { display: grid; gap: var(--sp-3); min-width: 720px; }
    .rack-zone { border-radius: var(--r-md); padding: var(--sp-4); background: var(--gray-50); }
    .rack-zone h3 { margin: 0 0 var(--sp-2); }
    .rack-zone-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: var(--sp-2); }
    .rack-tile { min-height: 68px; display: grid; place-items: center; gap: 0; padding: var(--sp-2); border-radius: var(--r-sm); background: var(--surface); border: 1px solid var(--line); text-decoration: none; text-align: center; font-size: 12.5px; transition: border-color .15s ease; }
    .rack-tile:hover { border-color: var(--gray-400); }
    .rack-tile.is-hit { background: var(--primary); border-color: var(--primary); color: var(--surface); font-weight: 700; }
    .legend-box { display: inline-block; width: 8px; height: 13px; border-radius: 2px; background: var(--surface); border: 1px solid var(--gray-300); margin-right: var(--sp-1); }
    .legend-box.single { box-shadow: inset 2px 0 0 var(--gray-300); }
    .legend-box.hit { background: var(--primary); border-color: var(--primary); }

    .floor-plan-shell { display: grid; gap: var(--sp-2); }
    /* aspect-ratio는 반드시 도면 이미지 원본 비율(1024x797)과 같아야 퍼센트 오버레이가 어긋나지 않는다. */
    .floor-plan-media { position: relative; overflow: hidden; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--gray-100); aspect-ratio: 1024 / 797; }
    .floor-plan-media img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .floor-region { position: absolute; top: var(--top); left: var(--left); width: var(--width); height: var(--height); border: 1.5px solid rgba(30, 85, 196, .45); border-radius: var(--r-sm); background: rgba(30, 85, 196, .05); }
    .floor-region-label { position: absolute; top: var(--sp-1); left: var(--sp-1); padding: 0 var(--sp-2); line-height: 18px; border-radius: 999px; background: rgba(255, 255, 255, .92); color: var(--primary); font-size: 11px; font-weight: 700; }
    /* 랙 실루엣: 세로로 긴 막대가 구역 안에 좌→우로 늘어선다 (실제 배치 반영). */
    .floor-rack { position: absolute; left: var(--rack-left); top: 50%; transform: translate(-50%, -50%); width: var(--rack-width, 6%); min-width: 8px; height: 76%; display: flex; align-items: flex-start; justify-content: center; padding-top: var(--sp-1); border-radius: 3px; overflow: hidden; background: var(--surface); box-shadow: inset 0 0 0 1px var(--gray-300); color: var(--gray-600); text-decoration: none; font-size: 9px; font-weight: 700; line-height: 1.05; transition: box-shadow .12s ease, background .12s ease; }
    .floor-rack .rack-num { position: relative; z-index: 1; writing-mode: vertical-rl; text-orientation: upright; letter-spacing: -.08em; }
    /* 양면 랙: 좌(N-1면)·우(N-2면)를 세로 점선으로 나눈다. */
    .floor-rack .rack-face { position: absolute; top: 0; bottom: 0; width: 50%; pointer-events: none; transition: background .12s ease; }
    .floor-rack .rack-face-a { left: 0; border-right: 1px dashed var(--gray-400); }
    .floor-rack .rack-face-b { right: 0; }
    /* 면 단위 강조(문서 상세): 문서가 있는 반쪽만 파랗게. */
    .floor-rack[data-face-hit="A"] .rack-face-a,
    .floor-rack[data-face-hit="B"] .rack-face-b { background: var(--primary); }
    .floor-rack[data-face-hit] .rack-num { color: var(--ink); text-shadow: 0 0 2px var(--surface), 0 0 2px var(--surface); }
    .floor-rack:hover { background: var(--gray-100); box-shadow: inset 0 0 0 1.5px var(--gray-400); z-index: 2; }
    .floor-rack.is-single { box-shadow: inset 3px 0 0 var(--gray-300), inset 0 0 0 1px var(--gray-300); }
    .floor-rack.is-hit, .floor-rack.is-single.is-hit { background: var(--primary); color: var(--surface); box-shadow: 0 0 0 2px var(--ring); z-index: 1; }
    .floor-rack.is-hit .rack-face-a { border-right-color: rgba(255, 255, 255, .6); }
    .floor-rack.is-hit:hover { background: var(--primary-strong); }

    /* 구역 확대 도면(문서 상세): 전체 도면을 스케일·이동해 한 구역만 채운다. */
    .floor-zoom { position: relative; width: 100%; overflow: hidden; border-radius: var(--r-md); border: 1px solid var(--gray-100); background: var(--surface); aspect-ratio: var(--z-aw) / var(--z-ah); }
    .floor-zoom-canvas { position: absolute; width: calc(10000% / var(--zw)); height: calc(10000% / var(--zh)); left: calc(var(--zl) * -100% / var(--zw)); top: calc(var(--zt) * -100% / var(--zh)); }
    .floor-zoom-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; display: block; }
    .floor-plan-summary, .zone-list { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; color: var(--gray-500); font-size: 12.5px; }
    .floor-plan-summary span, .zone-list a { display: inline-flex; align-items: center; gap: var(--sp-1); padding: var(--sp-1) var(--sp-3); border-radius: 999px; background: var(--gray-100); text-decoration: none; font-weight: 600; }
    .zone-list a:hover { background: var(--primary-soft); color: var(--primary); }

    .admin-link-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); }
    .admin-link-grid a { min-height: 56px; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-radius: var(--r-md); background: var(--gray-50); border: 1px solid var(--gray-100); text-decoration: none; font-weight: 600; font-size: 13.5px; transition: background .15s ease, color .15s ease, border-color .15s ease; }
    .admin-link-grid a:hover { background: var(--primary-soft); border-color: var(--primary-soft); color: var(--primary); }
    .admin-link-grid a i { color: var(--primary); }
    .admin-tile { display: grid; gap: var(--sp-1); text-decoration: none; transition: border-color .15s ease, background .15s ease; }
    .admin-tile:hover { border-color: var(--gray-300); background: var(--gray-50); }
    .admin-tile small { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .admin-tile strong { font-size: 14px; font-weight: 700; }
    .rack-card { display: grid; gap: var(--sp-1); padding: var(--sp-4); text-decoration: none; transition: border-color .15s ease, background .15s ease; }
    .rack-card:hover { border-color: var(--gray-300); background: var(--gray-50); }
    .rack-card small { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .rack-card strong { font-size: 14px; font-weight: 700; }
    .rack-card span { color: var(--gray-600); font-size: 12.5px; }

    .locator-hero { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); padding: var(--sp-4) var(--sp-5); margin-bottom: var(--sp-4); background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--primary); border-radius: var(--r-lg); }
    .locator-hero small { display: block; color: var(--gray-600); font-size: 12px; font-weight: 600; }
    .locator-hero strong { display: block; font-size: 17px; font-weight: 700; margin: var(--sp-1) 0; }
    .loc-label-lg { color: var(--primary); letter-spacing: -.01em; }
    .locator-hero span { color: var(--gray-500); font-size: 12.5px; }

    .tab-nav { display: flex; gap: var(--sp-4); overflow-x: auto; margin-bottom: var(--sp-4); border-bottom: 1px solid var(--line); }
    .tab-nav button { background: transparent; color: var(--gray-500); min-height: 0; padding: var(--sp-2) var(--sp-1) var(--sp-3); border: 0; border-radius: 0; font-size: 13.5px; font-weight: 600; white-space: nowrap; }
    .tab-nav button:hover { background: transparent; color: var(--gray-800); }
    .tab-nav button[aria-selected="true"] { background: transparent; color: var(--gray-900); box-shadow: inset 0 -2px 0 var(--primary); }
    .tab-count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 var(--sp-1); margin-left: var(--sp-1); border-radius: 999px; background: var(--gray-100); color: var(--gray-600); font-size: 11px; font-weight: 700; }
    .tab-nav button[aria-selected="true"] .tab-count { background: var(--primary-soft); color: var(--primary); }

    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--sp-8); }
    .detail-item { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: baseline; gap: var(--sp-3); padding: var(--sp-2) 0; border-bottom: 1px solid var(--gray-100); }
    .detail-item small { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .detail-item strong { font-weight: 600; font-size: 13.5px; }
    .minimap-card { margin-top: var(--sp-4); }
    .mini-rack-grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(44px, 1fr)); gap: var(--sp-2); }
    .mini-slot { min-height: 44px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--gray-50); border: 1px solid var(--gray-100); position: relative; color: var(--gray-500); font-size: 12px; }
    .mini-slot.active { background: var(--primary); border-color: var(--primary); color: var(--surface); font-weight: 700; }
    .mini-slot i { position: absolute; top: var(--sp-1); right: var(--sp-1); }
    /* 선반 나침반 */
    .mini-rack-stage { display: flex; align-items: stretch; gap: var(--sp-3); }
    .mini-axis { display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--gray-500); padding: var(--sp-1) 0; white-space: nowrap; }
    .mini-rack-stage .mini-rack-grid { flex: 1; }
    .mini-compass { margin: var(--sp-3) 0 0; display: inline-flex; align-items: center; gap: var(--sp-2); font-size: 13px; font-weight: 700; color: var(--primary); background: var(--primary-soft); border-radius: 999px; padding: var(--sp-2) var(--sp-3); font-variant-numeric: tabular-nums; }

    .timeline-container { display: grid; gap: var(--sp-2); }
    .timeline-item { display: grid; grid-template-columns: 14px 1fr; gap: var(--sp-2); }
    .timeline-badge { width: 8px; height: 8px; margin-top: var(--sp-2); border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
    .timeline-content { border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); background: var(--gray-50); }
    .timeline-content p { margin: var(--sp-1) 0 0; color: var(--gray-600); font-size: 12.5px; }
    .timeline-header { display: flex; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }
    .timeline-header strong { font-weight: 600; font-size: 13px; }
    .timeline-header span { color: var(--gray-500); font-size: 12px; }

    .alert { padding: var(--sp-3) var(--sp-4); border-radius: var(--r-md); margin-bottom: var(--sp-3); font-weight: 500; font-size: 13px; }
    .alert.danger { background: var(--danger-soft); color: var(--danger); }
    .alert.warning { background: var(--warning-soft); color: var(--warning); }
    .alert.success { background: var(--success-soft); color: var(--success); }
    .empty-state { display: grid; place-items: center; gap: var(--sp-2); padding: var(--sp-8) var(--sp-4); text-align: center; color: var(--gray-500); font-size: 13px; border-radius: var(--r-md); background: var(--gray-50); border: 1px dashed var(--gray-200); }
    .empty-state i { font-size: 22px; color: var(--gray-300); }
    .empty-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); justify-content: center; }

    .bulk-bar { position: sticky; bottom: var(--sp-4); z-index: 20; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); margin-top: var(--sp-3); background: var(--gray-900); color: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-2); font-size: 13px; }
    .bulk-bar[hidden] { display: none; }
    .bulk-bar form { display: flex; flex: 1; gap: var(--sp-2); }
    .bulk-bar input { background: rgba(255, 255, 255, .12); color: var(--surface); border-color: transparent; min-height: 32px; }
    .bulk-bar input::placeholder { color: rgba(255, 255, 255, .55); }
    .bulk-bar input:focus { background: rgba(255, 255, 255, .18); border-color: rgba(255, 255, 255, .4); box-shadow: none; }
    .bulk-reason { flex: 1; color: var(--surface); }
    .pagination { display: flex; justify-content: center; align-items: center; gap: var(--sp-3); margin-top: var(--sp-4); color: var(--gray-600); font-weight: 600; font-size: 12.5px; }

    .check-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--sp-2); border-radius: var(--r-md); padding: var(--sp-3); background: var(--gray-50); border: 0; }
    .check-item, .check-inline { display: inline-flex; align-items: center; gap: var(--sp-2); width: max-content; font-weight: 500; font-size: 13px; color: var(--ink); }
    .check-item input, .check-inline input { width: auto; min-height: auto; accent-color: var(--primary); }
    .master-list { display: grid; gap: var(--sp-2); }
    .master-row, .master-form { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto auto; gap: var(--sp-2); align-items: center; }

    .manual-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--sp-3); }
    .manual-list li { display: grid; gap: var(--sp-1); padding-bottom: var(--sp-3); border-bottom: 1px solid var(--gray-100); }
    .manual-list li:last-child { border-bottom: 0; padding-bottom: 0; }
    .manual-list strong { font-size: 13.5px; }
    .manual-list span { color: var(--gray-500); font-size: 12.5px; }
    .contact-list { margin: 0; display: grid; gap: var(--sp-2); }
    .contact-list div { display: flex; justify-content: space-between; gap: var(--sp-3); }
    .contact-list dt { color: var(--gray-500); font-size: 12.5px; font-weight: 600; }
    .contact-list dd { margin: 0; font-size: 13px; font-weight: 600; }

    .modal { border: 0; border-radius: var(--r-lg); padding: 0; width: min(440px, calc(100% - var(--sp-8))); box-shadow: var(--shadow-2); }
    .modal::backdrop { background: var(--scrim); }
    .modal-body { padding: var(--sp-5); display: grid; gap: var(--sp-4); }
    .modal-actions { display: flex; justify-content: flex-end; gap: var(--sp-2); }
    .danger-text { color: var(--danger); font-size: 13px; margin: 0; }

    .cmd-palette { border: 0; border-radius: var(--r-lg); width: min(600px, calc(100% - var(--sp-8))); padding: 0; box-shadow: var(--shadow-2); }
    .cmd-palette::backdrop { background: var(--scrim); }
    .cmd-search-wrap { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--gray-100); }
    .cmd-search-wrap input { border: 0; outline: 0; background: transparent; }
    .cmd-search-wrap input:focus { box-shadow: none; background: transparent; }
    .cmd-icon { color: var(--gray-400); }
    .cmd-results { padding: var(--sp-2); display: grid; gap: var(--sp-1); }
    .cmd-item { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-radius: var(--r-md); text-decoration: none; font-weight: 500; font-size: 13.5px; }
    .cmd-item:hover { background: var(--primary-soft); color: var(--primary); }

    .app-toast { position: fixed; left: 50%; bottom: var(--sp-6); transform: translate(-50%, var(--sp-3)); z-index: 200; max-width: min(90vw, 420px); padding: var(--sp-3) var(--sp-5); border-radius: var(--r-md); background: var(--gray-800); color: var(--surface); font-weight: 600; font-size: 13px; box-shadow: var(--shadow-2); opacity: 0; transition: opacity .2s ease, transform .2s ease; pointer-events: none; }
    .app-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
    .app-toast.is-error { background: var(--danger); }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

    .set-doc-table td strong { white-space: nowrap; font-size: 12.5px; font-weight: 600; color: var(--primary); }
    .set-doc-table tr.is-disposed td { opacity: .55; }
    .set-add-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-5); }
    .set-candidate-list { display: grid; gap: var(--sp-2); }
    .set-candidate { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); border-radius: var(--r-md); padding: var(--sp-2) var(--sp-3); background: var(--gray-50); font-size: 13px; }
    .set-candidate small { display: block; color: var(--gray-500); font-size: 12px; }
    .set-candidate.is-disposed { opacity: .55; }
    .set-danger-row { margin-top: var(--sp-5); display: flex; justify-content: flex-end; }

    mark { background: var(--primary-soft); color: var(--primary); border-radius: 2px; padding: 0; font-weight: inherit; }

    .search-home { width: min(880px, 100%); margin: 0 auto; padding-top: clamp(16px, 6vh, 72px); display: grid; gap: var(--sp-4); }
    .search-home .viewer-search-form.is-home { width: min(720px, 100%); justify-self: center; }
    .home-floor-plan { width: 100%; }
    .search-home-hero { display: grid; gap: var(--sp-2); justify-items: center; text-align: center; }
    .search-home-mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: var(--r-lg); background: var(--primary); color: var(--surface); font-size: 20px; }
    .search-home-hero h1 { font-size: 22px; }
    .search-home-sub { margin: 0; color: var(--gray-500); font-size: 13.5px; }
    .search-home .search-box input { min-height: 44px; font-size: 15px; }
    .search-home .viewer-recents { justify-content: center; }
    .search-home-extras { display: grid; gap: var(--sp-4); }
    .search-home-links { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-2); }
    .search-home-links a { display: inline-flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-4); border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--gray-600); font-size: 12.5px; font-weight: 600; text-decoration: none; transition: background .15s ease, color .15s ease, border-color .15s ease; }
    .search-home-links a:hover { background: var(--primary-soft); border-color: var(--primary-soft); color: var(--primary); }
    .search-home-links a i { font-size: .9em; }
    .viewer-workspace.is-home { grid-template-columns: 1fr; }

    .parsed-chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); color: var(--gray-500); font-size: 12.5px; font-weight: 600; }
    .chip-panel { padding: var(--sp-3) var(--sp-5); }

    .answer-card { display: grid; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5); margin: var(--sp-2) 0 var(--sp-4); background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--primary); border-radius: var(--r-lg); }
    .answer-head { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
    .answer-label { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .answer-grade { font-size: 11px; font-weight: 700; padding: 2px var(--sp-2); border-radius: 999px; }
    .answer-grade.certain { background: var(--success-soft); color: var(--success); }
    .answer-grade.likely { background: var(--warning-soft); color: var(--warning); }
    .answer-loc { font-family: var(--font-mono); font-size: 22px; font-weight: 700; line-height: 1.25; color: var(--primary); letter-spacing: -.01em; }
    .answer-loc span { display: inline-block; margin-left: var(--sp-3); color: var(--gray-900); }
    .answer-doc { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
    .answer-doc > a { font-weight: 700; font-size: 15px; text-decoration: none; }
    .answer-doc > a:hover { color: var(--primary); text-decoration: underline; }
    .answer-meta { width: 100%; display: flex; flex-wrap: wrap; gap: var(--sp-3); color: var(--gray-500); font-size: 12.5px; }
    .answer-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
    .rest-label { margin: 0 0 var(--sp-2); color: var(--gray-600); font-size: 12px; font-weight: 600; }

    .didyoumean { display: grid; gap: var(--sp-2); margin-top: var(--sp-3); padding: var(--sp-4); background: var(--gray-50); border-radius: var(--r-md); }
    .didyoumean p { margin: 0; color: var(--gray-600); font-size: 13px; font-weight: 600; }
    .didyoumean a { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2); text-decoration: none; font-size: 13.5px; }
    .didyoumean a strong { font-weight: 600; }
    .didyoumean a:hover strong { color: var(--primary); text-decoration: underline; }
    .didyoumean a .mono { color: var(--gray-500); font-size: 12px; }
    .didyoumean a small { color: var(--gray-500); font-size: 12px; }

    @media (min-width: 1100px) {
      .topbar { position: fixed; inset: 0 auto 0 0; width: 240px; flex-direction: column; align-items: stretch; padding: var(--sp-4) var(--sp-3); border-right: 1px solid var(--line); border-bottom: 0; }
      .topbar nav { flex-direction: column; align-items: stretch; gap: var(--sp-1); }
      .brand { padding: var(--sp-1) var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--line); margin-bottom: var(--sp-2); }
      .archive-nav-item, .nav-sub-link, .logout-link { justify-content: flex-start; }
      .nav-user { margin: auto 0 0; flex-direction: column; align-items: stretch; gap: var(--sp-1); padding-top: var(--sp-2); border-top: 1px solid var(--line); }
      .session-pill { border-radius: var(--r-md); white-space: normal; text-align: center; }
      .topbar + .app-shell { width: auto; max-width: 1440px; margin-left: calc(240px + var(--sp-6)); margin-right: var(--sp-6); }
      .hamburger, .drawer-close, .nav-scrim { display: none; }
    }
    @media (max-width: 1180px) {
      .viewer-workspace { grid-template-columns: 1fr; }
      .viewer-location-panel { position: static; }
      .viewer-filter-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 1099px) {
      .topbar { justify-content: space-between; }
      .hamburger { display: inline-flex; flex-direction: column; justify-content: center; align-items: center; gap: var(--sp-1); width: 36px; min-height: 36px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); border-radius: var(--r-md); padding: 0; }
      .hamburger:hover { background: var(--gray-50); }
      .hamburger span { display: block; width: 16px; height: 2px; background: currentColor; border-radius: 2px; }
      .drawer-close { display: inline-flex; align-self: flex-end; width: 32px; min-height: 32px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); border-radius: var(--r-md); font-size: 15px; padding: 0; }
      .drawer-close:hover { background: var(--gray-50); }
      .topbar nav { position: fixed; inset: 0 0 0 auto; width: min(320px, 86vw); background: var(--surface); padding: var(--sp-4); flex-direction: column; align-items: stretch; transform: translateX(100%); transition: transform .22s ease; box-shadow: var(--shadow-2); z-index: 60; }
      .topbar nav.is-open { transform: translateX(0); }
      .nav-user { margin: auto 0 0; flex-direction: column; align-items: stretch; padding-top: var(--sp-2); border-top: 1px solid var(--line); }
      .nav-scrim.is-open { position: fixed; inset: 0; background: var(--scrim); z-index: 55; }
    }
    @media (max-width: 1020px) {
      .content-grid { grid-template-columns: 1fr; }
      .filter-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .detail-grid { grid-template-columns: 1fr; gap: 0; }
    }
    @media print {
      .topbar, .cmd-palette, .skip-nav, .nav-scrim, .button, button, form, .set-admin-tools, .archive-map, .app-toast { display: none !important; }
      body { background: var(--surface); }
      .app-shell { width: 100%; padding: 0; }
      .panel { border: 1px solid var(--gray-300); }
      th, td { border-bottom: 1px solid var(--gray-300); }
    }
    @media (max-width: 760px) {
      .app-shell { width: calc(100% - var(--sp-6)); padding-top: var(--sp-3); }
      .login-shell { grid-template-columns: 1fr; min-height: auto; }
      .login-side { display: none; }
      .login-panel { padding: var(--sp-6) var(--sp-5); }
      h1 { font-size: 17px; }
      .page-head, .locator-hero { flex-direction: column; align-items: stretch; }
      .search-box { grid-template-columns: auto minmax(0, 1fr); }
      .search-box button { grid-column: 1 / -1; width: 100%; }
      .filter-row, .viewer-filter-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .master-row, .master-form, .admin-link-grid, .set-add-grid { grid-template-columns: 1fr; }
      .doc-row { grid-template-columns: 1fr; gap: var(--sp-2); align-items: start; padding: var(--sp-3) var(--sp-2); }
      .doc-row-actions { flex-direction: row; justify-content: flex-start; }
      .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric-card + .metric-card { border-left: 0; }
      .metric-card:nth-child(even) { border-left: 1px solid var(--line); }
      .metric-card:nth-child(n+3) { border-top: 1px solid var(--line); }
      .panel { padding: var(--sp-4); }
      .floor-rack { font-size: 8px; }
      .answer-loc { font-size: 19px; }
      .answer-loc span { display: block; margin-left: 0; }
      .answer-actions .button { flex: 1 1 auto; justify-content: center; }
      .search-home { padding-top: var(--sp-4); }
      .bulk-bar, .bulk-bar form { flex-direction: column; align-items: stretch; }
      .app-toast { bottom: var(--sp-4); width: calc(100vw - var(--sp-8)); max-width: none; text-align: center; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    }
  `;
}
