import { sharedSearchCore } from "../../../searchCore.js";
import { FREE_TIER_BUDGET } from "../../../config.js";
import { locationLabel, rackFaceLabel } from "../../racks/index.js";
import { paginateSlice } from "../../../shared/pagination.js";
import { readBoolean } from "../../../shared/coercion.js";
import { clean } from "../../../shared/text/normalize.js";
import {
  buildDocumentFilterWhere,
  getDocumentCount,
  getDocumentPage,
  parseDocumentFilters
} from "../../documents/index.js";
import {
  getSearchClickHits,
  getSearchReport,
  recordSearchClick,
  recordSearchLog
} from "./analytics.js";
import { buildSearchIndexTerms } from "../domain/indexTerms.js";
import {
  DOCUMENT_BASE_JOINS,
  DOCUMENT_CORE_COLUMNS,
  DOCUMENT_LOCATION_COLUMNS,
  DOCUMENT_TAG_CONCAT,
  DOCUMENT_TAG_JOINS
} from "./sql.js";

const searchCore = sharedSearchCore;

export const normalizeSearchText = searchCore.normalizeSearchText;
export const compactSearchText = searchCore.compactSearchText;
export const searchTokens = searchCore.searchTokens;
export const levenshteinDistance = searchCore.levenshteinDistance;
export const scoreDocumentMatch = searchCore.scoreDocumentMatch;
export const parseSearchQuery = searchCore.parseSearchQuery;
export { buildSearchIndexTerms, getSearchReport, parseDocumentFilters, recordSearchClick, recordSearchLog };

const compareSearchResults = searchCore.compareSearchResults;
const clickBoost = searchCore.clickBoost;

export const MAX_SEARCH_RESULTS = FREE_TIER_BUDGET.searchCandidateMaxItems;
const SEARCH_CANDIDATE_FLOOR = FREE_TIER_BUDGET.searchCandidateMaxItems;

export async function searchDocuments(env, query, limit = 100, filters = {}) {
  const trimmed = clean(query);
  const { where, binds: filterBinds } = buildDocumentFilterWhere(filters);
  const requestedLimit = Number(limit);
  const safeLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_SEARCH_RESULTS)
    : 100;
  const candidateLimit = trimmed
    ? Math.min(Math.max(safeLimit, SEARCH_CANDIDATE_FLOOR), MAX_SEARCH_RESULTS)
    : safeLimit;

  const hasQuery = Boolean(trimmed);
  const sort = filters.sort || (hasQuery ? "relevance" : "updated");
  if (hasQuery && looksLikeDocumentNumber(trimmed)) {
    const exactWhere = where
      ? `${where} AND UPPER(d.document_number) = UPPER(?)`
      : "WHERE UPPER(d.document_number) = UPPER(?)";
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
  if (hasQuery) {
    const candidateIds = await getProjectionCandidateIds(env, trimmed, candidateLimit);
    if (candidateIds) {
      if (!candidateIds.length) return [];
      return scoreCandidateDocuments(
        await getCoreCandidateDocuments(env, candidateIds, where, filterBinds),
        trimmed,
        safeLimit,
        sort,
        await getSearchClickHits(env, trimmed)
      );
    }
    env.__searchFallback = true;
  }

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
  if (!hasQuery) {
    return rows
      .sort((left, right) => compareSearchResults(left, right, sort, false))
      .slice(0, safeLimit);
  }
  return scoreCandidateDocuments(rows, trimmed, safeLimit, sort, clickHits);
}

function looksLikeDocumentNumber(value) {
  return value.length <= 100 && /\d/.test(value) && /[-_/]/.test(value) && !/\s/.test(value);
}

async function getProjectionCandidateIds(env, query, limit) {
  const expression = indexedSearchExpression(query);
  if (!expression) return null;
  try {
    if (!await isProjectionReadable(env)) return null;
    const result = await env.DB.prepare(`
      SELECT search_projection_fts.rowid AS document_id
      FROM search_projection_fts
      WHERE search_projection_fts MATCH ?
      LIMIT ?
    `).bind(expression, Math.min(limit, FREE_TIER_BUDGET.searchCandidateMaxItems)).all();
    return (result.results ?? []).map((row) => Number(row.document_id)).filter(Number.isInteger);
  } catch {
    return null;
  }
}

async function isProjectionReadable(env) {
  if (env.__projectionReadable !== undefined) return env.__projectionReadable;
  let readable = false;
  try {
    const state = await env.DB.prepare(`
      SELECT reindex_status, indexed_document_count
      FROM search_projection_state
      WHERE id = 1
    `).first();
    readable = state?.reindex_status === "ready";
  } catch {
    readable = false;
  }
  try {
    env.__projectionReadable = readable;
  } catch {
    // env가 동결된 경우에도 판정 자체는 유효하다.
  }
  return readable;
}

async function getCoreCandidateDocuments(env, candidateIds, where, filterBinds) {
  const candidateWhere = where
    ? `${where} AND d.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
    : "WHERE d.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))";
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
    ${candidateWhere}
    GROUP BY d.id
  `).bind(...filterBinds, JSON.stringify(candidateIds)).all();
  return result.results ?? [];
}

function indexedFilterWhere(filters, alias = "d") {
  const clauses = [];
  const binds = [];
  const addInteger = (field, value) => {
    if (Number.isInteger(value) && value > 0) {
      clauses.push(`${alias}.${field} = ?`);
      binds.push(value);
    }
  };
  addInteger("category_id", filters.categoryId);
  addInteger("zone_number", filters.zoneNumber);
  addInteger("rack_id", filters.rackId);
  addInteger("column_number", filters.columnNumber);
  addInteger("shelf_number", filters.shelfNumber);
  if (filters.rackFace === "A" || filters.rackFace === "B") {
    clauses.push(`${alias}.rack_face = ?`);
    binds.push(filters.rackFace);
  }
  if (filters.status === "active" || filters.status === "disposed") {
    clauses.push(`${alias}.status = ?`);
    binds.push(filters.status);
  }
  if (Number.isInteger(filters.tagId) && filters.tagId > 0) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM json_each(${alias}.tags_json) indexed_tag
      WHERE CAST(json_extract(indexed_tag.value, '$.id') AS INTEGER) = ?
    )`);
    binds.push(filters.tagId);
  }
  return {
    sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "",
    binds
  };
}

function indexedSearchExpression(query) {
  const terms = buildSearchIndexTerms(query).slice(0, 12);
  if (!terms.length) return "";
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

function indexedLiteralSearchExpression(query) {
  const terms = [...new Set(normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 8);
  if (!terms.length || terms.some((term) => term.length < 2)) return "";
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

function projectionSort(sort) {
  if (sort === "updated") return "document_updated_at DESC, document_id DESC";
  if (sort === "docnum") return "document_number, revision_number, document_id";
  if (sort === "category") return "category_name, document_number, revision_number, document_id";
  if (sort === "location") {
    return "matched.zone_number, projection_rack.rack_number, matched.rack_face, matched.column_number, matched.shelf_number DESC, matched.document_number, matched.document_id";
  }
  return "search_rank, document_id";
}

function projectionMatchedCte(filterSql) {
  return `
    WITH matched AS (
      SELECT
        d.document_id,
        d.document_number,
        d.revision_number,
        d.category_id,
        d.category_name,
        d.zone_number,
        d.rack_id,
        d.rack_code,
        d.rack_face,
        d.column_number,
        d.shelf_number,
        d.status,
        d.tags_json,
        d.document_updated_at,
        bm25(search_projection_fts) AS search_rank
      FROM search_projection_fts
      JOIN search_projection_documents d ON d.document_id = search_projection_fts.rowid
      WHERE search_projection_fts MATCH ?
        ${filterSql}
    )
  `;
}

function projectionFacetsSql(filterSql) {
  return `
    ${projectionMatchedCte(filterSql)}
    SELECT 'category' AS kind, CAST(category_id AS TEXT) AS value, category_name AS label, COUNT(*) AS count
    FROM matched
    GROUP BY category_id, category_name
    UNION ALL
    SELECT 'zone', CAST(zone_number AS TEXT), CAST(zone_number AS TEXT) || '구역', COUNT(*)
    FROM matched
    WHERE zone_number > 0
    GROUP BY zone_number
    UNION ALL
    SELECT 'status', status, CASE status WHEN 'disposed' THEN '폐기' ELSE '보관중' END, COUNT(*)
    FROM matched
    GROUP BY status
    UNION ALL
    SELECT
      'tag',
      CAST(json_extract(indexed_tag.value, '$.id') AS TEXT),
      json_extract(indexed_tag.value, '$.name'),
      COUNT(*)
    FROM matched
    JOIN json_each(matched.tags_json) indexed_tag
    GROUP BY 2, 3
  `;
}

function projectionFacets(rows) {
  const buckets = { category: [], tag: [], zone: [], status: [] };
  for (const row of rows) {
    const kind = String(row.kind || "");
    if (!Object.hasOwn(buckets, kind)) continue;
    buckets[kind].push({
      value: kind === "status" ? String(row.value || "") : Number(row.value || 0),
      label: String(row.label || ""),
      count: Number(row.count || 0)
    });
  }
  const byCount = (left, right) => Number(right.count) - Number(left.count)
    || String(left.label).localeCompare(String(right.label), "ko");
  return {
    categories: buckets.category.sort(byCount),
    tags: buckets.tag.sort(byCount),
    zones: buckets.zone.sort(byCount),
    statuses: buckets.status.sort((left, right) => String(left.value).localeCompare(String(right.value)))
  };
}

async function getProjectionViewerPage(env, query, filters, offset, pageSize) {
  const fuzzyExpression = indexedSearchExpression(query);
  if (!fuzzyExpression) return null;
  try {
    if (!await isProjectionReadable(env)) return null;
    const filter = indexedFilterWhere(filters);
    const literalExpression = indexedLiteralSearchExpression(query);
    const literalCount = literalExpression
      ? Number((await env.DB.prepare(`
        ${projectionMatchedCte(filter.sql)}
        SELECT COUNT(*) AS count FROM matched
      `).bind(literalExpression, ...filter.binds).first())?.count || 0)
      : 0;
    if (!literalCount) {
      return getFuzzyProjectionViewerPage(env, query, filters, filter, fuzzyExpression, offset, pageSize);
    }

    const binds = [literalExpression, ...filter.binds];
    const locationJoin = filters.sort === "location"
      ? "LEFT JOIN racks projection_rack ON projection_rack.id = matched.rack_id"
      : "";
    const [pageResult, facetResult] = await Promise.all([
      env.DB.prepare(`
        ${projectionMatchedCte(filter.sql)}
        SELECT matched.document_id, matched.search_rank
        FROM matched
        ${locationJoin}
        ORDER BY ${projectionSort(filters.sort)}
        LIMIT ? OFFSET ?
      `).bind(...binds, pageSize, offset).all(),
      env.DB.prepare(projectionFacetsSql(filter.sql)).bind(...binds).all()
    ]);
    const ranked = pageResult.results ?? [];
    const ids = ranked.map((row) => Number(row.document_id)).filter(Number.isInteger);
    const { where, binds: coreBinds } = buildDocumentFilterWhere(filters);
    const coreRows = await getCoreCandidateDocuments(env, ids, where, coreBinds);
    const byId = new Map(coreRows.map((row) => [Number(row.id), row]));
    const rankById = new Map(ranked.map((row) => [Number(row.document_id), Number(row.search_rank || 0)]));
    const documents = ids.map((id) => byId.get(id)).filter(Boolean);
    for (const document of documents) {
      const match = scoreDocumentMatch(document, query);
      document.relevance_score = Number(match.relevance_score || 0);
      document.match_reason = match.match_reason;
      document.search_rank = rankById.get(Number(document.id)) || 0;
    }
    return {
      documents: documents.filter((document) => document.relevance_score > 0),
      totalItems: literalCount,
      facets: projectionFacets(facetResult.results ?? [])
    };
  } catch {
    return null;
  }
}

async function getFuzzyProjectionViewerPage(env, query, filters, filter, expression, offset, pageSize) {
  const ranked = await env.DB.prepare(`
    ${projectionMatchedCte(filter.sql)}
    SELECT document_id, search_rank
    FROM matched
    ORDER BY search_rank, document_id
    LIMIT ?
  `).bind(expression, ...filter.binds, FREE_TIER_BUDGET.searchCandidateMaxItems).all();
  const ids = (ranked.results ?? [])
    .map((row) => Number(row.document_id))
    .filter(Number.isInteger);
  if (!ids.length) return null;

  const { where, binds } = buildDocumentFilterWhere(filters);
  const coreRows = await getCoreCandidateDocuments(env, ids, where, binds);
  const documents = scoreCandidateDocuments(
    coreRows,
    query,
    FREE_TIER_BUDGET.searchCandidateMaxItems,
    filters.sort,
    await getSearchClickHits(env, query)
  );
  return {
    documents: documents.slice(offset, offset + pageSize),
    totalItems: documents.length,
    facets: buildViewerFacets(documents)
  };
}

function scoreCandidateDocuments(rows, query, limit, sort, clickHits) {
  const scored = [];
  const queryTokens = searchTokens(query);
  for (const document of rows) {
    const match = scoreDocumentMatch(document, query, { tokens: queryTokens });
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
    .slice(0, limit);
}

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
    WHERE d.status = 'active' AND d.sync_state = 'current'
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

function filtersAllowSuggestionReuse(filters = {}, query = "") {
  const expectedSort = query ? "relevance" : "updated";
  const sort = filters.sort || expectedSort;
  return !filters.categoryId && !filters.zoneNumber && !filters.tagId && !filters.rackId &&
    !filters.rackFace && !filters.columnNumber && !filters.shelfNumber &&
    (!filters.status || filters.status === "active") &&
    sort === expectedSort;
}

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
  return text ? text.split(";").map((name) => clean(name)).filter(Boolean) : [];
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

async function getExactDocumentNamePage(env, query, filters, offset, pageSize) {
  const { where, binds } = buildDocumentFilterWhere(filters);
  const exactWhere = `${where} AND d.document_name = ? COLLATE NOCASE`;
  const countRow = await env.DB.prepare(`
    SELECT COUNT(DISTINCT d.id) AS count
    ${DOCUMENT_BASE_JOINS}
    ${exactWhere}
  `).bind(...binds, query).first();
  const totalItems = Number(countRow?.count || 0);
  if (!totalItems) return null;

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
    ${exactWhere}
    GROUP BY d.id
    ORDER BY d.revision_number DESC, d.id DESC
    LIMIT ? OFFSET ?
  `).bind(...binds, query, pageSize, offset).all();
  const documents = result.results ?? [];
  for (const document of documents) {
    document.relevance_score = 1000;
    document.match_reason = "문서명 정확히 일치";
  }
  return { documents, totalItems };
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
  const requestedLimit = Number(params.limit);
  const pageSizeInput = Number.isFinite(requestedLimit) && requestedLimit >= 1 ? requestedLimit : rawPageSize;
  const pageSize = Number.isFinite(pageSizeInput) && pageSizeInput >= 1
    ? Math.min(Math.floor(pageSizeInput), FREE_TIER_BUDGET.searchResponseMaxItems)
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

  const generation = await getSearchGeneration(env);
  const cursor = decodeSearchCursor(params.cursor);
  const fingerprint = searchRequestFingerprint(query, filters);
  if (cursor && (cursor.fingerprint !== fingerprint || cursor.generation !== generation)) {
    return {
      ok: false,
      code: "SEARCH_CURSOR_STALE",
      message: "검색 인덱스가 변경되었습니다. 첫 페이지부터 다시 검색하세요.",
      status: 409
    };
  }
  const offset = cursor ? cursor.offset : Math.max(0, (requestedPage - 1) * pageSize);
  const exactNamePage = await getExactDocumentNamePage(env, query, filters, offset, pageSize);
  if (exactNamePage) {
    const nextOffset = offset + exactNamePage.documents.length;
    const hasMore = nextOffset < exactNamePage.totalItems;
    return {
      ok: true,
      items: exactNamePage.documents.map(documentToViewerItem),
      nextCursor: hasMore ? encodeSearchCursor({ fingerprint, generation, offset: nextOffset }) : null,
      hasMore,
      candidateCount: exactNamePage.totalItems,
      indexGeneration: generation,
      fallback: false,
      pagination: {
        page: Math.floor(offset / pageSize) + 1,
        pageSize,
        totalItems: exactNamePage.totalItems,
        totalPages: Math.max(1, Math.ceil(exactNamePage.totalItems / pageSize))
      },
      facets: buildViewerFacets(exactNamePage.documents),
      suggestions: filters.status === "disposed" ? [] : buildSearchSuggestions(exactNamePage.documents, 8)
    };
  }

  const indexedPage = await getProjectionViewerPage(env, query, filters, offset, pageSize);
  if (indexedPage) {
    const nextOffset = offset + indexedPage.documents.length;
    const hasMore = nextOffset < indexedPage.totalItems;
    return {
      ok: true,
      items: indexedPage.documents.map(documentToViewerItem),
      nextCursor: hasMore ? encodeSearchCursor({ fingerprint, generation, offset: nextOffset }) : null,
      hasMore,
      candidateCount: indexedPage.totalItems,
      indexGeneration: generation,
      fallback: false,
      pagination: {
        page: Math.floor(offset / pageSize) + 1,
        pageSize,
        totalItems: indexedPage.totalItems,
        totalPages: Math.max(1, Math.ceil(indexedPage.totalItems / pageSize))
      },
      facets: indexedPage.facets,
      suggestions: filters.status === "disposed" ? [] : buildSearchSuggestions(indexedPage.documents, 8)
    };
  }

  const { documents: allDocuments, suggestions } = await searchDocumentsWithSuggestions(
    env,
    query,
    MAX_SEARCH_RESULTS,
    filters,
    8
  );
  const items = allDocuments.slice(offset, offset + pageSize);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < allDocuments.length;
  const nextCursor = hasMore ? encodeSearchCursor({ fingerprint, generation, offset: nextOffset }) : null;
  const sliced = paginateSlice(allDocuments, requestedPage, pageSize);

  return {
    ok: true,
    items: items.map(documentToViewerItem),
    nextCursor,
    hasMore,
    candidateCount: Math.min(allDocuments.length, FREE_TIER_BUDGET.searchCandidateMaxItems),
    indexGeneration: generation,
    fallback: await isSearchIndexDegraded(env),
    pagination: {
      page: cursor ? Math.floor(offset / pageSize) + 1 : sliced.page,
      pageSize,
      totalItems: allDocuments.length,
      totalPages: Math.max(1, Math.ceil(allDocuments.length / pageSize))
    },
    facets: buildViewerFacets(allDocuments),
    suggestions
  };
}

async function isSearchIndexDegraded(env) {
  if (env.__searchFallback === true) return true;
  return !await isProjectionReadable(env);
}

async function getSearchGeneration(env) {
  try {
    const state = await env.DB.prepare("SELECT generation FROM search_projection_state WHERE id = 1").first();
    return Math.max(1, Number(state?.generation || 1));
  } catch (error) {
    if (!/no such column:\s*generation|no such table:\s*search_projection_state/i.test(String(error?.message || error))) {
      throw error;
    }
    try {
      const legacy = await env.DB.prepare("SELECT generation FROM search_index_state WHERE id = 1").first();
      return Math.max(1, Number(legacy?.generation || 1));
    } catch {
      return 1;
    }
  }
}

function searchRequestFingerprint(query, filters) {
  const source = JSON.stringify({
    q: normalizeSearchText(query),
    categoryId: Number(filters.categoryId || 0),
    zoneNumber: Number(filters.zoneNumber || 0),
    tagId: Number(filters.tagId || 0),
    rackId: Number(filters.rackId || 0),
    rackFace: clean(filters.rackFace),
    columnNumber: Number(filters.columnNumber || 0),
    shelfNumber: Number(filters.shelfNumber || 0),
    status: clean(filters.status),
    sort: clean(filters.sort)
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function encodeSearchCursor(value) {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeSearchCursor(value) {
  const text = clean(value);
  if (!text) return null;
  try {
    const padded = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    if (
      typeof parsed?.fingerprint !== "string" ||
      !Number.isInteger(parsed?.generation) ||
      !Number.isInteger(parsed?.offset) ||
      parsed.offset < 0
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}
