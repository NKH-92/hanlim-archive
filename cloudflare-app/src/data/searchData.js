import { sharedSearchCore } from "../searchCore.js";
import { FREE_TIER_BUDGET } from "../config.js";
import { locationLabel, rackFaceLabel } from "../domains/racks/index.js";
import { paginateSlice } from "../shared/pagination.js";
import { readBoolean } from "../shared/coercion.js";
import { clean } from "../shared/text/normalize.js";
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

// 검색 분석 API는 검색 도메인의 infrastructure adapter가 이 모듈에서 재수출한다.
export { getSearchReport, recordSearchClick, recordSearchLog };

const compareSearchResults = searchCore.compareSearchResults;
const clickBoost = searchCore.clickBoost;

// 일반 텍스트 검색은 Search D1에서 이 수만큼만 후보를 만든 뒤 Core D1에서 권한·상태를 재검증한다.
// 무검색/필터 목록은 getDocumentPage()의 정확한 count/page 경로를 사용하므로 이 상한의 영향을 받지 않는다.
export const MAX_SEARCH_RESULTS = FREE_TIER_BUDGET.searchCandidateMaxItems;
const SEARCH_CANDIDATE_FLOOR = FREE_TIER_BUDGET.searchCandidateMaxItems;

export async function searchDocuments(env, query, limit = 100, filters = {}) {
  const trimmed = clean(query);
  const { where, binds: filterBinds } = buildDocumentFilterWhere(filters);
  // 텍스트 검색은 Search D1 후보 200건 안에서 점수화한다. 검색어 없는 권위 목록은
  // 이 함수가 아니라 getDocumentPage()의 SQL COUNT + page 경로를 사용한다.
  const requestedLimit = Number(limit);
  const safeLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_SEARCH_RESULTS)
    : 100;
  // 자동완성처럼 작은 요청도 퍼지 점수화에 충분한 후보 200건을 확보한다.
  const candidateLimit = trimmed
    ? Math.min(Math.max(safeLimit, SEARCH_CANDIDATE_FLOOR), MAX_SEARCH_RESULTS)
    : safeLimit;

  const hasQuery = Boolean(trimmed);
  const sort = filters.sort || (hasQuery ? "relevance" : "updated");
  // 문서번호처럼 보이는 완전 일치 입력은 퍼지 검색 후보를 읽기 전에 Core에서 직접
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
  if (hasQuery && env.SEARCH_DB) {
    try {
      const candidateIds = await getIndexedCandidateIds(env.SEARCH_DB, trimmed, candidateLimit);
      if (!candidateIds.length) return [];
      return scoreCandidateDocuments(
        await getCoreCandidateDocuments(env, candidateIds, where, filterBinds),
        trimmed,
        safeLimit,
        sort,
        await getSearchClickHits(env, trimmed)
      );
    } catch {
      // Search D1 장애 시 Core의 제한된 후보 검색으로 내린다. 정확 문서번호와 필터 목록은 계속 제공된다.
      env.__searchFallback = true;
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
  return scoreCandidateDocuments(rows, trimmed, safeLimit, sort, clickHits);
}

function looksLikeDocumentNumber(value) {
  return value.length <= 100 && /\d/.test(value) && /[-_/]/.test(value) && !/\s/.test(value);
}

async function getIndexedCandidateIds(searchDb, query, limit) {
  const terms = buildSearchIndexTerms(query).slice(0, 12);
  if (!terms.length) return [];
  // 오타 한 글자로 전체 후보가 0건이 되지 않도록 n-gram 중 하나 이상 일치하는 후보를 만든 뒤,
  // Core의 기존 퍼지 점수기로 최종 관련성을 다시 판정한다.
  const expression = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
  const result = await searchDb.prepare(`
    SELECT CAST(document_id AS INTEGER) AS document_id
    FROM search_documents_fts
    WHERE search_documents_fts MATCH ?
    LIMIT ?
  `).bind(expression, Math.min(limit, FREE_TIER_BUDGET.searchCandidateMaxItems)).all();
  return (result.results ?? []).map((row) => Number(row.document_id)).filter(Number.isInteger);
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
  // 한 글자 위치 검색("1-1" 등)은 FTS token 일치가 지나치게 넓으므로 기존 퍼지 경로로 보낸다.
  if (!terms.length || terms.some((term) => term.length < 2)) return "";
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

function indexedSort(sort) {
  if (sort === "updated") return "d.updated_at DESC, d.document_id DESC";
  if (sort === "docnum") return "d.document_number, d.revision_number, d.document_id";
  if (sort === "category") return "d.category_name, d.document_number, d.revision_number, d.document_id";
  if (sort === "location") {
    return "d.zone_number, d.rack_code, d.rack_face, d.column_number, d.shelf_number, d.document_id";
  }
  return "search_rank, d.document_id";
}

async function getIndexedViewerPageV2(env, query, filters, offset, pageSize) {
  if (!env.SEARCH_DB) return null;
  const literalExpression = indexedLiteralSearchExpression(query);
  const fuzzyExpression = indexedSearchExpression(query);
  if (!fuzzyExpression) return null;
  try {
    const state = await env.SEARCH_DB.prepare(`
      SELECT active_generation, v2_ready, rebuild_status
      FROM search_runtime_state
      WHERE id = 1
    `).first();
    if (Number(state?.v2_ready || 0) !== 1) return null;
    const generation = Number(state.active_generation || 0);
    if (!generation) return null;
    const filter = indexedFilterWhere(filters);
    // 정확히 입력된 token들이 모두 있는 결과를 먼저 사용한다. 2·3글자 n-gram OR 후보는
    // 실제 관련성 점수로 거르는 기존 제한 후보 경로에 맡겨 무관한 청크 문서가 섞이지 않게 한다.
    const literalMatch = literalExpression
      ? await env.SEARCH_DB.prepare(`
        SELECT 1
        FROM search_documents_fts_v2
        JOIN search_documents_v2 d
          ON d.generation = CAST(search_documents_fts_v2.generation AS INTEGER)
         AND d.document_id = CAST(search_documents_fts_v2.document_id AS INTEGER)
        WHERE search_documents_fts_v2 MATCH ?
          AND d.generation = ?
          ${filter.sql}
        LIMIT 1
      `).bind(literalExpression, generation, ...filter.binds).first()
      : null;
    if (!literalMatch) {
      return getFuzzyIndexedViewerPageV2(
        env,
        query,
        filters,
        generation,
        filter,
        fuzzyExpression,
        offset,
        pageSize
      );
    }

    const expression = literalExpression;
    const commonJoin = `
      FROM search_documents_fts_v2
      JOIN search_documents_v2 d
        ON d.generation = CAST(search_documents_fts_v2.generation AS INTEGER)
       AND d.document_id = CAST(search_documents_fts_v2.document_id AS INTEGER)
    `;
    const commonWhere = `
      WHERE search_documents_fts_v2 MATCH ?
        AND d.generation = ?
        ${filter.sql}
    `;
    const commonBinds = [expression, generation, ...filter.binds];
    const [countRow, pageResult, categoryResult, zoneResult, statusResult, tagResult] = await Promise.all([
      env.SEARCH_DB.prepare(`SELECT COUNT(*) AS count ${commonJoin} ${commonWhere}`).bind(...commonBinds).first(),
      env.SEARCH_DB.prepare(`
        SELECT d.document_id, bm25(search_documents_fts_v2) AS search_rank
        ${commonJoin}
        ${commonWhere}
        ORDER BY ${indexedSort(filters.sort)}
        LIMIT ? OFFSET ?
      `).bind(...commonBinds, pageSize, offset).all(),
      env.SEARCH_DB.prepare(`
        SELECT d.category_id AS value, d.category_name AS label, COUNT(*) AS count
        ${commonJoin}
        ${commonWhere}
        GROUP BY d.category_id, d.category_name
        ORDER BY count DESC, label
      `).bind(...commonBinds).all(),
      env.SEARCH_DB.prepare(`
        SELECT d.zone_number AS value, CAST(d.zone_number AS TEXT) || '구역' AS label, COUNT(*) AS count
        ${commonJoin}
        ${commonWhere}
        AND d.zone_number > 0
        GROUP BY d.zone_number
        ORDER BY count DESC, value
      `).bind(...commonBinds).all(),
      env.SEARCH_DB.prepare(`
        SELECT d.status AS value,
               CASE d.status WHEN 'disposed' THEN '폐기' ELSE '보관중' END AS label,
               COUNT(*) AS count
        ${commonJoin}
        ${commonWhere}
        GROUP BY d.status
        ORDER BY value
      `).bind(...commonBinds).all(),
      env.SEARCH_DB.prepare(`
        SELECT
          CAST(json_extract(indexed_tag.value, '$.id') AS INTEGER) AS value,
          json_extract(indexed_tag.value, '$.name') AS label,
          COUNT(*) AS count
        ${commonJoin}
        JOIN json_each(d.tags_json) indexed_tag
        ${commonWhere}
        GROUP BY value, label
        ORDER BY count DESC, label
      `).bind(...commonBinds).all()
    ]);
    const ranked = pageResult.results ?? [];
    const ids = ranked.map((row) => Number(row.document_id)).filter(Number.isInteger);
    const { where, binds } = buildDocumentFilterWhere(filters);
    const coreRows = await getCoreCandidateDocuments(env, ids, where, binds);
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
      totalItems: Number(countRow?.count || 0),
      activeGeneration: generation,
      facets: {
        categories: categoryResult.results ?? [],
        tags: tagResult.results ?? [],
        zones: zoneResult.results ?? [],
        statuses: statusResult.results ?? []
      }
    };
  } catch {
    return null;
  }
}

async function getFuzzyIndexedViewerPageV2(
  env,
  query,
  filters,
  generation,
  filter,
  expression,
  offset,
  pageSize
) {
  const ranked = await env.SEARCH_DB.prepare(`
    SELECT d.document_id, bm25(search_documents_fts_v2) AS search_rank
    FROM search_documents_fts_v2
    JOIN search_documents_v2 d
      ON d.generation = CAST(search_documents_fts_v2.generation AS INTEGER)
     AND d.document_id = CAST(search_documents_fts_v2.document_id AS INTEGER)
    WHERE search_documents_fts_v2 MATCH ?
      AND d.generation = ?
      ${filter.sql}
    ORDER BY search_rank, d.document_id
    LIMIT ?
  `).bind(
    expression,
    generation,
    ...filter.binds,
    FREE_TIER_BUDGET.searchCandidateMaxItems
  ).all();
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
    activeGeneration: generation,
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

export function buildSearchIndexTerms(value) {
  const normalized = normalizeSearchText(value);
  const terms = new Set();
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (token.length <= 2) {
      terms.add(token);
    } else {
      for (let index = 0; index < token.length - 1; index += 1) {
        terms.add(token.slice(index, index + 2));
      }
      for (let index = 0; index < token.length - 2; index += 1) {
        terms.add(token.slice(index, index + 3));
      }
    }
    const initials = hangulInitials(token);
    if (initials && initials !== token) terms.add(initials);
  }
  return [...terms].filter((term) => term && !/["'*:()]/.test(term));
}

function hangulInitials(value) {
  const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  let output = "";
  for (const character of value) {
    const code = character.charCodeAt(0) - 0xac00;
    output += code >= 0 && code <= 11171 ? initials[Math.floor(code / 588)] : character;
  }
  return output;
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

// 즉시 검색용 경량 인덱스. ETag는 문서 수·최대 ID와 함께
// 인덱스에 들어가는 각 테이블(문서·대분류·태그·랙·슬롯)의 변경 시각을 따로 반영한다.
export async function getSearchIndexMeta(env) {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM documents WHERE sync_state = 'current') AS count,
      (SELECT MAX(id) FROM documents WHERE sync_state = 'current') AS max_id,
      (SELECT current_version FROM document_sync_state WHERE id = 1) AS sync_version,
      (SELECT COALESCE(SUM(row_version), 0) FROM documents WHERE sync_state = 'current') AS documents_version,
      (SELECT MAX(updated_at) FROM documents WHERE sync_state = 'current') AS documents_updated,
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
    String(Number(row?.sync_version || 0)),
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
      WHERE d.sync_state = 'current'
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
    WHERE d.sync_state = 'current'
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
      nextCursor: hasMore
        ? encodeSearchCursor({ fingerprint, generation, offset: nextOffset })
        : null,
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
      suggestions: filters.status === "disposed"
        ? []
        : buildSearchSuggestions(exactNamePage.documents, 8)
    };
  }
  const indexedPage = await getIndexedViewerPageV2(env, query, filters, offset, pageSize);
  if (indexedPage) {
    const nextOffset = offset + indexedPage.documents.length;
    const hasMore = nextOffset < indexedPage.totalItems;
    return {
      ok: true,
      items: indexedPage.documents.map(documentToViewerItem),
      nextCursor: hasMore
        ? encodeSearchCursor({ fingerprint, generation, offset: nextOffset })
        : null,
      hasMore,
      candidateCount: indexedPage.totalItems,
      indexGeneration: generation,
      activeIndexGeneration: indexedPage.activeGeneration,
      fallback: false,
      pagination: {
        page: Math.floor(offset / pageSize) + 1,
        pageSize,
        totalItems: indexedPage.totalItems,
        totalPages: Math.max(1, Math.ceil(indexedPage.totalItems / pageSize))
      },
      facets: indexedPage.facets,
      suggestions: filters.status === "disposed"
        ? []
        : buildSearchSuggestions(indexedPage.documents, 8)
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
  const nextCursor = hasMore
    ? encodeSearchCursor({ fingerprint, generation, offset: nextOffset })
    : null;
  const sliced = paginateSlice(allDocuments, requestedPage, pageSize);

  return {
    ok: true,
    items: items.map(documentToViewerItem),
    nextCursor,
    hasMore,
    candidateCount: Math.min(allDocuments.length, FREE_TIER_BUDGET.searchCandidateMaxItems),
    indexGeneration: generation,
    fallback: !env.SEARCH_DB || env.__searchFallback === true,
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

async function getSearchGeneration(env) {
  try {
    const state = await env.DB.prepare("SELECT generation FROM search_index_state WHERE id = 1").first();
    return Math.max(1, Number(state?.generation || 1));
  } catch {
    return 1;
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
