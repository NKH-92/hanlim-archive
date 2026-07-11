import { sharedSearchCore } from "../searchCore.js";
import { clean, locationLabel, logError, rackFaceLabel, readBoolean } from "../utils.js";
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

const compareSearchResults = searchCore.compareSearchResults;
const clickBoost = searchCore.clickBoost;

// 권위 브라우즈 상한. 실제 아카이브 규모(수백~수천) 위로 두어 목록 절단을 방지한다.
export const MAX_SEARCH_RESULTS = 5000;
// 검색어 스코어링 후보 상한. 상위 매칭에 충분하면서 요청당 JS 스코어링 부하를 억제한다.
const SEARCH_CANDIDATE_LIMIT = 1500;

export async function searchDocuments(env, query, limit = 100, filters = {}) {
  const trimmed = clean(query);
  const filterClauses = [];
  const filterBinds = [];

  if (filters.categoryId && Number.isInteger(filters.categoryId) && filters.categoryId > 0) {
    filterClauses.push("d.category_id = ?");
    filterBinds.push(filters.categoryId);
  }
  if (filters.zoneNumber && Number.isInteger(filters.zoneNumber) && filters.zoneNumber > 0) {
    filterClauses.push("r.zone_number = ?");
    filterBinds.push(filters.zoneNumber);
  }
  if (filters.status === "active" || filters.status === "disposed") {
    filterClauses.push("d.status = ?");
    filterBinds.push(filters.status);
  }
  if (filters.tagId && Number.isInteger(filters.tagId) && filters.tagId > 0) {
    filterClauses.push("EXISTS (SELECT 1 FROM document_tags fdt WHERE fdt.document_id = d.id AND fdt.tag_id = ?)");
    filterBinds.push(filters.tagId);
  }

  const where = filterClauses.length ? `WHERE ${filterClauses.join(" AND ")}` : "";
  // 권위 목록(문서 브라우즈)이 잘려 문서가 사라지지 않도록 상한을 예상 아카이브 규모 위로 둔다.
  // LIMIT ?는 실제 문서 수만큼만 읽으므로(min(actual, cap)) 소규모에서는 무료티어 비용도 낮다.
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, MAX_SEARCH_RESULTS));
  // 검색어가 있으면 스코어링 후보를 제한(충분한 상위 매칭 + Worker CPU 보호), 없으면 브라우즈 전량 로드.
  const candidateLimit = trimmed ? Math.min(Math.max(safeLimit, 750), SEARCH_CANDIDATE_LIMIT) : safeLimit;

  const result = await env.DB.prepare(`
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
    LIMIT ?
  `).bind(...filterBinds, candidateLimit).all();

  const hasQuery = Boolean(trimmed);
  const clickHits = hasQuery ? await getSearchClickHits(env, trimmed) : null;
  return (result.results ?? [])
    .map((document) => {
      const scored = { ...document, ...scoreDocumentMatch(document, trimmed) };
      if (clickHits && scored.relevance_score > 0) {
        const hits = clickHits.get(Number(scored.id)) || 0;
        if (hits) scored.relevance_score += clickBoost(hits);
      }
      return scored;
    })
    .filter((document) => !hasQuery || document.relevance_score > 0)
    .sort((left, right) => compareSearchResults(left, right, filters.sort || (hasQuery ? "relevance" : "updated"), hasQuery))
    .slice(0, safeLimit);
}

// ---- 검색 분석: 클릭 학습 랭킹 + 검색어 로그 (아이디어 8, 9) ----
// 마이그레이션 0014 이전 배포에서도 검색이 죽지 않도록 전부 실패 허용.

async function getSearchClickHits(env, query) {
  const key = compactSearchText(query);
  if (!key || key.length > 80) return null;
  try {
    const result = await env.DB.prepare(
      "SELECT document_id, hits FROM search_clicks WHERE query_key = ?"
    ).bind(key).all();
    const map = new Map();
    for (const row of result.results ?? []) {
      map.set(Number(row.document_id), Number(row.hits) || 0);
    }
    return map.size ? map : null;
  } catch (error) {
    logError("db.getSearchClickHits", error);
    return null;
  }
}

export async function recordSearchClick(env, query, documentId) {
  const key = compactSearchText(query);
  const id = Number(documentId);
  if (!key || key.length > 80 || !Number.isInteger(id) || id <= 0) {
    return { ok: false };
  }
  try {
    await env.DB.prepare(`
      INSERT INTO search_clicks (query_key, document_id)
      VALUES (?, ?)
      ON CONFLICT(query_key, document_id)
      DO UPDATE SET hits = hits + 1, last_clicked_at = CURRENT_TIMESTAMP
    `).bind(key, id).run();
    return { ok: true };
  } catch (error) {
    logError("db.recordSearchClick", error);
    return { ok: false };
  }
}

export async function recordSearchLog(env, query, resultCount) {
  const text = clean(query);
  const key = compactSearchText(query);
  if (!key || key.length > 80) return;
  try {
    await env.DB.prepare(`
      INSERT INTO search_logs (query_key, query_text, last_result_count)
      VALUES (?, ?, ?)
      ON CONFLICT(query_key)
      DO UPDATE SET
        hits = hits + 1,
        query_text = excluded.query_text,
        last_result_count = excluded.last_result_count,
        last_searched_at = CURRENT_TIMESTAMP
    `).bind(key, text.slice(0, 120), Math.max(0, Number(resultCount) || 0)).run();
  } catch (error) {
    // 분석 로그는 검색 자체를 막지 않는다. 실패는 로깅만 한다.
    logError("db.recordSearchLog", error);
  }
}

export async function getSearchReport(env) {
  try {
    const [top, failed, clicked] = await Promise.all([
      env.DB.prepare(`
        SELECT query_text, hits, last_result_count, last_searched_at
        FROM search_logs
        WHERE last_result_count > 0
        ORDER BY hits DESC, last_searched_at DESC
        LIMIT 20
      `).all(),
      env.DB.prepare(`
        SELECT query_text, hits, last_searched_at
        FROM search_logs
        WHERE last_result_count = 0
        ORDER BY hits DESC, last_searched_at DESC
        LIMIT 20
      `).all(),
      env.DB.prepare(`
        SELECT d.id, d.document_number, d.document_name, SUM(sc.hits) AS click_count
        FROM search_clicks sc
        JOIN documents d ON d.id = sc.document_id
        GROUP BY d.id
        ORDER BY click_count DESC
        LIMIT 10
      `).all()
    ]);
    return {
      topQueries: top.results ?? [],
      failedQueries: failed.results ?? [],
      topDocuments: clicked.results ?? []
    };
  } catch (error) {
    logError("db.getSearchReport", error);
    return { topQueries: [], failedQueries: [], topDocuments: [], unavailable: true };
  }
}

async function getDocumentClickPopularity(env) {
  try {
    const result = await env.DB.prepare(
      "SELECT document_id, SUM(hits) AS total FROM search_clicks GROUP BY document_id"
    ).all();
    return new Map((result.results ?? []).map((row) => [Number(row.document_id), Number(row.total) || 0]));
  } catch (error) {
    logError("db.getDocumentClickPopularity", error);
    return new Map();
  }
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
    LIMIT 750
  `).all();

  return (result.results ?? [])
    .map((document) => ({ ...document, ...scoreDocumentMatch(document, trimmed, { minCoverage: 0.2 }) }))
    .filter((document) => document.relevance_score > 0)
    .sort((left, right) => right.relevance_score - left.relevance_score)
    .slice(0, Math.max(1, Math.min(Number(limit) || 3, 8)));
}

// 즉시 검색용 경량 인덱스 (아이디어 3). ETag는 문서 수 + 최신 수정 시각.
export async function getSearchIndexMeta(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count, MAX(updated_at) AS updated, MAX(id) AS max_id FROM documents"
  ).first();
  return {
    count: Number(row?.count || 0),
    updated: clean(row?.updated || ""),
    maxId: Number(row?.max_id || 0)
  };
}

export async function getSearchIndexDocuments(env) {
  const result = await env.DB.prepare(`
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
  `).all();

  const popularity = await getDocumentClickPopularity(env);
  return (result.results ?? []).map((row) => ({
    ...row,
    popularity: popularity.get(Number(row.id)) || 0
  }));
}

export async function getSearchSuggestions(env, query, limit = 8) {
  const documents = await searchDocuments(env, query, Math.max(limit * 2, 12), {
    sort: query ? "relevance" : "updated",
    status: "active"
  });
  const suggestions = [];
  const seen = new Set();

  const addSuggestion = (type, value, label = value) => {
    const text = clean(value);
    if (!text) return;
    const key = `${type}:${compactSearchText(text)}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ type, value: text, label: clean(label) || text });
  };

  for (const document of documents) {
    addSuggestion("document_number", document.document_number, `${document.document_number} - ${document.document_name}`);
    addSuggestion("document_name", document.document_name);
    addSuggestion("category", document.category_name, `${document.category_name} 대분류`);
    addSuggestion("location", document.rack_code, `${document.rack_code} 랙 위치`);
    if (suggestions.length >= limit) break;
  }

  return suggestions.slice(0, limit);
}

function parseTagNames(value) {
  return clean(value)
    ? clean(value).split(";").map((name) => clean(name)).filter(Boolean)
    : [];
}

export function documentToViewerItem(document) {
  const tags = Array.isArray(document.tags) ? document.tags : parseTagNames(document.tag_names);
  return {
    id: Number(document.id),
    documentNumber: clean(document.document_number),
    storageCode: clean(document.storage_code),
    revisionNumber: clean(document.revision_number),
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

function readViewerFilters(params = {}) {
  return {
    categoryId: Number(params.category || params.categoryId) || 0,
    zoneNumber: Number(params.zone || params.zoneNumber) || 0,
    tagId: Number(params.tag || params.tagId) || 0,
    status: clean(params.status),
    sort: clean(params.sort) || (clean(params.q || params.query) ? "relevance" : "updated")
  };
}

export async function getViewerSearchPayload(env, params = {}) {
  const query = clean(params.q || params.query);
  const pageSize = Math.max(1, Math.min(Number(params.pageSize) || 12, 50));
  const requestedPage = Math.max(1, Number(params.page) || 1);
  const filters = readViewerFilters(params);
  const [allDocuments, suggestions] = await Promise.all([
    searchDocuments(env, query, MAX_SEARCH_RESULTS, filters),
    getSearchSuggestions(env, query, 8)
  ]);
  const totalItems = allDocuments.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  return {
    items: allDocuments.slice(offset, offset + pageSize).map(documentToViewerItem),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages
    },
    facets: buildViewerFacets(allDocuments),
    suggestions
  };
}
