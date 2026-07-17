// 문서 목록과 소량 폐기 작업공간 화면.

import { escapeHtml } from "../../utils.js";
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
  return page("문서 관리", `
    <section class="page-head">
      <div><h1>문서 관리</h1><p class="muted">문서 정보와 보관 위치를 확인하고 수정합니다.</p></div>
      ${documentToolbar(session)}
    </section>

    <section class="panel search-panel">
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
  feedback = null
}) {
  const returnTo = disposalListUrl(filters);
  return page("문서 폐기 작업", `
    <section class="page-head">
      <div><h1>문서 폐기 작업</h1><p class="muted">보관중 문서만 표시됩니다. 현재 목록에서 대상을 선택하고 폐기 사유를 한 번 입력해 처리합니다.</p></div>
      <a class="button secondary" href="/documents">문서 관리</a>
    </section>
    ${disposalFeedback(feedback)}
    <section class="panel">
      <form method="get" action="/documents/disposal" class="filter-row">
        <label><span class="sr-only">대분류</span><select name="category"><option value="">전체 대분류</option>${categories.map((item) => option(item.id, item.name, filters.categoryId)).join("")}</select></label>
        <label><span class="sr-only">랙</span><select name="rack"><option value="">전체 랙</option>${racks.map((item) => option(item.id, `${item.zone_number}구역 ${item.rack_number}번 랙`, filters.rackId)).join("")}</select></label>
        <label><span class="sr-only">폐기 예정 년도</span><select name="disposalDueYear"><option value="">전체 폐기 예정 년도</option>${years.map((year) => option(year, `${year}년`, filters.disposalDueYear)).join("")}</select></label>
        <button type="submit" class="button secondary">필터 적용</button>
        <a class="button secondary" href="/documents/disposal">초기화</a>
      </form>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>폐기 대상 후보</h2><span class="count-badge">${documents.length}${capped ? "+" : ""}건</span></div>
      ${capped ? `<div class="alert warning">소량 긴급 폐기는 한 번에 최대 ${legacyLimit}건만 처리할 수 있습니다. 더 많은 대상은 폐기 캠페인을 사용해 주세요.</div>` : ""}
      ${documentResults(documents, { bulk: true, selectAll: true, emptyMessage: "조건에 맞는 보관중 문서가 없습니다." })}
      ${bulkActionBar("/documents/bulk-dispose", returnTo)}
    </section>
  `, session);
}
