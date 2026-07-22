// 문서 목록과 소량 폐기 작업공간 화면.

import { escapeHtml } from "../../ui/html/escape.js";
import { documentResults } from "../documentTableViews.js";
import { filterSelectRow, option, page } from "../layout.js";
import { didYouMeanView, parsedChipRow, searchInputBlock } from "../searchFragments.js";
import { bulkActionBar, disposalFeedback, documentToolbar, paginationView } from "./listFragments.js";
import { disposalListUrl } from "./urlHelpers.js";

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
  const chipRow = parsedChipRow(parsedQuery, query, "/documents");
  const activeFilterCount = [filters.categoryId, filters.tagId, filters.zoneNumber, filters.status && filters.status !== "active", filters.sort && filters.sort !== "updated"].filter(Boolean).length;
  return page("문서 관리", `
    <section class="page-head">
      <div><nav class="breadcrumb" aria-label="경로"><a href="/app">문서고</a><span>/</span><span>문서 관리</span></nav><h1>문서 관리</h1><p class="muted">문서 정보와 보관 위치를 확인하고 수정합니다.</p></div>
      ${documentToolbar(session)}
    </section>

    <button type="button" class="button secondary mobile-filter-toggle" data-filter-toggle aria-controls="document-advanced-filters" aria-expanded="${activeFilterCount ? "true" : "false"}">상세 필터${activeFilterCount ? ` ${activeFilterCount}개 적용` : ""}</button>
    <section id="document-advanced-filters" class="panel search-panel" data-collapsible-filters data-active="${activeFilterCount ? "true" : "false"}">
      <form method="get" action="/documents" class="filter-bar" id="documentFilterForm" data-search-form data-auto-submit>
        ${searchInputBlock(query, suggestions)}
        ${filterSelectRow({ categories, tags, filters })}
      </form>
    </section>

    ${chipRow ? `<section class="panel chip-panel">${chipRow}</section>` : ""}

    <section class="panel results-panel">
      <div class="section-title">
        <h2>${query ? `"${escapeHtml(query)}" 검색 결과` : "전체 보유문서"}</h2>
        <span class="count-badge">${pagination.totalDocuments}건</span>
      </div>
      ${documentResults(documents, { emptyQuery: query, showScore: Boolean(query), query })}
      ${!documents.length && didYouMean.length ? didYouMeanView(didYouMean) : ""}
      ${paginationView(pagination, { query, filters })}
    </section>
  `, session);
}

export function disposalWorkspacePage({
  session,
  documents = [],
  categories = [],
  racks = [],
  years = [],
  filters = {},
  capped = false,
  legacyLimit = 10,
  history = [],
  pagination = { page: 1, totalPages: 1, totalItems: 0 },
  tab = "targets",
  feedback = null
}) {
  const targetCount = Number(pagination.totalItems || documents.length || 0);
  return page("문서 폐기", `
    <section class="page-head">
      <div><nav class="breadcrumb" aria-label="경로"><a href="/app">문서고</a><span>/</span><span>문서 폐기</span></nav><h1>문서 폐기</h1><p class="muted">실제 폐기할 원본을 선택하고 수량을 확인하면 즉시 폐기 상태로 변경됩니다.</p></div>
      <div class="button-group"><a class="button secondary" href="/documents/disposal?tab=history">폐기 이력</a></div>
    </section>
    <section class="operation-hero disposal-hero" aria-label="폐기 작업 요약">
      <div><p class="hero-kicker">Controlled disposal</p><h2>폐기 가능한 원본 ${targetCount.toLocaleString("ko-KR")}부</h2><p>문서 한 건은 원본 한 부입니다. 실제 원본을 고르고 수량이 맞는지 마지막으로 확인하세요.</p></div>
      <div class="hero-stat"><strong>${targetCount.toLocaleString("ko-KR")}</strong><span>선택 가능 원본</span></div>
    </section>
    ${disposalFeedback(feedback)}
    <nav class="workspace-tabs" aria-label="폐기 작업 화면">
      <a href="${escapeHtml(disposalListUrl(filters))}" ${tab === "targets" ? `aria-current="page"` : ""}>폐기 대상</a>
      <a href="/documents/disposal?tab=history" ${tab === "history" ? `aria-current="page"` : ""}>폐기 이력</a>
    </nav>
    ${tab === "history"
      ? disposalHistoryView(history, pagination, filters)
      : disposalTargetsView({ documents, categories, racks, years, filters, capped, limit: legacyLimit })}
  `, session);
}

function disposalTargetsView({ documents, categories, racks, years, filters, capped, limit }) {
  return `
    <div class="disposal-shell">
    <section class="panel">
      <form method="get" action="/documents/disposal" class="filter-bar disposal-filter">
        <label><span>폐기 예정 연도</span><select name="disposalDueYear"><option value="">전체</option>${years.map((year) => option(year, `${year}년`, filters.disposalDueYear)).join("")}</select></label>
        <label><span>대분류</span><select name="category"><option value="">전체</option>${categories.map((item) => option(item.id, item.name, filters.categoryId)).join("")}</select></label>
        <label><span>보관 위치</span><select name="rack"><option value="">전체</option>${racks.map((item) => option(item.id, `${item.zone_number}구역 ${item.rack_number}번 랙`, filters.rackId)).join("")}</select></label>
        <label class="search-input"><span>검색</span><input type="search" name="q" value="${escapeHtml(filters.query || "")}" placeholder="문서번호 또는 문서명"></label>
        <button type="submit" class="button">검색</button>
        <a class="button secondary" href="/documents/disposal">초기화</a>
      </form>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>폐기 대상</h2><span class="count-badge">${documents.length}${capped ? "+" : ""}건</span></div>
      ${capped ? `<div class="alert warning">한 번에 최대 ${limit}건까지 검토할 수 있습니다. 검색 조건을 더 좁혀 주세요.</div>` : ""}
      ${documentResults(documents, { bulk: true, selectAll: true, emptyMessage: "조건에 맞는 보관중 문서가 없습니다." })}
      ${bulkActionBar("/documents/disposal/process", filters)}
    </section>
    </div>`;
}

function disposalHistoryView(history, pagination, filters) {
  const rows = history.map((item) => `
    <tr class="is-disposed">
      <td data-label="문서명"><a href="/documents/${item.document_id}">${escapeHtml(item.document_name)}</a></td>
      <td class="mono-cell" data-label="문서번호">${escapeHtml(item.document_number)}</td>
      <td data-label="개정">${escapeHtml(item.revision_number)}</td>
      <td data-label="대분류">${escapeHtml(item.category_name || "-")}</td>
      <td class="location-cell" data-label="보관 위치">${escapeHtml(item.location_snapshot || "-")}</td>
      <td data-label="상태"><span class="status disposed">폐기</span></td>
      <td data-label="폐기 사유">${escapeHtml(item.reason || "-")}</td>
      <td data-label="승인 참조">${escapeHtml(item.approval_reference || "-")}</td>
      <td data-label="처리">${escapeHtml(item.performed_by)}<small>${escapeHtml(item.created_at)}</small></td>
    </tr>`).join("");
  const query = escapeHtml(filters.query || "");
  return `
    <section class="panel">
      <form method="get" action="/documents/disposal" class="filter-row">
        <input type="hidden" name="tab" value="history">
        <label class="search-input"><span class="sr-only">폐기 이력 검색</span><input type="search" name="q" value="${query}" placeholder="문서명, 문서번호, 개정번호"></label>
        <button type="submit" class="button">검색</button>
        <a class="button secondary" href="/documents/disposal?tab=history">초기화</a>
      </form>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>폐기 이력</h2><span class="count-badge">${pagination.totalItems || 0}건</span></div>
      <div class="table-wrap"><table class="doc-table disposal-history-table">
        <thead><tr><th>문서명</th><th>문서번호</th><th>개정</th><th>대분류</th><th>보관 위치</th><th>상태</th><th>폐기 사유</th><th>승인 참조</th><th>처리</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="empty">폐기 이력이 없습니다.</td></tr>`}</tbody>
      </table></div>
      ${historyPagination(pagination, filters.query)}
    </section>`;
}

function historyPagination(pagination, query) {
  if ((pagination.totalPages || 1) <= 1) return "";
  const url = (pageNumber) => {
    const params = new URLSearchParams({ tab: "history", page: String(pageNumber) });
    if (query) params.set("q", query);
    return `/documents/disposal?${params}`;
  };
  return `<nav class="pagination" aria-label="폐기 이력 페이지">
    ${pagination.page <= 1 ? `<span class="button secondary sm disabled" aria-disabled="true">이전</span>` : `<a class="button secondary sm" href="${escapeHtml(url(pagination.page - 1))}">이전</a>`}
    <span>${pagination.page} / ${pagination.totalPages}</span>
    ${pagination.page >= pagination.totalPages ? `<span class="button secondary sm disabled" aria-disabled="true">다음</span>` : `<a class="button secondary sm" href="${escapeHtml(url(pagination.page + 1))}">다음</a>`}
  </nav>`;
}
