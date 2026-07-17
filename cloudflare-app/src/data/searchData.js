import { sharedSearchCore } from "../searchCore.js";
import { FREE_TIER_BUDGET } from "../config.js";
import { clean, locationLabel, paginateSlice, rackFaceLabel, readBoolean } from "../utils.js";
import { getDocumentCount, getDocumentPage } from "./documentsData.js";
import {
  getDocumentClickPopularity,
  getSearchClickHits,
  getSearchReport,
  recordSearchClick,
  recordSearchLog
} from "./searchAnalytics.js";
import { buildDocumentFilterWhere, parseDocumentFilters } from "./searchFilters.js";
import {
  DOCUMENT_BASE_JOINS,
  DOCUMENT_CORE_COLUMNS,
  DOCUMENT_LOCATION_COLUMNS,
  DOCUMENT_TAG_CONCAT,
  DOCUMENT_TAG_JOINS
} from "./sqlShared.js";

// 검색 로직은 searchCore가 단일 출처. 서버는 공용 인스턴스를 쓰고,
// 클라이언트(즉시 검색)는 views/clientScript.js가 같은 팩토리 소스를 내려보낸다.
const searchCore = sharedSearchCore;

export const normalizeSearchText = searchCore.normalizeSearchText;
export const compactSearchText = searchCore.compactSearchText;
export const searchTokens = searchCore.searchTokens;
export const levenshteinDistance = searchCore.levenshteinDistance;
export const scoreDocumentMatch = searchCore.scoreDocumentMatch;
export const parseSearchQuery = searchCore.parseSearchQuery;

// 분석 API는 배럴(db.js) 공개 표면을 유지하기 위해 여기서 재수출한다.
export { getSearchReport, recordSearchClick, recordSearchLog };

const compareSearchResults = searchCore.compareSearchResults;
const clickBoost = searchCore.clickBoost;

// 권위 브라우즈 상한. 실제 아카이브 규모(수백~수천) 위로 두어 목록 절단을 방지한다.
export const MAX_SEARCH_RESULTS = 5000;
// 소규모 자동완성 요청은 최근 후보를 최소 750건까지 보되, 권위 목록 요청은
// 호출자가 요청한 상한(MAX_SEARCH_RESULTS)까지 전부 채점해 오래된 문서 누락을 막는다.
const SEARCH_CANDIDATE_FLOOR = 750;

export async function searchDocuments(env, query, limit = 100, filters = {}) {
  const trimmed = clean(query);
  const { where, binds: filterBinds } = buildDocumentFilterWhere(filters);
  // 권위 목록(문서 브라우즈)이 잘려 문서가 사라지지 않도록 상한을 예상 아카이브 규모 위로 둔다.
  // LIMIT ?는 실제 문서 수만큼만 읽으므로(min(actual, cap)) 소규모에서는 무료티어 비용도 낮다.
  const requestedLimit = Number(limit);
  const safeLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_SEARCH_RESULTS)
    : 100;
  // 자동완성처럼 작은 요청은 후보 하한을 두고, 전체 목록 요청은 1,500건에서 잘리지 않게
  // safeLimit까지 확장한다. LIMIT 전 정렬을 고정해 같은 데이터는 같은 후보 집합을 만든다.
  const candidateLimit = trimmed
    ? Math.min(Math.max(safeLimit, SEARCH_CANDIDATE_FLOOR), MAX_SEARCH_RESULTS)
    : safeLimit;

  const hasQuery = Boolean(trimmed);
  const sort = filters.sort || (hasQuery ? "relevance" : "updated");
  // 문서번호처럼 보이는 완전 일치 입력은 퍼지 검색용 최대 5,000행 후보를 읽기 전에 직접
  // 조회한다. 내부 ARC 보관코드는 이 경로에 포함하지 않아 기존 비노출 정책을 유지한다.
  if (hasQuery && looksLikeDocumentNumber(trimmed)) {
    const exactWhere = where
      ? `${where} AND LOWER(d.document_number) = LOWER(?)`
      : "WHERE LOWER(d.document_number) = LOWER(?)";
    const exact = await env.DB.prepare(`
      SELECT
        d.id,
        ${DOCUMENT_CORE_COLUMNS}
        d.updated_at,
        ${DOCUMENT_LOCATION_COLUMNS}
        r.column_count,
        r.shelf_count,
        rs.column_number,
        rs.shelf_number,
        rs.slot_code,
        ${DOCUMENT_TAG_CONCAT}
      ${DOCUMENT_BASE_JOINS}
      ${DOCUMENT_TAG_JOINS}
      ${exactWhere}
      GROUP BY d.id
      ORDER BY d.revision_number DESC, d.id DESC
      LIMIT ?
    `).bind(...filterBinds, trimmed, safeLimit).all();
    const exactRows = exact.results ?? [];
    if (exactRows.length) {
      for (const document of exactRows) {
        document.relevance_score = 1000;
        document.match_reason = "문서번호 정확히 일치";
      }
      return exactRows;
    }
  }
  // 문서 후보 조회와 클릭 학습 조회는 서로 독립이므로 병렬로 보낸다.
  const [result, clickHits] = await Promise.all([
    env.DB.prepare(`
      SELECT
        d.id,
        ${DOCUMENT_CORE_COLUMNS}
        d.updated_at,
        ${DOCUMENT_LOCATION_COLUMNS}
        r.column_count,
        r.shelf_count,
        rs.column_number,
        rs.shelf_number,
        rs.slot_code,
        ${DOCUMENT_TAG_CONCAT}
      ${DOCUMENT_BASE_JOINS}
      ${DOCUMENT_TAG_JOINS}
      ${where}
      GROUP BY d.id
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT ?
    `).bind(...filterBinds, candidateLimit).all(),
    hasQuery ? getSearchClickHits(env, trimmed) : Promise.resolve(null)
  ]);

  const rows = result.results ?? [];
  // 검색어 없는 브라우즈는 스코어링·클릭 부스트를 생략하고 정렬만 한다.
  if (!hasQuery) {
    return rows
      .sort((left, right) => compareSearchResults(left, right, sort, false))
      .slice(0, safeLimit);
  }

  // 스프레드로 행마다 새 객체를 만들지 않고 점수 필드만 붙인다.
  const scored = [];
  const queryTokens = searchTokens(trimmed);
  for (const document of rows) {
    const match = scoreDocumentMatch(document, trimmed, { tokens: queryTokens });
    if (match.relevance_score <= 0) continue;
    document.relevance_score = match.relevance_score;
    document.match_reason = match.match_reason;
    if (clickHits) {
      const hits = clickHits.get(Number(document.id)) || 0;
      if (hits) document.relevance_score += clickBoost(hits);
    }
    scored.push(document);
  }
  return scored
    .sort((left, right) => compareSearchResults(left, right, sort, true))
    .slice(0, safeLimit);
}

function looksLikeDocumentNumber(value) {
  return value.length <= 100 && /\d/.test(value) && /[-_/]/.test(value) && !/\s/.test(value);
}

// 0건 검색 시 "혹시 이 문서를 찾으셨나요?" 후보 (커버리지 완화 재검색)
export async function getDidYouMeanSuggestions(env, query, limit = 3) {
  const trimmed = clean(query);
  if (!trimmed) return [];

  const result = await env.DB.prepare(`
    SELECT
      d.id,
      ${DOCUMENT_CORE_COLUMNS}
      ${DOCUMENT_LOCATION_COLUMNS}
      rs.column_number,
      rs.shelf_number,
      ${DOCUMENT_TAG_CONCAT}
    ${DOCUMENT_BASE_JOINS}
    ${DOCUMENT_TAG_JOINS}
    WHERE d.status = 'active'
    GROUP BY d.id
    ORDER BY d.updated_at DESC, d.id DESC
    LIMIT 750
  `).all();

  const queryTokens = searchTokens(trimmed);
  const scored = (result.results ?? []).map((document) => {
    const match = scoreDocumentMatch(document, trimmed, { minCoverage: 0.2, tokens: queryTokens });
    document.relevance_score = match.relevance_score;
    document.match_reason = match.match_reason;
    return document;
  });
  return scored
    .filter((document) => document.relevance_score > 0)
    .sort((left, right) => right.relevance_score - left.relevance_score)
    .slice(0, Math.max(1, Math.min(Math.floor(Number(limit) || 3), 8)));
}

// 즉시 검색용 경량 인덱스. ETag는 문서 수·최대 ID와 함께
// 인덱스에 들어가는 각 테이블(문서·대분류·태그·랙·슬롯)의 변경 시각을 따로 반영한다.
export async function getSearchIndexMeta(env) {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM documents) AS count,
      (SELECT MAX(id) FROM documents) AS max_id,
      (SELECT COALESCE(SUM(row_version), 0) FROM documents) AS documents_version,
      (SELECT MAX(updated_at) FROM documents) AS documents_updated,
      (SELECT MAX(updated_at) FROM categories) AS categories_updated,
      (SELECT MAX(updated_at) FROM tags) AS tags_updated,
      (SELECT MAX(updated_at) FROM racks) AS racks_updated,
      (SELECT MAX(updated_at) FROM rack_slots) AS slots_updated
  `).first();

  const stamps = [
    clean(row?.documents_updated),
    clean(row?.categories_updated),
    clean(row?.tags_updated),
    clean(row?.racks_updated),
    clean(row?.slots_updated)
  ];
  // SQLite CURRENT_TIMESTAMP는 'YYYY-MM-DD HH:MM:SS'라 문자열 최댓값으로 최신 시각을 고른다.
  // versionKey는 최댓값 하나가 아니라 테이블별 시각을 순서대로 보존해야 한다. 예를 들어
  // 문서가 더 최신이어도 태그만 바뀌면 해당 구간이 달라져 ETag가 반드시 갱신된다.
  const updated = stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest), "");
  const versionKey = [
    String(Number(row?.documents_version || 0)),
    ...stamps.map((stamp) => stamp.replace(/[^0-9]/g, "") || "0")
  ].join("-");

  return {
    count: Number(row?.count || 0),
    updated,
    maxId: Number(row?.max_id || 0),
    versionKey
  };
}

export async function getSearchIndexDocuments(env) {
  const [result, popularity] = await Promise.all([
    env.DB.prepare(`
      SELECT
        d.id,
        ${DOCUMENT_CORE_COLUMNS}
        d.updated_at,
        d.category_id,
        ${DOCUMENT_LOCATION_COLUMNS}
        rs.column_number,
        rs.shelf_number,
        ${DOCUMENT_TAG_CONCAT}
      ${DOCUMENT_BASE_JOINS}
      ${DOCUMENT_TAG_JOINS}
      GROUP BY d.id
    `).all(),
    getDocumentClickPopularity(env)
  ]);

  return (result.results ?? []).map((row) => {
    // 보관코드는 DB 내부 식별자로만 사용하며 브라우저 검색 인덱스에는 전달하지 않는다.
    const { storage_code: _storageCode, ...document } = row;
    document.popularity = popularity.get(Number(row.id)) || 0;
    return document;
  });
}

export async function getSearchIndexStats(env) {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) AS document_count,
      COALESCE(SUM(
        LENGTH(IFNULL(d.document_number, '')) +
        LENGTH(IFNULL(d.revision_number, '')) +
        LENGTH(IFNULL(d.document_name, '')) +
        LENGTH(IFNULL(d.note, '')) +
        LENGTH(IFNULL(c.name, '')) +
        LENGTH(IFNULL(r.code, '')) + 220
      ), 0) AS estimated_json_bytes
    ${DOCUMENT_BASE_JOINS}
  `).first();
  const documentCount = Number(row?.document_count || 0);
  const estimatedJsonBytes = Number(row?.estimated_json_bytes || 0);
  return {
    documentCount,
    estimatedJsonBytes,
    warningCount: FREE_TIER_BUDGET.searchIndexWarningCount,
    reviewCount: FREE_TIER_BUDGET.searchIndexReviewCount,
    level: documentCount >= FREE_TIER_BUDGET.searchIndexReviewCount
      ? "review"
      : documentCount >= FREE_TIER_BUDGET.searchIndexWarningCount
        ? "warning"
        : "ok"
  };
}

// 이미 로드한 검색 결과에서 자동완성 후보를 만든다(추가 D1 왕복 없이).
export function buildSearchSuggestions(documents, limit = 8) {
  const safeLimit = Math.max(1, Math.min(Math.floor(Number(limit) || 8), 20));
  const suggestions = [];
  const seen = new Set();

  const addSuggestion = (type, value, label = value) => {
    if (suggestions.length >= safeLimit) return;
    const text = clean(value);
    const compact = compactSearchText(text);
    if (!text || !compact) return;
    const key = `${type}:${compact}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ type, value: text, label: clean(label) || text });
  };

  for (const document of documents) {
    addSuggestion("document_number", document.document_number, `${document.document_number} - ${document.document_name}`);
    addSuggestion("document_name", document.document_name);
    addSuggestion("category", document.category_name, `${document.category_name} 대분류`);
    addSuggestion("location", document.rack_code, `${document.rack_code} 랙 위치`);
    if (suggestions.length >= safeLimit) break;
  }

  return suggestions;
}

// 메인 검색 결과로 자동완성을 채워도 의미가 같은지(필터·정렬이 제안 쿼리와 호환되는지).
function filtersAllowSuggestionReuse(filters = {}, query = "") {
  const expectedSort = query ? "relevance" : "updated";
  const sort = filters.sort || expectedSort;
  return !filters.categoryId && !filters.zoneNumber && !filters.tagId && !filters.rackId &&
    !filters.rackFace && !filters.columnNumber && !filters.shelfNumber &&
    (!filters.status || filters.status === "active") &&
    sort === expectedSort;
}

// 목록 검색과 자동완성을 한 번에. 호환 필터면 D1 검색을 한 번만 한다.
export async function searchDocumentsWithSuggestions(env, query, limit = 100, filters = {}, suggestionLimit = 8) {
  if (filtersAllowSuggestionReuse(filters, query)) {
    const documents = await searchDocuments(env, query, limit, filters);
    const source = filters.status === "active"
      ? documents
      : documents.filter((document) => document.status === "active");
    return { documents, suggestions: buildSearchSuggestions(source, suggestionLimit) };
  }

  const [documents, suggestions] = await Promise.all([
    searchDocuments(env, query, limit, filters),
    getSearchSuggestions(env, query, suggestionLimit)
  ]);
  return { documents, suggestions };
}

export async function getSearchSuggestions(env, query, limit = 8) {
  const documents = await searchDocuments(env, query, Math.max(limit * 2, 12), {
    sort: query ? "relevance" : "updated",
    status: "active"
  });
  return buildSearchSuggestions(documents, limit);
}

function parseTagNames(value) {
  const text = clean(value);
  return text
    ? text.split(";").map((name) => clean(name)).filter(Boolean)
    : [];
}

export function documentToViewerItem(document) {
  const tags = Array.isArray(document.tags) ? document.tags : parseTagNames(document.tag_names);
  return {
    id: Number(document.id),
    documentNumber: clean(document.document_number),
    revisionNumber: clean(document.revision_number),
    revisionDate: clean(document.revision_date),
    disposalDueYear: document.disposal_due_year === null || document.disposal_due_year === undefined ? null : Number(document.disposal_due_year),
    documentName: clean(document.document_name),
    categoryName: clean(document.category_name),
    tags,
    status: document.status === "disposed" ? "disposed" : "active",
    location: {
      label: locationLabel(document),
      zoneNumber: Number(document.zone_number || 0),
      rackNumber: Number(document.rack_number || 0),
      rackCode: clean(document.rack_code),
      // 면 단위 랙 표기("13" 또는 "13-1"/"13-2"). 화면 표시는 이 값을 우선 쓴다.
      rackLabel: rackFaceLabel(document),
      isSingleSided: readBoolean(document.is_single_sided),
      columnNumber: Number(document.column_number || 0),
      shelfNumber: Number(document.shelf_number || 0),
      rackFace: clean(document.rack_face)
    },
    matchReason: clean(document.match_reason),
    relevanceScore: Number(document.relevance_score || 0),
    updatedAt: clean(document.updated_at)
  };
}

function facetMapToItems(map) {
  return [...map.values()].sort((left, right) => {
    return Number(right.count || 0) - Number(left.count || 0) ||
      normalizeSearchText(left.label).localeCompare(normalizeSearchText(right.label), "ko");
  });
}

export function buildViewerFacets(documents) {
  const categories = new Map();
  const tags = new Map();
  const zones = new Map();
  const statuses = new Map([
    ["active", { value: "active", label: "보관중", count: 0 }],
    ["disposed", { value: "disposed", label: "폐기", count: 0 }]
  ]);

  for (const document of documents) {
    const categoryKey = String(document.category_id || document.category_name || "");
    if (categoryKey) {
      const existing = categories.get(categoryKey) || {
        value: Number(document.category_id || 0) || clean(document.category_name),
        label: clean(document.category_name),
        count: 0
      };
      existing.count += 1;
      categories.set(categoryKey, existing);
    }

    for (const tagName of parseTagNames(document.tag_names)) {
      const key = compactSearchText(tagName);
      const existing = tags.get(key) || { value: tagName, label: tagName, count: 0 };
      existing.count += 1;
      tags.set(key, existing);
    }

    const zoneNumber = Number(document.zone_number || 0);
    if (zoneNumber > 0) {
      const key = String(zoneNumber);
      const existing = zones.get(key) || { value: zoneNumber, label: `${zoneNumber}구역`, count: 0 };
      existing.count += 1;
      zones.set(key, existing);
    }

    const statusKey = document.status === "disposed" ? "disposed" : "active";
    statuses.get(statusKey).count += 1;
  }

  return {
    categories: facetMapToItems(categories),
    tags: facetMapToItems(tags),
    zones: facetMapToItems(zones),
    statuses: [...statuses.values()]
  };
}

export async function getViewerSearchPayload(env, params = {}) {
  const query = clean(params.q || params.query);
  const rawPageSize = Number(params.pageSize);
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1
    ? Math.min(Math.floor(rawPageSize), 50)
    : 12;
  const rawPage = Number(params.page);
  const requestedPage = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const filters = parseDocumentFilters(params, { query });
  if (!query) {
    const totalItems = await getDocumentCount(env, filters);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const documents = await getDocumentPage(env, filters, page, pageSize);
    return {
      items: documents.map(documentToViewerItem),
      pagination: { page, pageSize, totalItems, totalPages },
      facets: buildViewerFacets(documents),
      suggestions: filters.status === "disposed" ? [] : buildSearchSuggestions(documents, 8)
    };
  }

  const { documents: allDocuments, suggestions } = await searchDocumentsWithSuggestions(
    env,
    query,
    MAX_SEARCH_RESULTS,
    filters,
    8
  );
  const sliced = paginateSlice(allDocuments, requestedPage, pageSize);

  return {
    items: sliced.items.map(documentToViewerItem),
    pagination: {
      page: sliced.page,
      pageSize: sliced.pageSize,
      totalItems: sliced.totalItems,
      totalPages: sliced.totalPages
    },
    facets: buildViewerFacets(allDocuments),
    suggestions
  };
}
