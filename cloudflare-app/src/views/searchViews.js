// 검색 뷰어(/app)·Q&A·검색 리포트 화면.

import { escapeHtml } from "../ui/html/escape.js";
import { safeEmbeddedJson } from "../platform/web/renderContext.js";
import { searchCoreScript } from "./clientScript.js";
import { alertWarning, emptyResult, emptyState, filterSelectRow, listUrl, page, paginationNav, sectionHeader, statusBadge } from "./layout.js";
import {
  didYouMeanView,
  highlight,
  parsedChipRow,
  searchInputBlock
} from "./searchFragments.js";

export { didYouMeanView, highlight, parsedChipRow, searchInputBlock };

export function dashboardPage({
  session,
  query,
  viewerSearch = { items: [], pagination: { totalItems: 0, totalPages: 1, page: 1, pageSize: 12 }, facets: {}, suggestions: [] },
  categories = [],
  tags = [],
  filters = {},
  parsedQuery = null,
  didYouMean = [],
  mode = "results"
}) {
  const viewerContext = safeEmbeddedJson({
    categories: categories.map((item) => ({ id: Number(item.id), name: String(item.name || "") })),
    tags: tags.map((item) => ({ id: Number(item.id), name: String(item.name || "") }))
  });

  // 홈 모드: 운영 히어로 안에서 검색 입력이 첫 포커스 작업이 되도록 한다.
  if (mode === "home") {
    return page("문서 검색", `
      <section class="search-home" data-search-home>
        <section class="search-home-hero" aria-labelledby="viewer-title">
          <div class="search-home-copy">
            <p class="hero-kicker">Hanlim archive search</p>
            <h1 id="viewer-title">찾고 싶은 문서를<br>한 번에 찾아보세요.</h1>
            <p class="search-home-sub">문서명, 문서번호, 대분류 또는 보관 위치를 입력하면 가장 가까운 결과부터 보여드립니다.</p>
          </div>
          ${viewerSearchForm({ query: "", suggestions: [], categories, tags, filters, home: true })}
          <div class="quick-row viewer-recents" data-recent-searches></div>
        </section>
        <p class="search-live-status" data-search-live aria-live="polite">검색어를 입력하면 보관중 문서를 바로 찾습니다.</p>
        <div data-home-extras>${homeQuickLinks(categories)}</div>

        <section class="viewer-workspace is-home" data-viewer-app hidden>
          <article class="panel results-panel" aria-labelledby="viewer-results-title" data-viewer-results aria-live="polite">
            <div class="section-title">
              <h2 id="viewer-results-title" data-results-title>검색 결과</h2>
              <span class="count-badge" data-results-count>0건</span>
            </div>
            <div data-results-body></div>
          </article>
        </section>

      </section>
      <script type="application/json" data-viewer-context>${viewerContext}</script>
      ${searchCoreScript()}
    `, session);
  }

  // 검색 모드: 고정 열의 행 목록만 보여 주어 비교와 스캔을 우선한다.
  const documents = viewerSearch.items || [];
  const suggestions = viewerSearch.suggestions || [];
  const totalItems = Number(viewerSearch.pagination?.totalItems || 0);

  return page("문서 검색", `
    <section class="search-band operation-hero" aria-labelledby="viewer-title">
      <div>
        <p class="hero-kicker">Smart document search</p>
        <h1 id="viewer-title">${query ? `“${escapeHtml(query)}” 검색 결과` : "문서 검색"}</h1>
        <p class="page-sub">문서명과 문서번호를 함께 해석해 위치를 빠르게 비교합니다.</p>
      </div>
      ${viewerSearchForm({ query, suggestions, categories, tags, filters, showFilters: false, formId: "viewer-search-form" })}
    </section>
    <section class="panel search-results-controls" aria-label="검색 조건" data-auto-submit>
      <div class="desktop-filter-controls"><details class="filter-details" open>
        <summary><i class="fa-solid fa-sliders"></i>상세 필터${activeFilterBadge(filters)}</summary>
        ${filterSelectRow({ categories, tags, filters, viewer: true, formId: "viewer-search-form" })}
      </details></div>
      <button type="button" class="button secondary mobile-search-filter-button" data-open-modal="viewer-filter-dialog"><i class="fa-solid fa-sliders" aria-hidden="true"></i>검색 필터${activeFilterBadge(filters)}</button>
      <p class="search-live-status" data-search-live aria-live="polite">${totalItems ? `${totalItems}건을 찾았습니다.` : "검색 결과가 없습니다."}</p>
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
          ${viewerDocumentResults(documents, query)}
          ${!documents.length && didYouMean.length ? didYouMeanView(didYouMean) : ""}
          ${viewerPagination(viewerSearch.pagination, { query, filters })}
        </div>
      </article>

    </section>
    ${mobileViewerFilterDialog({ query, categories, tags, filters })}
    <script type="application/json" data-viewer-context>${viewerContext}</script>
    ${searchCoreScript()}
  `, session);
}

function viewerSearchForm({ query, suggestions, categories, tags, filters, home = false, showFilters = true, formId = "" }) {
  const activeFilterCount = [filters.categoryId, filters.tagId, filters.zoneNumber, filters.status && filters.status !== "active"].filter(Boolean).length;
  return `
    <form method="get" action="/app"${formId ? ` id="${escapeHtml(formId)}"` : ""} class="viewer-search-form ${home ? "is-home" : ""}" data-search-form data-viewer-form data-auto-submit>
      ${searchInputBlock(query, suggestions)}
      ${showFilters ? `<details class="filter-details" open>
        <summary><i class="fa-solid fa-sliders"></i>상세 필터${activeFilterCount ? `<span class="filter-count">${activeFilterCount}</span>` : ""}</summary>
        ${filterSelectRow({ categories, tags, filters, viewer: true })}
      </details>` : ""}
    </form>
  `;
}

function activeFilterBadge(filters = {}) {
  const count = [filters.categoryId, filters.tagId, filters.zoneNumber, filters.status && filters.status !== "active"].filter(Boolean).length;
  return count ? `<span class="filter-count">${count}</span>` : "";
}

function mobileViewerFilterDialog({ query, categories, tags, filters }) {
  return `<dialog id="viewer-filter-dialog" class="mobile-filter-dialog" aria-labelledby="viewer-filter-dialog-title">
    <form method="get" action="/app" class="mobile-filter-form">
      <div class="mobile-filter-head"><div><small>문서 검색</small><h2 id="viewer-filter-dialog-title">상세 필터</h2></div><button type="button" class="icon-button" data-close-modal aria-label="필터 닫기">×</button></div>
      <input type="hidden" name="q" value="${escapeHtml(query)}">
      ${filterSelectRow({ categories, tags, filters, viewer: true })}
      <div class="mobile-filter-actions"><a class="button secondary" href="/app${query ? `?q=${encodeURIComponent(query)}` : ""}">필터 초기화</a><button type="submit" class="button action-button">결과 보기</button></div>
    </form>
  </dialog>`;
}

function homeQuickLinks(categories = []) {
  const categoryLinks = categories.slice(0, 6).map((category) =>
    `<a class="chip" href="/app?category=${Number(category.id)}">${escapeHtml(category.name)}</a>`
  ).join("");
  if (!categoryLinks) return "";
  return `<nav class="search-home-filter quick-filter-row" aria-label="빠른 분류"><span>빠른 분류</span>${categoryLinks}</nav>`;
}

function viewerDocumentResults(documents, query) {
  if (!documents.length) {
    return emptyResult("조건에 맞는 문서가 없습니다.");
  }
  return `<div class="viewer-result-table" role="table" aria-label="문서 검색 결과">
    <div class="viewer-result-header" role="row"><span>문서명</span><span>문서번호</span><span>개정</span><span>제·개정일</span><span>대분류</span><span>보관 위치</span><span>상태</span></div>
    <div class="viewer-result-list" role="rowgroup">${documents.map((document) => viewerDocumentCard(document, query)).join("")}</div>
  </div>`;
}

function viewerDocumentCard(document, query = "") {
  const location = document.location || {};
  const locationText = location.label || "위치 미지정";
  return `
    <article class="viewer-result-row ${document.status !== "active" ? "is-disposed" : ""}" role="row">
      <span class="viewer-result-name" role="cell" data-label="문서명"><a href="/documents/${document.id}" data-doc-click="${document.id}">${highlight(document.documentName || "문서명 없음", query)}</a></span>
      <span class="mono" role="cell" data-label="문서번호">${highlight(document.documentNumber, query)}</span>
      <span role="cell" data-label="개정">${escapeHtml(document.revisionNumber || "-")}</span>
      <span role="cell" data-label="제·개정일">${escapeHtml(document.revisionDate || "-")}</span>
      <span role="cell" data-label="대분류">${escapeHtml(document.categoryName || "-")}</span>
      <span class="viewer-result-location" role="cell" data-label="보관 위치">${escapeHtml(locationText)}</span>
      <span role="cell" data-label="상태">${statusBadge(document.status)}</span>
    </article>
  `;
}

function viewerPagination(pagination = {}, { query, filters }) {
  const totalPages = Number(pagination.totalPages || 1);
  if (totalPages <= 1) return "";
  const page = Number(pagination.page || 1);
  return paginationNav(page, totalPages, {
    previousUrl: viewerUrl({ query, filters, page: Math.max(1, page - 1) }),
    nextUrl: viewerUrl({ query, filters, page: Math.min(totalPages, page + 1) })
  });
}

function viewerUrl({ query, filters = {}, patch = {}, page = 1 }) {
  return listUrl("/app", { query, filters: { ...filters, ...patch }, page }, [
    ["category", "categoryId"],
    ["tag", "tagId"],
    ["zone", "zoneNumber"],
    ["rack", "rackId"],
    ["face", "rackFace"],
    ["column", "columnNumber"],
    ["shelf", "shelfNumber"],
    ["status", "status"],
    ["sort", "sort"]
  ]);
}

export function qaPage({ session, support = {} }) {
  const contactName = [support.department, support.name].filter(Boolean).join(" / ");
  const contactEmail = support.email || "";
  return page("Q&A", `
    <section class="page-head">
      <h1>Q&amp;A</h1>
      ${contactEmail ? `<a class="button secondary" href="mailto:${escapeHtml(contactEmail)}">담당자 문의</a>` : ""}
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
          <div><dt>부서 / 이름</dt><dd>${escapeHtml(contactName || "운영 관리자에게 문의하세요.")}</dd></div>
          ${contactEmail ? `<div><dt>이메일</dt><dd><a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></dd></div>` : ""}
        </dl>
      </article>
    </section>
  `, session);
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
              <td><a class="button secondary sm" href="/tags?name=${encodeURIComponent(row.query_text)}">태그 보강</a></td>
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
