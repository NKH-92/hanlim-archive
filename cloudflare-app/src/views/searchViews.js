// 검색 뷰어(/app)·Q&A·검색 리포트 화면.

import { escapeHtml } from "../ui/html/escape.js";
import { safeEmbeddedJson } from "../platform/web/renderContext.js";
import { capabilitiesFromSession } from "../domains/identity/index.js";
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
  viewerSearch = { items: [], pagination: { totalItems: 0, totalPages: 1, page: 1, pageSize: 30 }, facets: {}, suggestions: [] },
  categories = [],
  tags = [],
  filters = {},
  parsedQuery = null,
  didYouMean = [],
  editableSets = [],
  selectedDocumentIds = [],
  mode = "results"
}) {
  const capabilities = capabilitiesFromSession(session);
  const viewerContext = safeEmbeddedJson({
    categories: categories.map((item) => ({ id: Number(item.id), name: String(item.name || "") })),
    tags: tags.map((item) => ({ id: Number(item.id), name: String(item.name || "") }))
  });
  const documents = viewerSearch.items || [];
  const suggestions = viewerSearch.suggestions || [];
  const totalItems = Number(viewerSearch.pagination?.totalItems || 0);

  // 홈 모드: 검색을 먼저 두되 서버가 기본 30행을 함께 제공한다.
  if (mode === "home") {
    return page("문서", `
      <section class="search-home" data-search-home>
        <section class="search-home-hero" aria-labelledby="viewer-title">
          <div class="search-home-copy">
            <h1 id="viewer-title">문서를 빠르게 찾으세요.</h1>
            <p class="search-home-sub">문서명, 문서번호, 대분류 또는 보관 위치를 입력하면 가장 가까운 결과부터 보여드립니다.</p>
          </div>
          ${viewerSearchForm({ query: "", suggestions: [], categories, tags, filters, home: true })}
          <div class="quick-row viewer-recents" data-recent-searches></div>
        </section>
        <p class="search-live-status" data-search-live aria-live="polite">${totalItems ? `최근 등록·수정 문서 ${totalItems}건을 표시합니다.` : "보관 중인 문서가 없습니다."}</p>
        <div data-home-extras>${homeQuickLinks(categories)}</div>

        <section class="viewer-workspace is-home" data-viewer-app>
          <article class="panel results-panel" aria-labelledby="viewer-results-title" data-viewer-results aria-live="polite">
            <div class="section-title viewer-results-heading">
              <h2 id="viewer-results-title" data-results-title>최근 등록·수정 문서</h2>
              <div class="viewer-result-tools">
                ${capabilities.canManageSets || capabilities.canManageDisposals ? `<label class="bulk-select-all-label"><input type="checkbox" data-bulk-select-all> 현재 목록 선택</label>` : ""}
                ${columnSettings()}
                <span class="count-badge" data-results-count>${totalItems}건</span>
              </div>
            </div>
            <div data-results-body>
              ${viewerDocumentResults(documents, "", capabilities, selectedDocumentIds)}
              ${viewerPagination(viewerSearch.pagination, { query: "", filters })}
            </div>
          </article>
          ${workspacePreview()}
          ${workspaceBulkActions({ capabilities, editableSets, returnTo: "/app" })}
        </section>

      </section>
      <script type="application/json" data-viewer-context>${viewerContext}</script>
      ${searchCoreScript()}
    `, session);
  }

  // 검색 모드: 고정 열의 행 목록만 보여 주어 비교와 스캔을 우선한다.
  return page("문서", `
    <section class="search-band page-head search-workspace-head" aria-labelledby="viewer-title">
      <div>
        <h1 id="viewer-title">${query ? `“${escapeHtml(query)}” 검색 결과` : "문서"}</h1>
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
      ${activeFilterChips({ query, filters, categories, tags })}
      <div class="quick-row viewer-recents" data-recent-searches></div>
    </section>

    <section class="viewer-workspace" data-viewer-app>
      <article class="panel results-panel" aria-labelledby="viewer-results-title" data-viewer-results aria-live="polite">
        <div class="section-title viewer-results-heading">
          <h2 id="viewer-results-title" data-results-title>${query ? `"${escapeHtml(query)}" 검색 결과` : "최근 등록·수정 문서"}</h2>
          <div class="viewer-result-tools">
            ${capabilities.canManageSets || capabilities.canManageDisposals ? `<label class="bulk-select-all-label"><input type="checkbox" data-bulk-select-all> 현재 목록 선택</label>` : ""}
            ${columnSettings()}
            <span class="count-badge" data-results-count>${totalItems}건</span>
          </div>
        </div>
        <div data-results-body>
          ${viewerDocumentResults(documents, query, capabilities, selectedDocumentIds)}
          ${!documents.length && didYouMean.length ? didYouMeanView(didYouMean) : ""}
          ${viewerPagination(viewerSearch.pagination, { query, filters })}
        </div>
      </article>
      ${workspacePreview()}
      ${workspaceBulkActions({ capabilities, editableSets, returnTo: viewerUrl({ query, filters, page: viewerSearch.pagination?.page || 1 }) })}
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

function viewerDocumentResults(documents, query, capabilities = {}, selectedDocumentIds = []) {
  if (!documents.length) {
    return emptyResult("조건에 맞는 문서가 없습니다.");
  }
  const selectable = capabilities.canManageSets || capabilities.canManageDisposals;
  const selected = new Set(selectedDocumentIds.map(Number));
  return `<div class="viewer-result-table ${selectable ? "is-selectable" : ""}" role="table" aria-label="문서 검색 결과">
    <div class="viewer-result-header" role="row">${selectable ? `<span class="check-col"><span class="sr-only">선택</span></span>` : ""}<span>문서명</span><span>문서번호 · 개정</span><span>대분류</span><span>보관 위치</span><span>상태</span><span class="optional-column" data-column="revision-date" hidden>제·개정일</span></div>
    <div class="viewer-result-list" role="rowgroup">${documents.map((document) => viewerDocumentCard(document, query, selectable, selected.has(Number(document.id)))).join("")}</div>
  </div>`;
}

function viewerDocumentCard(document, query = "", selectable = false, selected = false) {
  const location = document.location || {};
  const locationText = location.label || "위치 미지정";
  return `
    <article class="viewer-result-row ${selectable ? "is-selectable" : ""} ${document.status !== "active" ? "is-disposed" : ""}" role="row" tabindex="0" data-document-row data-document-url="/documents/${document.id}" data-document-name="${escapeHtml(document.documentName || "문서명 없음")}" data-document-number="${escapeHtml(document.documentNumber || "")}" data-document-revision="${escapeHtml(document.revisionNumber || "-")}" data-document-category="${escapeHtml(document.categoryName || "-")}" data-document-location="${escapeHtml(locationText)}" data-document-status="${document.status === "active" ? "보관중" : "폐기"}">
      ${selectable ? `<span class="check-col" role="cell" data-label="선택"><input type="checkbox" value="${Number(document.id)}" data-bulk-item aria-label="${escapeHtml(document.documentName || document.documentNumber)} 선택"${selected ? " checked" : ""}></span>` : ""}
      <span class="viewer-result-name" role="cell" data-label="문서명"><a href="/documents/${document.id}" data-doc-click="${document.id}">${highlight(document.documentName || "문서명 없음", query)}</a></span>
      <span class="mono" role="cell" data-label="문서번호 · 개정">${highlight(document.documentNumber, query)} <small>${escapeHtml(document.revisionNumber || "-")}</small></span>
      <span role="cell" data-label="대분류">${escapeHtml(document.categoryName || "-")}</span>
      <span class="viewer-result-location" role="cell" data-label="보관 위치">${escapeHtml(locationText)}</span>
      <span role="cell" data-label="상태">${statusBadge(document.status)}</span>
      <span class="optional-column" data-column="revision-date" role="cell" data-label="제·개정일" hidden>${escapeHtml(document.revisionDate || "-")}</span>
    </article>
  `;
}

function columnSettings() {
  return `<details class="column-settings"><summary><i class="fa-solid fa-table-columns" aria-hidden="true"></i>열 설정</summary><label><input type="checkbox" data-column-toggle="revision-date"> 제·개정일</label></details>`;
}

function workspacePreview() {
  return `<aside class="panel viewer-preview" data-document-preview hidden aria-live="polite">
    <div class="section-title"><h2>빠른 미리보기</h2><button type="button" class="icon-button" data-preview-close aria-label="미리보기 닫기">×</button></div>
    <strong data-preview-name></strong>
    <p class="mono" data-preview-number></p>
    <dl><div><dt>대분류</dt><dd data-preview-category></dd></div><div><dt>보관 위치</dt><dd data-preview-location></dd></div><div><dt>상태</dt><dd data-preview-status></dd></div></dl>
    <a class="button" href="/app" data-preview-link>문서 상세 열기</a>
  </aside>`;
}

function workspaceBulkActions({ capabilities, editableSets = [], returnTo }) {
  if (!capabilities.canManageSets && !capabilities.canManageDisposals) return "";
  const setForm = capabilities.canManageSets && editableSets.length ? `<form method="post" action="/sets/0/add" class="workspace-set-form" data-set-selection-form>
    <label><span class="sr-only">추가할 준비 문서 세트</span><select name="setTarget" required data-set-target><option value="">세트 선택</option>${editableSets.map((set) => `<option value="${Number(set.id)}" data-version="${Number(set.row_version || 0)}">${escapeHtml(set.name)}</option>`).join("")}</select></label>
    <input type="hidden" name="documentIds" data-bulk-ids>
    <input type="hidden" name="expectedRowVersion" data-set-version>
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    <button type="submit" class="button secondary sm">세트에 추가</button>
  </form>` : "";
  const disposalButton = capabilities.canManageDisposals
    ? `<button type="button" class="danger-button sm" data-open-modal="workspace-disposal-modal" data-disposal-limit="10">선택 문서 폐기</button>`
    : "";
  const disposalDialog = capabilities.canManageDisposals ? `<dialog id="workspace-disposal-modal" class="modal disposal-review-modal" aria-labelledby="workspace-disposal-title">
    <form method="post" action="/documents/disposal/process" class="modal-body" data-bulk-form>
      <h2 id="workspace-disposal-title">선택 문서 폐기</h2>
      <p>한 번에 최대 10건을 처리합니다. 실제 원본과 선택 수량이 같은지 확인하세요.</p>
      <p>실제 폐기할 원본이 <strong data-bulk-confirm-count>0부</strong>가 맞습니까?</p>
      <ol class="disposal-review-list" data-bulk-summary></ol>
      <input type="hidden" name="ids" data-bulk-ids>
      <input type="hidden" name="confirmedTargetCount" value="0" data-bulk-confirm-count-input>
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
      <label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label>
      <label>승인 문서 참조<input name="approvalReference"></label>
      <div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button" name="confirmDisposal" value="1" data-bulk-confirm-button disabled>예, 폐기합니다</button></div>
    </form>
  </dialog>` : "";
  return `<div class="bulk-bar workspace-bulk-bar" data-bulk-bar data-document-selection hidden><span data-bulk-count>0건 선택</span>${setForm}${disposalButton}</div>${disposalDialog}`;
}

function activeFilterChips({ query, filters = {}, categories = [], tags = [] }) {
  const chips = [];
  const add = (label, patch) => chips.push(`<a class="chip active" href="${viewerUrl({ query, filters, patch })}">${escapeHtml(label)} <span aria-hidden="true">×</span></a>`);
  if (filters.categoryId) add(categories.find((item) => Number(item.id) === Number(filters.categoryId))?.name || "대분류", { categoryId: 0 });
  if (filters.tagId) add(tags.find((item) => Number(item.id) === Number(filters.tagId))?.name || "태그", { tagId: 0 });
  if (filters.zoneNumber) add(`${filters.zoneNumber}구역`, { zoneNumber: 0 });
  if (filters.rackId) add(`랙 ${filters.rackId}`, { rackId: 0, rackFace: "", columnNumber: 0, shelfNumber: 0 });
  if (filters.status && filters.status !== "active") add(filters.status === "disposed" ? "폐기" : "전체 상태", { status: "active" });
  return chips.length ? `<nav class="active-filter-chips" aria-label="적용된 필터">${chips.join("")}</nav>` : "";
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
