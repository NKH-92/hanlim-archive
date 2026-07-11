// 검색 요청 공통 파이프라인: /app 대시보드와 /documents 목록이 같은
// 파라미터 해석·필터 병합 규칙(명시 파라미터 > 검색어 추출 필터)을 쓰도록 한 곳에 모은다.
import {
  getActiveCategories,
  getActiveTags,
  getDidYouMeanSuggestions,
  parseSearchQuery,
  recordSearchLog
} from "../db.js";
import { clean } from "../utils.js";

export async function resolveSearchRequest(env, url) {
  const query = clean(url.searchParams.get("q"));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const explicitFilters = {
    categoryId: Number(url.searchParams.get("category")) || 0,
    zoneNumber: Number(url.searchParams.get("zone")) || 0,
    tagId: Number(url.searchParams.get("tag")) || 0,
    status: clean(url.searchParams.get("status")),
    sort: clean(url.searchParams.get("sort"))
  };
  const [categories, tags] = await Promise.all([
    getActiveCategories(env),
    getActiveTags(env)
  ]);
  const hasExplicitFilter = Boolean(
    explicitFilters.categoryId || explicitFilters.zoneNumber || explicitFilters.tagId || explicitFilters.status
  );

  // "2구역 PV" 같은 검색어를 필터 + 남은 텍스트로 분해한다.
  const parsed = parseSearchQuery(query, { categories, tags, explicit: explicitFilters });
  const filters = {
    categoryId: explicitFilters.categoryId || parsed.filters.categoryId || 0,
    zoneNumber: explicitFilters.zoneNumber || parsed.filters.zoneNumber || 0,
    tagId: explicitFilters.tagId || parsed.filters.tagId || 0,
    status: explicitFilters.status || parsed.filters.status || "",
    sort: explicitFilters.sort || (parsed.text ? "relevance" : "updated")
  };

  return { query, page, explicitFilters, hasExplicitFilter, categories, tags, parsed, filters };
}

// 결과 0건이면 "혹시 이 검색어?" 후보를 만들고, 1페이지 검색이면 검색 로그를 남긴다.
export async function resolveSearchOutcome(env, search, totalItems) {
  const didYouMean = search.query && totalItems === 0
    ? await getDidYouMeanSuggestions(env, search.parsed.text || search.query, 3)
    : [];

  if (search.query && search.page === 1) {
    await recordSearchLog(env, search.query, totalItems);
  }

  return didYouMean;
}
