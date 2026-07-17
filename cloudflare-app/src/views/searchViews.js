// 검색 뷰어(/app)·Q&A·검색 리포트 화면.

import { sharedSearchCore } from "../searchCore.js";
import { escapeHtml } from "../utils.js";
import { searchCoreScript } from "./clientScript.js";
import { floorPlanView } from "./floorPlanViews.js";
import { alertWarning, emptyResult, emptyState, filterSelectRow, listUrl, page, paginationNav, sectionHeader, statusBadge } from "./layout.js";
import {
  didYouMeanView,
  highlight,
  parsedChipRow,
  searchInputBlock
} from "./searchFragments.js";

export { didYouMeanView, highlight, parsedChipRow, searchInputBlock };

// 정답 카드 판정에 compactSearchText를 쓴다(하이라이트는 searchFragments).
const searchCore = sharedSearchCore;

export function dashboardPage({
  session,
  query,
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
  const isFirstPage = Number(viewerSearch.pagination?.page || 1) === 1;
  const answer = isFirstPage && query && (filters.sort || "relevance") === "relevance"
    ? pickDominantAnswer(documents, query)
    : null;
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
          ${answer ? answerCard(answer, query, dominantGrade(answer, query)) : ""}
          ${answer && rest.length ? `<p class="rest-label">다른 결과 ${totalItems - 1}건</p>` : ""}
          ${answer && !rest.length ? "" : viewerDocumentResults(rest, query)}
          ${!documents.length && didYouMean.length ? didYouMeanView(didYouMean) : ""}
          ${viewerPagination(viewerSearch.pagination, { query, filters })}
        </div>
      </article>

      <aside class="panel viewer-location-panel" aria-labelledby="viewer-location-title" data-viewer-map>
        <div class="section-title">
          <h2 id="viewer-location-title">문서고 도면</h2>
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
function dominantGrade(item, query) {
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
          <span>${escapeHtml(item.revisionDate || "제/개정일 미입력")}</span>
          <span>${escapeHtml(item.disposalDueYear ? `${item.disposalDueYear}년 폐기 예정` : "폐기 예정 년도 미입력")}</span>
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

function viewerSearchForm({ query, suggestions, categories, tags, filters, home = false }) {
  const activeFilterCount = [filters.categoryId, filters.tagId, filters.zoneNumber, filters.status === "disposed"].filter(Boolean).length;
  return `
    <form method="get" action="/app" class="viewer-search-form ${home ? "is-home" : ""}" data-search-form data-viewer-form data-auto-submit>
      ${searchInputBlock(query, suggestions)}
      <details class="filter-details" ${activeFilterCount ? "open" : ""}>
        <summary><i class="fa-solid fa-sliders"></i>상세 필터${activeFilterCount ? `<span class="filter-count">${activeFilterCount}</span>` : ""}</summary>
        ${filterSelectRow({ categories, tags, filters, viewer: true })}
      </details>
    </form>
  `;
}

function viewerDocumentResults(documents, query) {
  if (!documents.length) {
    return emptyResult("조건에 맞는 문서가 없습니다.");
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
          <span>${escapeHtml(document.revisionDate || "제/개정일 미입력")}</span>
          <span>${escapeHtml(document.disposalDueYear ? `${document.disposalDueYear}년 폐기 예정` : "폐기 예정 년도 미입력")}</span>
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
    ["status", "status"],
    ["sort", "sort"]
  ]);
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
