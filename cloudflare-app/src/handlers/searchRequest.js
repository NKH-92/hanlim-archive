// 검색 요청 공통 파이프라인: /app 대시보드와 /documents 목록이 같은
// 파라미터 해석·필터 병합 규칙(명시 파라미터 > 검색어 추출 필터)을 쓰도록 한 곳에 모은다.
import {
  getActiveCategories,
  getActiveTags,
  getDidYouMeanSuggestions,
  parseDocumentFilters,
  parseSearchQuery,
  recordSearchLog
} from "../db.js";
import { clean } from "../utils.js";

export async function resolveSearchRequest(env, url) {
  const query = clean(url.searchParams.get("q"));
  const requestedPage = Number(url.searchParams.get("page"));
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;
  // 명시 필터만 읽는다(sort 기본값은 아래 병합에서 결정).
  const explicitFilters = parseDocumentFilters({
    category: url.searchParams.get("category"),
    zone: url.searchParams.get("zone"),
    tag: url.searchParams.get("tag"),
    rack: url.searchParams.get("rack"),
    face: url.searchParams.get("face"),
    column: url.searchParams.get("column"),
    shelf: url.searchParams.get("shelf"),
    status: url.searchParams.get("status"),
    includeDisposed: url.searchParams.get("includeDisposed"),
    sort: url.searchParams.get("sort")
  }, { emptySort: true, query, defaultActive: false });
  const [categories, tags] = await Promise.all([
    getActiveCategories(env),
    getActiveTags(env)
  ]);
  const hasExplicitFilter = Boolean(
    explicitFilters.categoryId || explicitFilters.zoneNumber || explicitFilters.tagId || explicitFilters.rackId ||
    explicitFilters.rackFace || explicitFilters.columnNumber || explicitFilters.shelfNumber ||
    explicitFilters.status === "disposed"
  );

  // "2구역 PV" 같은 검색어를 필터 + 남은 텍스트로 분해한다.
  const parsed = parseSearchQuery(query, {
    categories,
    tags,
    // 상태는 선택 상자로만 제어하며 검색어의 상태 토큰은 일반 검색어로 남긴다.
    explicit: { ...explicitFilters, status: explicitFilters.status || "active" }
  });
  const filters = {
    categoryId: explicitFilters.categoryId || parsed.filters.categoryId || 0,
    zoneNumber: explicitFilters.zoneNumber || parsed.filters.zoneNumber || 0,
    tagId: explicitFilters.tagId || parsed.filters.tagId || 0,
    rackId: explicitFilters.rackId || 0,
    rackFace: explicitFilters.rackFace || "",
    columnNumber: explicitFilters.columnNumber || 0,
    shelfNumber: explicitFilters.shelfNumber || 0,
    status: explicitFilters.status || "active",
    includeDisposed: explicitFilters.status === "disposed",
    sort: explicitFilters.sort || (parsed.text ? "relevance" : "updated")
  };

  return { query, page, explicitFilters, hasExplicitFilter, categories, tags, parsed, filters };
}

// 결과 0건이면 "혹시 이 검색어?" 후보를 만들고, 1페이지 검색이면 검색 로그를 남긴다.
export async function resolveSearchOutcome(env, search, totalItems) {
  const didYouMean = search.query && totalItems === 0 && search.filters.status !== "disposed"
    ? await getDidYouMeanSuggestions(env, search.parsed.text || search.query, 3)
    : [];

  if (search.query && search.page === 1) {
    await recordSearchLog(env, search.query, totalItems);
  }

  return didYouMean;
}
