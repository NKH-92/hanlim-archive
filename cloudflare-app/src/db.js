import { createPasswordRecord } from "./auth.js";
import {
  DEFAULT_RACK_COLUMNS,
  DEFAULT_RACK_SHELVES,
  MAX_RACK_COLUMNS,
  MAX_RACKS_PER_ZONE,
  MAX_RACK_SHELVES,
  RACK_ZONES
} from "./config.js";
import { clean, locationLabel, logError } from "./utils.js";
import { createSearchCore } from "./searchCore.js";

// 검색 로직은 searchCore가 단일 출처. 서버는 여기서 인스턴스를 만들고,
// 클라이언트(즉시 검색)는 html.js가 같은 팩토리 소스를 내려보낸다.
const searchCore = createSearchCore();

export const normalizeSearchText = searchCore.normalizeSearchText;
export const compactSearchText = searchCore.compactSearchText;
export const searchTokens = searchCore.searchTokens;
export const levenshteinDistance = searchCore.levenshteinDistance;
export const scoreDocumentMatch = searchCore.scoreDocumentMatch;
export const parseSearchQuery = searchCore.parseSearchQuery;
export const highlightSearchText = searchCore.highlightHtml;
export const chosungOf = searchCore.chosungOf;
export const qwertyToHangul = searchCore.qwertyToHangul;
export const hangulToQwerty = searchCore.hangulToQwerty;

const compareSearchResults = searchCore.compareSearchResults;
const clickBoost = searchCore.clickBoost;

// 권위 브라우즈 상한. 실제 아카이브 규모(수백~수천) 위로 두어 목록 절단을 방지한다.
export const MAX_SEARCH_RESULTS = 5000;
// 검색어 스코어링 후보 상한. 상위 매칭에 충분하면서 요청당 JS 스코어링 부하를 억제한다.
const SEARCH_CANDIDATE_LIMIT = 1500;

// 좌표는 Archive.png(1024x797) 회색 구역 실측 비율. 컨테이너 aspect-ratio가
// 이미지 비율과 일치해야 오버레이가 어긋나지 않는다 (html.js .floor-plan-media 참조).
export const DEFAULT_FLOOR_PLAN_REGIONS = Object.freeze([
  Object.freeze({
    region_key: "zone-1",
    label: "1구역",
    description: "좌상단 문서 보관 구역",
    top_pct: 3.2,
    left_pct: 4.7,
    width_pct: 47.5,
    height_pct: 38.2,
    default_rack_count: 10,
    is_active: 1
  }),
  Object.freeze({
    region_key: "zone-2",
    label: "2구역",
    description: "좌하단 문서 보관 구역",
    top_pct: 55.8,
    left_pct: 2.5,
    width_pct: 43.9,
    height_pct: 38.9,
    default_rack_count: 10,
    is_active: 1
  }),
  Object.freeze({
    region_key: "zone-3",
    label: "3구역",
    description: "우하단 문서 보관 구역",
    top_pct: 55.8,
    left_pct: 52.2,
    width_pct: 39.1,
    height_pct: 38.9,
    default_rack_count: 10,
    is_active: 1
  })
]);

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
      d.storage_code,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.note,
      d.rack_face,
      d.status,
      d.updated_at,
      c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided,
      r.column_count,
      r.shelf_count,
      rs.column_number,
      rs.shelf_number,
      rs.slot_code,
      co.borrower AS checkout_borrower,
      co.checked_out_at AS checkout_at,
      GROUP_CONCAT(t.name, '; ') AS tag_names
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_checkouts co ON co.document_id = d.id AND co.returned_at IS NULL
    LEFT JOIN document_tags dt ON dt.document_id = d.id
    LEFT JOIN tags t ON t.id = dt.tag_id
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

export async function getPopularDocuments(env, limit = 5) {
  try {
    const result = await env.DB.prepare(`
      SELECT
        d.id,
        d.document_number,
        d.document_name,
        d.rack_face,
        r.code AS rack_code,
        r.zone_number,
        r.rack_number,
        rs.column_number,
        rs.shelf_number,
        SUM(sc.hits) AS click_count
      FROM search_clicks sc
      JOIN documents d ON d.id = sc.document_id
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      JOIN racks r ON r.id = rs.rack_id
      WHERE d.status = 'active'
      GROUP BY d.id
      ORDER BY click_count DESC, MAX(sc.last_clicked_at) DESC
      LIMIT ?
    `).bind(Math.max(1, Math.min(Number(limit) || 5, 10))).all();
    return result.results ?? [];
  } catch (error) {
    logError("db.getPopularDocuments", error);
    return [];
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
      d.storage_code,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.note,
      d.rack_face,
      d.status,
      c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      rs.column_number,
      rs.shelf_number,
      GROUP_CONCAT(t.name, '; ') AS tag_names
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_tags dt ON dt.document_id = d.id
    LEFT JOIN tags t ON t.id = dt.tag_id
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
      d.storage_code,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.note,
      d.rack_face,
      d.status,
      d.updated_at,
      d.category_id,
      c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      rs.column_number,
      rs.shelf_number,
      co.borrower AS checkout_borrower,
      GROUP_CONCAT(t.name, '; ') AS tag_names
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_checkouts co ON co.document_id = d.id AND co.returned_at IS NULL
    LEFT JOIN document_tags dt ON dt.document_id = d.id
    LEFT JOIN tags t ON t.id = dt.tag_id
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
      columnNumber: Number(document.column_number || 0),
      shelfNumber: Number(document.shelf_number || 0),
      rackFace: clean(document.rack_face)
    },
    matchReason: clean(document.match_reason),
    relevanceScore: Number(document.relevance_score || 0),
    updatedAt: clean(document.updated_at),
    checkedOut: Boolean(document.checkout_borrower),
    checkoutBorrower: clean(document.checkout_borrower)
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

export async function getFloorPlanRegions(env) {
  try {
    const result = await env.DB.prepare(`
      SELECT
        region_key,
        label,
        description,
        top_pct,
        left_pct,
        width_pct,
        height_pct,
        default_rack_count,
        is_active
      FROM floor_plan_regions
      WHERE is_active = 1
      ORDER BY region_key
    `).all();
    const rows = result.results ?? [];
    return rows.length ? rows : DEFAULT_FLOOR_PLAN_REGIONS.map((region) => ({ ...region }));
  } catch (error) {
    // 위치 핵심: 도면 구역 조회가 예외로 실패하면 기본 도면으로 폴백하되 반드시 경보로 남긴다.
    // (빈 테이블은 정상 기본값이므로 예외만 이 경로로 온다.)
    logError("db.getFloorPlanRegions", error);
    return DEFAULT_FLOOR_PLAN_REGIONS.map((region) => ({ ...region }));
  }
}

function zoneFromRegion(region) {
  const matched = clean(region.region_key).match(/(\d+)/);
  return matched ? Number(matched[1]) : Number(region.zone_number || 0);
}

function clampPercent(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(number, 100));
}

export function buildFloorPlanLayout(racks, regions = DEFAULT_FLOOR_PLAN_REGIONS) {
  return regions.map((region) => {
    const zoneNumber = zoneFromRegion(region);
    const zoneRacks = racks
      .filter((rack) => Number(rack.zone_number) === zoneNumber)
      .sort((left, right) => Number(left.rack_number || 0) - Number(right.rack_number || 0));
    const count = Math.max(zoneRacks.length, Number(region.default_rack_count || 0), 1);
    // 실제 문서고 구조: 세로로 긴 랙이 구역 안에 좌→우로 일렬 배치.
    // 각 랙은 자기 슬롯(구역 폭/count)의 중앙에 서고, 슬롯의 일부만 차지해 랙 사이 통로가 보인다.
    const slotWidth = 100 / count;
    const barWidthPct = Math.round(slotWidth * 62) / 100;

    return {
      key: clean(region.region_key) || `zone-${zoneNumber}`,
      label: clean(region.label) || `${zoneNumber}구역`,
      description: clean(region.description),
      zoneNumber,
      topPct: clampPercent(region.top_pct, 0),
      leftPct: clampPercent(region.left_pct, 0),
      widthPct: clampPercent(region.width_pct, 30),
      heightPct: clampPercent(region.height_pct, 30),
      racks: zoneRacks.map((rack, index) => ({
        id: Number(rack.id),
        code: clean(rack.code),
        rackNumber: Number(rack.rack_number || 0),
        documentCount: Number(rack.active_document_count || rack.document_count || 0),
        isSingleSided: Boolean(Number(rack.is_single_sided || 0)),
        leftPct: clampPercent(slotWidth * (index + 0.5), 50),
        topPct: 50,
        widthPct: barWidthPct
      }))
    };
  });
}

export async function getCategoryDocumentIndex(env) {
  const result = await env.DB.prepare(`
    SELECT
      c.id,
      c.name,
      c.description,
      c.sort_order,
      c.is_active,
      COUNT(d.id) AS document_count,
      SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END) AS active_document_count,
      MIN(r.zone_number) AS first_zone_number,
      MIN(r.rack_number) AS first_rack_number
    FROM categories c
    LEFT JOIN documents d ON d.category_id = c.id
    LEFT JOIN rack_slots rs ON rs.id = d.rack_slot_id
    LEFT JOIN racks r ON r.id = rs.rack_id
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `).all();

  return result.results ?? [];
}

export async function getDocumentQualitySummary(env) {
  const [
    duplicateRows,
    missingLocation,
    missingCategory,
    invalidRackFace,
    suspiciousText,
    documentsWithoutTags,
    disposedDocuments
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT document_number, revision_number
        FROM documents
        GROUP BY document_number, revision_number
        HAVING COUNT(*) > 1
      )
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      LEFT JOIN rack_slots rs ON rs.id = d.rack_slot_id
      LEFT JOIN racks r ON r.id = rs.rack_id
      WHERE rs.id IS NULL OR r.id IS NULL
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      LEFT JOIN categories c ON c.id = d.category_id
      WHERE c.id IS NULL OR c.is_active = 0
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      JOIN racks r ON r.id = rs.rack_id
      WHERE r.is_single_sided = 1 AND d.rack_face = 'B'
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents
      WHERE document_name LIKE '%�%'
         OR document_name LIKE '%Ã%'
         OR document_name LIKE '%Â%'
         OR note LIKE '%�%'
         OR note LIKE '%Ã%'
         OR note LIKE '%Â%'
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      WHERE dt.document_id IS NULL
    `).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE status = 'disposed'").first()
  ]);

  return {
    duplicateDocumentNumbers: Number(duplicateRows?.count || 0),
    missingLocation: Number(missingLocation?.count || 0),
    missingCategory: Number(missingCategory?.count || 0),
    invalidRackFace: Number(invalidRackFace?.count || 0),
    suspiciousText: Number(suspiciousText?.count || 0),
    documentsWithoutTags: Number(documentsWithoutTags?.count || 0),
    disposedDocuments: Number(disposedDocuments?.count || 0)
  };
}

export async function getDocumentsForExport(env) {
  const result = await env.DB.prepare(`
    SELECT
      d.storage_code,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.note,
      d.rack_face,
      d.status,
      c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      rs.column_number,
      rs.shelf_number,
      rs.slot_code,
      GROUP_CONCAT(t.name, '; ') AS tag_names
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_tags dt ON dt.document_id = d.id
    LEFT JOIN tags t ON t.id = dt.tag_id
    GROUP BY d.id
    ORDER BY d.id
  `).all();

  return result.results ?? [];
}

export async function getDocument(env, id) {
  return env.DB.prepare(`
    SELECT
      d.id,
      d.storage_code,
      d.category_id,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.note,
      d.rack_slot_id,
      d.rack_face,
      d.status,
      d.updated_at,
      c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided,
      r.column_count,
      r.shelf_count,
      rs.column_number,
      rs.shelf_number,
      rs.slot_code,
      co.borrower AS checkout_borrower,
      co.purpose AS checkout_purpose,
      co.checked_out_at AS checkout_at
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_checkouts co ON co.document_id = d.id AND co.returned_at IS NULL
    WHERE d.id = ?
  `).bind(id).first();
}

// 같은 물리 슬롯(같은 rack_slot_id + 같은 면)에 꽂힌 문서들을 문서번호·개정 순으로 반환한다.
// "이웃 앵커"(찾는 문서를 앞뒤 이웃 사이에 두고 손이 바로 가게)와 "개정판 함정 차단"의 단일 조회 소스.
// "여기 없어요" 신고: 실물이 시스템 위치에 없다는 불일치를 감사 로그에 append-only로 기록한다.
// 상태변경이 아니라 사후 동기화 근거가 되는 신고이며, 신고자에게 귀속된다(비관리자도 가능).
export async function recordLocationMismatch(env, id, actor, actorRole = "User") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }
  await auditDocumentStatement(
    env,
    doc,
    "location_mismatch",
    actor,
    actorRole,
    "실물 위치 불일치 신고 (여기 없어요)",
    null
  ).run();
  return { ok: true, document: doc };
}

// "여기 없어요" 이후 다음 수: 가능성 순으로 후보를 모은다.
// (1) 반출 중이면 반출자 → (2) 같은 문서번호의 다른 사본/개정(오배치·개정 혼동) → (3) 직전 이동 위치.
export async function getRecoveryCandidates(env, document) {
  const checkout = document.checkout_borrower
    ? { borrower: document.checkout_borrower, at: document.checkout_at || "" }
    : null;

  const others = await env.DB.prepare(`
    SELECT
      d.id,
      d.revision_number,
      d.status,
      d.rack_face,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      rs.column_number,
      rs.shelf_number
    FROM documents d
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    WHERE UPPER(d.document_number) = UPPER(?) AND d.id != ?
    ORDER BY CASE d.status WHEN 'active' THEN 0 ELSE 1 END, d.revision_number
    LIMIT 10
  `).bind(document.document_number, document.id).all();

  const lastFrom = await env.DB.prepare(`
    SELECT
      from_r.code AS rack_code,
      from_r.zone_number,
      from_r.rack_number,
      from_s.column_number,
      from_s.shelf_number,
      ml.from_rack_face AS rack_face,
      ml.created_at,
      ml.performed_by
    FROM movement_logs ml
    LEFT JOIN rack_slots from_s ON from_s.id = ml.from_rack_slot_id
    LEFT JOIN racks from_r ON from_r.id = from_s.rack_id
    WHERE ml.document_id = ? AND ml.from_rack_slot_id IS NOT NULL
    ORDER BY ml.created_at DESC, ml.id DESC
    LIMIT 1
  `).bind(document.id).first();

  return { checkout, otherCopies: others.results ?? [], lastFrom: lastFrom || null };
}

export async function getSlotNeighbors(env, document) {
  if (!document || !document.rack_slot_id || !document.rack_face) {
    return [];
  }
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.status,
      co.borrower AS checkout_borrower
    FROM documents d
    LEFT JOIN document_checkouts co ON co.document_id = d.id AND co.returned_at IS NULL
    WHERE d.rack_slot_id = ? AND d.rack_face = ?
    ORDER BY d.document_number COLLATE NOCASE, d.revision_number COLLATE NOCASE
  `).bind(document.rack_slot_id, document.rack_face).all();

  return result.results ?? [];
}

export async function getDocumentTags(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT t.id, t.name
    FROM document_tags dt
    JOIN tags t ON t.id = dt.tag_id
    WHERE dt.document_id = ?
    ORDER BY t.name
  `).bind(documentId).all();

  return result.results ?? [];
}

async function getTagsByIds(env, tagIds) {
  const uniqueTagIds = [...new Set(tagIds)].filter((id) => Number.isInteger(id) && id > 0);

  if (!uniqueTagIds.length) {
    return [];
  }

  const placeholders = uniqueTagIds.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT id, name
    FROM tags
    WHERE id IN (${placeholders})
    ORDER BY name
  `).bind(...uniqueTagIds).all();

  return result.results ?? [];
}

async function getCategoryById(env, id) {
  return env.DB.prepare(`
    SELECT id, name, is_active
    FROM categories
    WHERE id = ?
  `).bind(id).first();
}

async function getSlotDetails(env, id) {
  return env.DB.prepare(`
    SELECT
      rs.id,
      rs.slot_code,
      rs.column_number,
      rs.shelf_number,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided,
      r.column_count,
      r.shelf_count
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE rs.id = ?
  `).bind(id).first();
}

export async function getDocumentMovementLogs(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT
      ml.id,
      ml.from_rack_face,
      ml.to_rack_face,
      ml.performed_by,
      ml.note,
      ml.created_at,
      from_r.code AS from_rack_code,
      from_r.zone_number AS from_zone_number,
      from_r.rack_number AS from_rack_number,
      from_s.column_number AS from_column_number,
      from_s.shelf_number AS from_shelf_number,
      from_s.slot_code AS from_slot_code,
      to_r.code AS to_rack_code,
      to_r.zone_number AS to_zone_number,
      to_r.rack_number AS to_rack_number,
      to_s.column_number AS to_column_number,
      to_s.shelf_number AS to_shelf_number,
      to_s.slot_code AS to_slot_code
    FROM movement_logs ml
    LEFT JOIN rack_slots from_s ON from_s.id = ml.from_rack_slot_id
    LEFT JOIN racks from_r ON from_r.id = from_s.rack_id
    JOIN rack_slots to_s ON to_s.id = ml.to_rack_slot_id
    JOIN racks to_r ON to_r.id = to_s.rack_id
    WHERE ml.document_id = ?
    ORDER BY ml.created_at DESC, ml.id DESC
  `).bind(documentId).all();

  return result.results ?? [];
}

export async function getDisposalLogs(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT id, action, performed_by, reason, created_at
    FROM disposal_logs
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(documentId).all();

  return result.results ?? [];
}

export async function getDocumentAuditLogs(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT id, action, actor, actor_role, summary, details, created_at
    FROM document_audit_logs
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(documentId).all();

  return result.results ?? [];
}

function auditDocumentStatement(env, document, action, actor, actorRole, summary, details = null) {
  return env.DB.prepare(`
    INSERT INTO document_audit_logs (
      document_id,
      storage_code,
      document_number,
      action,
      actor,
      actor_role,
      summary,
      details
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    document.id,
    document.storage_code,
    document.document_number,
    action,
    actor || "알 수 없음",
    actorRole || "Unknown",
    summary,
    details ? JSON.stringify(details) : null
  );
}

// 상태변경(UPDATE/DELETE)과 같은 batch(트랜잭션)에서 실행하는 조건부 감사 로그.
// guardClause를 아직 만족하는 문서에만 기록되므로, 같은 조건의 가드 statement가 no-op이면
// 감사 로그도 함께 0행이 된다 — 감사기록 없는 상태변경(2차 쓰기 실패)과 유령 로그를 모두 막는다.
// 반드시 가드 UPDATE/DELETE '앞'에 두어 pre-state를 읽게 한다.
function conditionalAuditStatement(env, document, action, actor, actorRole, summary, details, guardClause, guardBinds = []) {
  return env.DB.prepare(`
    INSERT INTO document_audit_logs (
      document_id,
      storage_code,
      document_number,
      action,
      actor,
      actor_role,
      summary,
      details
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    FROM documents
    WHERE ${guardClause}
  `).bind(
    document.id,
    document.storage_code,
    document.document_number,
    action,
    actor || "알 수 없음",
    actorRole || "Unknown",
    summary,
    details ? JSON.stringify(details) : null,
    ...guardBinds
  );
}

// 낙관적 잠금 절: 사용자가 화면을 연 시점의 updated_at과 현재가 다르면(다른 관리자가 먼저 수정)
// 가드에 걸려 no-op이 된다. expectedUpdatedAt이 비어 있으면 잠금 없이 기존 동작(하위호환).
function optimisticLockClause(expectedUpdatedAt) {
  const expected = clean(expectedUpdatedAt);
  if (!expected) {
    return { sql: "", binds: [] };
  }
  return { sql: " AND updated_at = ?", binds: [expected] };
}

function documentSnapshot(document, tags = []) {
  return {
    storageCode: document.storage_code,
    documentNumber: document.document_number,
    revisionNumber: document.revision_number,
    documentName: document.document_name,
    categoryName: document.category_name,
    zoneNumber: document.zone_number,
    rackNumber: document.rack_number,
    rackCode: document.rack_code,
    columnNumber: document.column_number,
    shelfNumber: document.shelf_number,
    slotCode: document.slot_code,
    rackFace: document.rack_face,
    status: document.status,
    note: document.note || "",
    tags: tags.map((tag) => tag.name).sort()
  };
}

async function documentWithValues(env, baseDocument, values, status = baseDocument.status) {
  const [category, slot] = await Promise.all([
    getCategoryById(env, values.categoryId),
    getSlotDetails(env, values.rackSlotId)
  ]);

  return {
    ...baseDocument,
    category_id: values.categoryId,
    category_name: category?.name ?? baseDocument.category_name,
    document_number: values.documentNumber,
    revision_number: values.revisionNumber,
    document_name: values.documentName,
    note: values.note || null,
    rack_slot_id: values.rackSlotId,
    rack_face: values.rackFace,
    status,
    rack_code: slot?.rack_code ?? baseDocument.rack_code,
    zone_number: slot?.zone_number ?? baseDocument.zone_number,
    rack_number: slot?.rack_number ?? baseDocument.rack_number,
    is_single_sided: slot?.is_single_sided ?? baseDocument.is_single_sided,
    column_count: slot?.column_count ?? baseDocument.column_count,
    shelf_count: slot?.shelf_count ?? baseDocument.shelf_count,
    column_number: slot?.column_number ?? baseDocument.column_number,
    shelf_number: slot?.shelf_number ?? baseDocument.shelf_number,
    slot_code: slot?.slot_code ?? baseDocument.slot_code
  };
}

function insertDocumentTagStatementsByTempCode(env, temporaryStorageCode, tagIds) {
  return [...new Set(tagIds || [])].map((tagId) =>
    env.DB.prepare(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      SELECT id, ?
      FROM documents
      WHERE storage_code = ?
    `).bind(tagId, temporaryStorageCode)
  );
}


function hasChanged(result) {
  return Number(result?.meta?.changes ?? 0) > 0;
}

function createDocumentAuditStatement(env, temporaryStorageCode, actor, actorRole) {
  return env.DB.prepare(`
    INSERT INTO document_audit_logs (
      document_id,
      storage_code,
      document_number,
      action,
      actor,
      actor_role,
      summary,
      details
    )
    SELECT
      d.id,
      'ARC-' || printf('%06d', d.id),
      d.document_number,
      'create',
      ?,
      ?,
      '문서 등록',
      json_object(
        'after',
        json_object(
          'storageCode', 'ARC-' || printf('%06d', d.id),
          'documentNumber', d.document_number,
          'revisionNumber', d.revision_number,
          'documentName', d.document_name,
          'categoryName', c.name,
          'zoneNumber', r.zone_number,
          'rackNumber', r.rack_number,
          'rackCode', r.code,
          'columnNumber', rs.column_number,
          'shelfNumber', rs.shelf_number,
          'slotCode', rs.slot_code,
          'rackFace', d.rack_face,
          'status', d.status,
          'note', IFNULL(d.note, ''),
          'tags', COALESCE((
            SELECT json_group_array(name)
            FROM (
              SELECT t.name AS name
              FROM document_tags dt
              JOIN tags t ON t.id = dt.tag_id
              WHERE dt.document_id = d.id
              ORDER BY t.name
            )
          ), json('[]'))
        )
      )
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    WHERE d.storage_code = ?
  `).bind(actor || "알 수 없음", actorRole || "Unknown", temporaryStorageCode);
}

export async function getRackSummaries(env) {
  const result = await env.DB.prepare(`
    SELECT
      r.id,
      r.zone_number,
      r.rack_number,
      r.code,
      r.name,
      r.description,
      r.is_single_sided,
      r.is_active,
      r.column_count,
      r.shelf_count,
      COUNT(d.id) AS document_count,
      SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END) AS active_document_count
    FROM racks r
    LEFT JOIN rack_slots rs ON rs.rack_id = r.id
    LEFT JOIN documents d ON d.rack_slot_id = rs.id
    WHERE r.is_active = 1
    GROUP BY r.id
    ORDER BY r.zone_number, r.rack_number
  `).all();

  return result.results ?? [];
}

export async function getRackDetails(env, id) {
  return env.DB.prepare(`
    SELECT id, zone_number, rack_number, code, name, description, is_single_sided, is_active, column_count, shelf_count
    FROM racks
    WHERE id = ?
  `).bind(id).first();
}

export async function getRackDocuments(env, rackId) {
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      d.storage_code,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.rack_face,
      d.status,
      c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      rs.column_number,
      rs.shelf_number,
      rs.slot_code,
      co.borrower AS checkout_borrower,
      co.checked_out_at AS checkout_at
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_checkouts co ON co.document_id = d.id AND co.returned_at IS NULL
    WHERE r.id = ?
    ORDER BY d.rack_face, rs.column_number, rs.shelf_number, d.document_number
  `).bind(rackId).all();

  return result.results ?? [];
}

export async function getCategories(env) {
  const result = await env.DB.prepare(`
    SELECT id, name, description, sort_order, is_active
    FROM categories
    ORDER BY sort_order, name
  `).all();

  return result.results ?? [];
}

export async function getActiveCategories(env) {
  const result = await env.DB.prepare(`
    SELECT id, name
    FROM categories
    WHERE is_active = 1
    ORDER BY sort_order, name
  `).all();

  return result.results ?? [];
}

export async function getTags(env) {
  const result = await env.DB.prepare(`
    SELECT id, name, description, is_active
    FROM tags
    ORDER BY name
  `).all();

  return result.results ?? [];
}

export async function getActiveTags(env) {
  const result = await env.DB.prepare(`
    SELECT id, name
    FROM tags
    WHERE is_active = 1
    ORDER BY name
  `).all();

  return result.results ?? [];
}

export async function upsertCategory(env, values) {
  const name = clean(values.name);
  if (!name) {
    return { ok: false, message: "카테고리 이름은 필수입니다." };
  }

  const sortOrder = Number.isFinite(values.sortOrder) ? values.sortOrder : 0;

  try {
    if (values.id) {
      const result = await env.DB.prepare(`
        UPDATE categories
        SET name = ?,
            description = ?,
            sort_order = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(name, clean(values.description) || null, sortOrder, values.isActive ? 1 : 0, values.id).run();

      return result.meta.changes > 0 ? { ok: true } : { ok: false, message: "카테고리를 찾을 수 없습니다." };
    }

    await env.DB.prepare(`
      INSERT INTO categories (name, description, sort_order, is_active, updated_at)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(name, clean(values.description) || null, sortOrder).run();

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error.message.includes("UNIQUE") ? "같은 이름의 카테고리가 이미 있습니다." : error.message
    };
  }
}

export async function deleteCategory(env, id) {
  const result = await env.DB.prepare(`
    UPDATE categories
    SET is_active = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(id).run();

  return result.meta.changes > 0 ? { ok: true } : { ok: false, message: "카테고리를 찾을 수 없습니다." };
}

export async function upsertTag(env, values) {
  const name = clean(values.name);
  if (!name) {
    return { ok: false, message: "태그 이름은 필수입니다." };
  }

  try {
    if (values.id) {
      const result = await env.DB.prepare(`
        UPDATE tags
        SET name = ?,
            description = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(name, clean(values.description) || null, values.isActive ? 1 : 0, values.id).run();

      return result.meta.changes > 0 ? { ok: true } : { ok: false, message: "태그를 찾을 수 없습니다." };
    }

    await env.DB.prepare(`
      INSERT INTO tags (name, description, is_active, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(name, clean(values.description) || null).run();

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error.message.includes("UNIQUE") ? "같은 이름의 태그가 이미 있습니다." : error.message
    };
  }
}

export async function deleteTag(env, id) {
  const result = await env.DB.prepare(`
    UPDATE tags
    SET is_active = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(id).run();

  return result.meta.changes > 0 ? { ok: true } : { ok: false, message: "태그를 찾을 수 없습니다." };
}

export async function getAppUsers(env) {
  const result = await env.DB.prepare(`
    SELECT id, username, display_name, status, role, requested_at, approved_at, approved_by, rejected_at, rejected_by
    FROM app_users
    ORDER BY
      CASE role WHEN 'Admin' THEN 0 ELSE 1 END,
      CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      requested_at DESC,
      id DESC
  `).all();

  return result.results ?? [];
}

export async function createSignupRequest(env, values) {
  const username = clean(values.username);
  const displayName = clean(values.displayName) || username;
  const password = String(values.password ?? "");

  if (!username || username.length < 4) {
    return { ok: false, message: "아이디는 4자 이상이어야 합니다." };
  }

  if (!password || password.length < 8) {
    return { ok: false, message: "비밀번호는 8자 이상이어야 합니다." };
  }

  const existing = await env.DB.prepare(`
    SELECT id, status
    FROM app_users
    WHERE username = ?
  `).bind(username).first();

  if (existing?.status === "pending") {
    return { ok: false, message: "이미 승인 대기 중인 아이디입니다." };
  }

  if (existing?.status === "approved") {
    return { ok: false, message: "이미 승인된 아이디입니다." };
  }

  const passwordRecord = await createPasswordRecord(password);

  if (existing?.status === "rejected") {
    await env.DB.prepare(`
      UPDATE app_users
      SET
        display_name = ?,
        password_salt = ?,
        password_hash = ?,
        status = 'pending',
        requested_at = CURRENT_TIMESTAMP,
        approved_at = NULL,
        approved_by = NULL,
        rejected_at = NULL,
        rejected_by = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(displayName, passwordRecord.salt, passwordRecord.hash, existing.id).run();

    return { ok: true };
  }

  await env.DB.prepare(`
    INSERT INTO app_users (username, display_name, password_salt, password_hash, status, updated_at)
    VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `).bind(username, displayName, passwordRecord.salt, passwordRecord.hash).run();

  return { ok: true };
}

export async function approveUser(env, id, actor) {
  const result = await env.DB.prepare(`
    UPDATE app_users
    SET status = 'approved',
        approved_at = CURRENT_TIMESTAMP,
        approved_by = ?,
        rejected_at = NULL,
        rejected_by = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'User' AND status IN ('pending', 'rejected')
  `).bind(actor, id).run();

  return { ok: result.meta.changes > 0 };
}

export async function rejectUser(env, id, actor) {
  const result = await env.DB.prepare(`
    UPDATE app_users
    SET status = 'rejected',
        rejected_at = CURRENT_TIMESTAMP,
        rejected_by = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'User' AND status IN ('pending', 'approved')
  `).bind(actor, id).run();

  return { ok: result.meta.changes > 0 };
}

export async function getSlotOptions(env) {
  const result = await env.DB.prepare(`
    SELECT
      rs.id,
      rs.slot_code,
      rs.column_number,
      rs.shelf_number,
      r.code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE rs.is_active = 1 AND r.is_active = 1
    ORDER BY r.zone_number, r.rack_number, rs.column_number, rs.shelf_number
  `).all();

  return (result.results ?? []).map((slot) => ({
    ...slot,
    label: `${slot.zone_number}구역 / ${slot.rack_number}번랙 / ${slot.column_number}열 / ${slot.shelf_number}선반${slot.is_single_sided ? " / 단면" : ""}`
  }));
}

export const DOCUMENT_FIELD_LIMITS = Object.freeze({
  documentNumber: 100,
  revisionNumber: 50,
  documentName: 300,
  note: 2000
});

export async function validateDocumentInput(env, values, existingId = 0, options = {}) {
  if (!values.documentNumber || !values.revisionNumber || !values.documentName) {
    return "문서번호, 개정번호, 문서명은 필수입니다.";
  }

  // 자유 입력 필드 길이 상한: 저장소·검색 인덱스 팽창(저장 고갈 DoS)과 기록 신뢰도 저하 방지.
  if (clean(values.documentNumber).length > DOCUMENT_FIELD_LIMITS.documentNumber) {
    return `문서번호는 ${DOCUMENT_FIELD_LIMITS.documentNumber}자 이하로 입력하세요.`;
  }
  if (clean(values.revisionNumber).length > DOCUMENT_FIELD_LIMITS.revisionNumber) {
    return `개정번호는 ${DOCUMENT_FIELD_LIMITS.revisionNumber}자 이하로 입력하세요.`;
  }
  if (clean(values.documentName).length > DOCUMENT_FIELD_LIMITS.documentName) {
    return `문서명은 ${DOCUMENT_FIELD_LIMITS.documentName}자 이하로 입력하세요.`;
  }
  if (clean(values.note).length > DOCUMENT_FIELD_LIMITS.note) {
    return `비고는 ${DOCUMENT_FIELD_LIMITS.note}자 이하로 입력하세요.`;
  }

  if (!Number.isInteger(values.categoryId) || values.categoryId <= 0) {
    return "대분류를 선택하세요.";
  }

  if (!Number.isInteger(values.rackSlotId) || values.rackSlotId <= 0) {
    return "보관 위치를 선택하세요.";
  }

  if (!["A", "B"].includes(values.rackFace)) {
    return "보관 면은 A 또는 B만 가능합니다.";
  }

  const category = await env.DB.prepare(`
    SELECT id, is_active FROM categories
    WHERE id = ?
  `).bind(values.categoryId).first();

  const allowInactiveCategory = options.allowInactiveCategory === true ||
    Number(options.allowInactiveCategoryId) === values.categoryId;

  if (!category || (!category.is_active && !allowInactiveCategory)) {
    return "사용 가능한 대분류가 아닙니다.";
  }

  const slot = await env.DB.prepare(`
    SELECT rs.id, r.is_single_sided
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE rs.id = ? AND rs.is_active = 1 AND r.is_active = 1
  `).bind(values.rackSlotId).first();

  if (!slot) {
    return "사용 가능한 보관 위치가 아닙니다.";
  }

  if (slot.is_single_sided && values.rackFace === "B") {
    return "단면 랙은 B면을 선택할 수 없습니다.";
  }

  return "";
}

export async function createDocument(env, values, actor, actorRole = "User") {
  const temporaryStorageCode = `TEMP-${crypto.randomUUID()}`;
  const statements = [
    env.DB.prepare(`
      INSERT INTO documents (
        storage_code,
        category_id,
        document_number,
        revision_number,
        document_name,
        note,
        rack_slot_id,
        rack_face,
        status,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
      RETURNING id
    `).bind(
      temporaryStorageCode,
      values.categoryId,
      values.documentNumber,
      values.revisionNumber,
      values.documentName,
      values.note || null,
      values.rackSlotId,
      values.rackFace
    ),
    ...insertDocumentTagStatementsByTempCode(env, temporaryStorageCode, values.tagIds),
    env.DB.prepare(`
      INSERT INTO movement_logs (document_id, to_rack_slot_id, to_rack_face, performed_by, note)
      SELECT id, ?, ?, ?, ?
      FROM documents
      WHERE storage_code = ?
    `).bind(values.rackSlotId, values.rackFace, actor, "초기 등록", temporaryStorageCode),
    createDocumentAuditStatement(env, temporaryStorageCode, actor, actorRole),
    env.DB.prepare(`
      UPDATE documents
      SET storage_code = 'ARC-' || printf('%06d', id),
          updated_at = CURRENT_TIMESTAMP
      WHERE storage_code = ?
    `).bind(temporaryStorageCode)
  ];

  const result = await env.DB.batch(statements);
  const createdId = result[0]?.results?.[0]?.id;

  if (!createdId) {
    throw new Error("문서 등록 결과를 확인할 수 없습니다.");
  }

  return createdId;
}

export async function updateDocument(env, id, values, actor, actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  if (doc.status === "disposed") {
    return { ok: false, message: "폐기 상태 문서는 폐기를 해제하기 전까지 수정할 수 없습니다." };
  }

  const [beforeTags, afterTags, updated] = await Promise.all([
    getDocumentTags(env, id),
    getTagsByIds(env, values.tagIds),
    documentWithValues(env, doc, values)
  ]);

  const lock = optimisticLockClause(values.expectedUpdatedAt);
  const guardClause = `id = ? AND status = 'active'${lock.sql}`;
  const guardBinds = [id, ...lock.binds];
  const existsGuard = `EXISTS (SELECT 1 FROM documents WHERE ${guardClause})`;

  // 상태변경(UPDATE)·태그 교체·감사 로그를 하나의 batch(트랜잭션)로 원자화한다.
  // 모든 부수효과는 pre-state 가드에 묶여, 낙관적 잠금 실패 시 태그도 감사도 함께 no-op이 된다.
  const uniqueTagIds = [...new Set(values.tagIds || [])];
  const statements = [
    conditionalAuditStatement(env, updated, "update", actor, actorRole, "문서 정보 수정", {
      before: documentSnapshot(doc, beforeTags),
      after: documentSnapshot(updated, afterTags)
    }, guardClause, guardBinds),
    env.DB.prepare(`DELETE FROM document_tags WHERE document_id = ? AND ${existsGuard}`).bind(id, ...guardBinds),
    ...uniqueTagIds.map((tagId) =>
      env.DB.prepare(`INSERT OR IGNORE INTO document_tags (document_id, tag_id) SELECT ?, ? WHERE ${existsGuard}`).bind(id, tagId, ...guardBinds)
    ),
    env.DB.prepare(`
      UPDATE documents
      SET
        category_id = ?,
        document_number = ?,
        revision_number = ?,
        document_name = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE ${guardClause}
    `).bind(
      values.categoryId,
      values.documentNumber,
      values.revisionNumber,
      values.documentName,
      values.note || null,
      ...guardBinds
    )
  ];

  const results = await env.DB.batch(statements);
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "다른 사용자가 문서를 먼저 수정했거나 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}

export async function moveDocument(env, id, values, actor, actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  if (doc.status === "disposed") {
    return { ok: false, message: "폐기 상태 문서는 폐기를 해제하기 전까지 이동할 수 없습니다." };
  }

  const tags = await getDocumentTags(env, id);
  const moved = await documentWithValues(env, doc, values);

  const lock = optimisticLockClause(values.expectedUpdatedAt);
  const guardClause = `id = ? AND status = 'active'${lock.sql}`;
  const guardBinds = [id, ...lock.binds];

  // 이동 기록·감사 로그를 상태변경과 하나의 batch로 원자화한다. 로그는 pre-state 가드에 묶여
  // 가드 UPDATE와 함께 no-op이 되므로 이동기록 없는 위치변경(물리 이력 소실)을 막는다.
  const statements = [
    env.DB.prepare(`
      INSERT INTO movement_logs (
        document_id,
        from_rack_slot_id,
        from_rack_face,
        to_rack_slot_id,
        to_rack_face,
        performed_by,
        note
      )
      SELECT ?, ?, ?, ?, ?, ?, ?
      FROM documents
      WHERE ${guardClause}
    `).bind(
      id,
      doc.rack_slot_id,
      doc.rack_face,
      values.rackSlotId,
      values.rackFace,
      actor,
      values.note || null,
      ...guardBinds
    ),
    conditionalAuditStatement(env, moved, "move", actor, actorRole, "문서 위치 이동", {
      before: documentSnapshot(doc, tags),
      after: documentSnapshot(moved, tags),
      note: values.note || ""
    }, guardClause, guardBinds),
    env.DB.prepare(`
      UPDATE documents
      SET rack_slot_id = ?, rack_face = ?, updated_at = CURRENT_TIMESTAMP
      WHERE ${guardClause}
    `).bind(values.rackSlotId, values.rackFace, ...guardBinds)
  ];

  const results = await env.DB.batch(statements);
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "다른 사용자가 문서를 먼저 이동/수정했거나 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}

export async function disposeDocument(env, id, actor, reason, actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  if (doc.status === "disposed") {
    return { ok: true };
  }

  if (doc.checkout_borrower) {
    return { ok: false, message: `반출 중인 문서(반출자: ${doc.checkout_borrower})는 반납 처리 후 폐기할 수 있습니다.` };
  }

  const tags = await getDocumentTags(env, id);
  const disposed = { ...doc, status: "disposed" };
  const guardClause = "id = ? AND status = 'active'";
  const guardBinds = [id];

  // 폐기 기록·감사 로그를 상태변경과 하나의 batch로 원자화한다(pre-state 가드 → no-op 시 함께 0행).
  const statements = [
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason)
      SELECT ?, 'disposed', ?, ?
      FROM documents
      WHERE ${guardClause}
    `).bind(id, actor, reason || null, ...guardBinds),
    conditionalAuditStatement(env, disposed, "dispose", actor, actorRole, "문서 폐기", {
      before: documentSnapshot(doc, tags),
      after: documentSnapshot(disposed, tags),
      reason: reason || ""
    }, guardClause, guardBinds),
    env.DB.prepare(`
      UPDATE documents
      SET status = 'disposed', updated_at = CURRENT_TIMESTAMP
      WHERE ${guardClause}
    `).bind(...guardBinds)
  ];

  const results = await env.DB.batch(statements);
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "문서 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}

export async function restoreDocument(env, id, actor, actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  if (doc.status !== "disposed") {
    return { ok: true };
  }

  const tags = await getDocumentTags(env, id);
  const restored = { ...doc, status: "active" };
  const guardClause = "id = ? AND status = 'disposed'";
  const guardBinds = [id];

  // 폐기해제 기록·감사 로그를 상태변경과 하나의 batch로 원자화한다(pre-state 가드 → no-op 시 함께 0행).
  const statements = [
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason)
      SELECT ?, 'restored', ?, ?
      FROM documents
      WHERE ${guardClause}
    `).bind(id, actor, "관리자 폐기 해제", ...guardBinds),
    conditionalAuditStatement(env, restored, "restore", actor, actorRole, "문서 폐기 해제", {
      before: documentSnapshot(doc, tags),
      after: documentSnapshot(restored, tags)
    }, guardClause, guardBinds),
    env.DB.prepare(`
      UPDATE documents
      SET status = 'active', updated_at = CURRENT_TIMESTAMP
      WHERE ${guardClause}
    `).bind(...guardBinds)
  ];

  const results = await env.DB.batch(statements);
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "문서 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}

export async function checkoutDocument(env, id, values, actor, actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  if (doc.status === "disposed") {
    return { ok: false, message: "폐기 상태 문서는 반출할 수 없습니다." };
  }

  if (doc.checkout_borrower) {
    return { ok: false, message: `이미 반출 중인 문서입니다(반출자: ${doc.checkout_borrower}). 먼저 반납 처리하세요.` };
  }

  const borrower = clean(values.borrower);
  if (!borrower) {
    return { ok: false, message: "반출자 이름을 입력하세요." };
  }

  const purpose = clean(values.purpose);

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO document_checkouts (document_id, borrower, purpose, checked_out_by)
        VALUES (?, ?, ?, ?)
      `).bind(id, borrower, purpose || null, actor || "알 수 없음"),
      auditDocumentStatement(env, doc, "checkout", actor, actorRole, `문서 반출 (반출자: ${borrower})`, {
        borrower,
        purpose
      })
    ]);
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      return { ok: false, message: "이미 반출 중인 문서입니다. 먼저 반납 처리하세요." };
    }
    throw error;
  }

  return { ok: true };
}

export async function returnDocument(env, id, actor, actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  // 반납(UPDATE)과 감사 로그를 하나의 batch로 원자화한다. 감사 로그는 '열린 반출이 있을 때'만
  // 기록되도록 pre-state 가드에 묶어, 반납 UPDATE가 no-op이면 유령 반납 로그가 남지 않는다.
  const summary = `문서 반납 (반출자: ${doc.checkout_borrower || "-"})`;
  const details = JSON.stringify({
    borrower: doc.checkout_borrower || "",
    purpose: doc.checkout_purpose || ""
  });
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_audit_logs (
        document_id, storage_code, document_number, action, actor, actor_role, summary, details
      )
      SELECT ?, ?, ?, 'return', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM document_checkouts WHERE document_id = ? AND returned_at IS NULL)
    `).bind(doc.id, doc.storage_code, doc.document_number, actor || "알 수 없음", actorRole || "Unknown", summary, details, id),
    env.DB.prepare(`
      UPDATE document_checkouts
      SET returned_at = CURRENT_TIMESTAMP,
          returned_by = ?
      WHERE document_id = ? AND returned_at IS NULL
    `).bind(actor || "알 수 없음", id)
  ];

  const results = await env.DB.batch(statements);
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "반출 중인 문서가 아닙니다." };
  }

  return { ok: true };
}

export async function getDocumentCheckoutLogs(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT id, borrower, purpose, checked_out_by, checked_out_at, returned_by, returned_at
    FROM document_checkouts
    WHERE document_id = ?
    ORDER BY checked_out_at DESC, id DESC
  `).bind(documentId).all();

  return result.results ?? [];
}

export async function permanentlyDeleteDocument(env, id, actor = "알 수 없음", actorRole = "Admin") {
  const doc = await getDocument(env, id);
  if (!doc) {
    return { ok: true };
  }

  if (doc.status !== "disposed") {
    return { ok: false, message: "보관중 문서는 완전삭제할 수 없습니다. 먼저 폐기 처리해야 합니다." };
  }

  // 하드삭제는 ON DELETE CASCADE로 이동/폐기/반출 이력을 함께 파괴한다. GMP 기록 보존을 위해
  // 삭제 직전 전체 이력을 불변 감사 로그(document_audit_logs, documents FK 없음)의 details에
  // 스냅샷으로 보존한다(ALCOA Enduring/Complete). 감사·삭제를 하나의 batch로 원자화.
  const [tags, movementLogs, disposalLogs, checkoutLogs] = await Promise.all([
    getDocumentTags(env, id),
    getDocumentMovementLogs(env, id),
    getDisposalLogs(env, id),
    getDocumentCheckoutLogs(env, id)
  ]);
  const guardClause = "id = ? AND status = 'disposed'";
  const guardBinds = [id];

  const statements = [
    conditionalAuditStatement(env, doc, "delete_permanent", actor, actorRole, "문서 완전삭제", {
      before: documentSnapshot(doc, tags),
      history: {
        movements: movementLogs,
        disposals: disposalLogs,
        checkouts: checkoutLogs
      }
    }, guardClause, guardBinds),
    env.DB.prepare(`DELETE FROM documents WHERE ${guardClause}`).bind(...guardBinds)
  ];

  const results = await env.DB.batch(statements);
  if (!hasChanged(results[results.length - 1])) {
    return { ok: false, message: "문서 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  return { ok: true };
}

export async function upsertRack(env, values) {
  if (values.rackNumber < 1 || values.rackNumber > MAX_RACKS_PER_ZONE) {
    throw new Error(`랙 번호는 구역당 1~${MAX_RACKS_PER_ZONE} 사이여야 합니다.`);
  }

  if (values.columnCount < 1 || values.columnCount > MAX_RACK_COLUMNS || values.shelfCount < 1 || values.shelfCount > MAX_RACK_SHELVES) {
    throw new Error(`랙 구조는 1~${MAX_RACK_COLUMNS}열, 1~${MAX_RACK_SHELVES}선반 사이로 설정해야 합니다.`);
  }

  const code = `${values.zoneNumber}-${String(values.rackNumber).padStart(2, "0")}`;

  if (values.id) {
    const blocked = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      WHERE rs.rack_id = ?
        AND (rs.column_number > ? OR rs.shelf_number > ?)
    `).bind(values.id, values.columnCount, values.shelfCount).first();

    if ((blocked?.count ?? 0) > 0) {
      throw new Error("줄이려는 열/선반 범위 밖에 문서가 있어 랙 구조를 변경할 수 없습니다.");
    }

    await env.DB.prepare(`
      UPDATE racks
      SET
        zone_number = ?,
        rack_number = ?,
        code = ?,
        name = ?,
        description = ?,
        is_single_sided = ?,
        is_active = ?,
        column_count = ?,
        shelf_count = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      values.zoneNumber,
      values.rackNumber,
      code,
      values.name || null,
      values.description || null,
      values.isSingleSided ? 1 : 0,
      values.isActive ? 1 : 0,
      values.columnCount,
      values.shelfCount,
      values.id
    ).run();

    await syncRackSlots(env, values.id, values.columnCount, values.shelfCount);
    return values.id;
  }

  const row = await env.DB.prepare(`
    INSERT INTO racks (
      zone_number,
      rack_number,
      code,
      name,
      description,
      is_single_sided,
      is_active,
      column_count,
      shelf_count,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
    RETURNING id
  `).bind(
    values.zoneNumber,
    values.rackNumber,
    code,
    values.name || null,
    values.description || null,
    values.isSingleSided ? 1 : 0,
    values.columnCount,
    values.shelfCount
  ).first();

  await createDefaultSlots(env, row.id, values.columnCount, values.shelfCount);
  return row.id;
}

export async function createDefaultSlots(env, rackId, columnCount = DEFAULT_RACK_COLUMNS, shelfCount = DEFAULT_RACK_SHELVES) {
  await syncRackSlots(env, rackId, columnCount, shelfCount);
}

async function syncRackSlots(env, rackId, columnCount, shelfCount) {
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE rack_slots
      SET
        is_active = CASE
          WHEN column_number BETWEEN 1 AND ? AND shelf_number BETWEEN 1 AND ? THEN 1
          ELSE 0
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE rack_id = ?
    `).bind(columnCount, shelfCount, rackId),
    env.DB.prepare(`
      WITH RECURSIVE
        col_nums(column_number) AS (
          VALUES(1)
          UNION ALL
          SELECT column_number + 1 FROM col_nums WHERE column_number < ?
        ),
        shelf_nums(shelf_number) AS (
          VALUES(1)
          UNION ALL
          SELECT shelf_number + 1 FROM shelf_nums WHERE shelf_number < ?
        )
      INSERT INTO rack_slots (
        rack_id,
        slot_code,
        column_number,
        shelf_number,
        description,
        is_active,
        updated_at
      )
      SELECT
        ?,
        printf('%d-%d', col_nums.column_number, shelf_nums.shelf_number),
        col_nums.column_number,
        shelf_nums.shelf_number,
        printf('%d열 %d선반', col_nums.column_number, shelf_nums.shelf_number),
        1,
        CURRENT_TIMESTAMP
      FROM col_nums
      CROSS JOIN shelf_nums
      WHERE 1 = 1
      ON CONFLICT(rack_id, slot_code) DO UPDATE SET
        column_number = excluded.column_number,
        shelf_number = excluded.shelf_number,
        description = excluded.description,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(columnCount, shelfCount, rackId)
  ]);
}

export async function configureRackCounts(env, counts) {
  for (const zone of RACK_ZONES) {
    if (!Number.isInteger(counts[zone]) || counts[zone] < 0 || counts[zone] > MAX_RACKS_PER_ZONE) {
      return { ok: false, message: `구역별 랙 수는 0~${MAX_RACKS_PER_ZONE} 사이여야 합니다.` };
    }
  }

  const usedRows = await env.DB.prepare(`
    SELECT r.zone_number, MAX(r.rack_number) AS max_used_rack
    FROM racks r
    JOIN rack_slots rs ON rs.rack_id = r.id
    JOIN documents d ON d.rack_slot_id = rs.id
    GROUP BY r.zone_number
  `).all();

  for (const row of usedRows.results ?? []) {
    if (counts[row.zone_number] < row.max_used_rack) {
      return {
        ok: false,
        message: `${row.zone_number}구역 ${row.max_used_rack}번 랙에 문서가 있어 ${counts[row.zone_number]}개로 줄일 수 없습니다.`
      };
    }
  }

  await env.DB.batch([
    env.DB.prepare(`
      WITH RECURSIVE nums(rack_number) AS (
        VALUES(1)
        UNION ALL
        SELECT rack_number + 1 FROM nums WHERE rack_number < ?
      ),
      zones(zone_number) AS (
        VALUES(1), (2), (3)
      )
      INSERT INTO racks (
        zone_number,
        rack_number,
        code,
        name,
        description,
        is_single_sided,
        is_active,
        column_count,
        shelf_count,
        updated_at
      )
      SELECT
        zones.zone_number,
        nums.rack_number,
        printf('%d-%02d', zones.zone_number, nums.rack_number),
        printf('%d구역 %02d번 랙', zones.zone_number, nums.rack_number),
        printf('%d구역 운영 랙', zones.zone_number),
        0,
        CASE
          WHEN zones.zone_number = 1 AND nums.rack_number <= ? THEN 1
          WHEN zones.zone_number = 2 AND nums.rack_number <= ? THEN 1
          WHEN zones.zone_number = 3 AND nums.rack_number <= ? THEN 1
          ELSE 0
        END,
        ?,
        ?,
        CURRENT_TIMESTAMP
      FROM zones
      CROSS JOIN nums
      WHERE 1 = 1
      ON CONFLICT(zone_number, rack_number) DO NOTHING
    `).bind(MAX_RACKS_PER_ZONE, counts[1], counts[2], counts[3], DEFAULT_RACK_COLUMNS, DEFAULT_RACK_SHELVES),
    env.DB.prepare(`
      UPDATE racks
      SET is_active = CASE
            WHEN zone_number = 1 AND rack_number <= ? THEN 1
            WHEN zone_number = 2 AND rack_number <= ? THEN 1
            WHEN zone_number = 3 AND rack_number <= ? THEN 1
            ELSE 0
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE zone_number IN (1, 2, 3)
        AND rack_number BETWEEN 1 AND ?
    `).bind(counts[1], counts[2], counts[3], MAX_RACKS_PER_ZONE),
    env.DB.prepare(`
      WITH RECURSIVE default_slots(shelf_number) AS (
        VALUES(1)
        UNION ALL
        SELECT shelf_number + 1 FROM default_slots WHERE shelf_number < ?
      )
      INSERT INTO rack_slots (
        rack_id,
        slot_code,
        column_number,
        shelf_number,
        description,
        is_active,
        updated_at
      )
      SELECT
        r.id,
        printf('%d-%d', ?, default_slots.shelf_number),
        ?,
        default_slots.shelf_number,
        printf('%d열 %d선반', ?, default_slots.shelf_number),
        1,
        CURRENT_TIMESTAMP
      FROM racks r
      CROSS JOIN default_slots
      WHERE r.zone_number IN (1, 2, 3)
        AND r.rack_number BETWEEN 1 AND ?
      ON CONFLICT(rack_id, slot_code) DO UPDATE SET
        column_number = excluded.column_number,
        shelf_number = excluded.shelf_number,
        description = excluded.description,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(DEFAULT_RACK_SHELVES, DEFAULT_RACK_COLUMNS, DEFAULT_RACK_COLUMNS, DEFAULT_RACK_COLUMNS, MAX_RACKS_PER_ZONE)
  ]);

  return { ok: true };
}

export async function getDocumentSets(env) {
  const result = await env.DB.prepare(`
    SELECT
      s.id,
      s.name,
      s.description,
      s.created_at,
      s.updated_at,
      COUNT(i.document_id) AS document_count,
      SUM(CASE WHEN d.status = 'disposed' THEN 1 ELSE 0 END) AS disposed_count
    FROM document_sets s
    LEFT JOIN document_set_items i ON i.set_id = s.id
    LEFT JOIN documents d ON d.id = i.document_id
    GROUP BY s.id
    ORDER BY s.name
  `).all();

  return result.results ?? [];
}

export async function getDocumentSet(env, id) {
  return env.DB.prepare(`
    SELECT id, name, description, created_by, created_at, updated_at
    FROM document_sets
    WHERE id = ?
  `).bind(id).first();
}

export async function getDocumentSetDocuments(env, setId) {
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      d.storage_code,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.note,
      d.rack_face,
      d.status,
      c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      rs.column_number,
      rs.shelf_number,
      rs.slot_code,
      co.borrower AS checkout_borrower,
      co.checked_out_at AS checkout_at
    FROM document_set_items i
    JOIN documents d ON d.id = i.document_id
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_checkouts co ON co.document_id = d.id AND co.returned_at IS NULL
    WHERE i.set_id = ?
    ORDER BY r.zone_number, r.rack_number, d.rack_face, rs.column_number, rs.shelf_number, d.document_number
  `).bind(setId).all();

  return result.results ?? [];
}

export async function upsertDocumentSet(env, values, actor = "") {
  const name = clean(values.name);
  if (!name) {
    return { ok: false, message: "세트 이름은 필수입니다." };
  }
  if (name.length > 100) {
    return { ok: false, message: "세트 이름은 100자 이하로 입력하세요." };
  }

  try {
    if (values.id) {
      const result = await env.DB.prepare(`
        UPDATE document_sets
        SET name = ?,
            description = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(name, clean(values.description) || null, values.id).run();

      if (result.meta.changes === 0) {
        return { ok: false, message: "세트를 찾을 수 없습니다." };
      }

      await logDocumentSetAction(env, values.id, name, "update", actor, "세트 정보 수정");
      return { ok: true, id: values.id };
    }

    const result = await env.DB.prepare(`
      INSERT INTO document_sets (name, description, created_by, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      RETURNING id
    `).bind(name, clean(values.description) || null, actor || null).first();

    await logDocumentSetAction(env, result.id, name, "create", actor, "세트 생성");
    return { ok: true, id: result.id };
  } catch (error) {
    return {
      ok: false,
      message: error.message.includes("UNIQUE") ? "같은 이름의 세트가 이미 있습니다." : error.message
    };
  }
}

export async function deleteDocumentSet(env, id, actor = "") {
  const set = await getDocumentSet(env, id);
  if (!set) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }

  // 삭제 이력(document_set_logs)을 삭제와 하나의 batch로 원자화한다. 로그는 세트가 아직 존재할 때만
  // 기록되도록 가드하여, 세트만 사라지고 삭제 기록이 없는 이력 공백을 막는다.
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
      SELECT ?, ?, 'delete', ?, ?
      FROM document_sets
      WHERE id = ?
    `).bind(id, set.name || "이름 없는 세트", actor || "알 수 없음", "세트 삭제", id),
    env.DB.prepare("DELETE FROM document_set_items WHERE set_id = ?").bind(id),
    env.DB.prepare("DELETE FROM document_sets WHERE id = ?").bind(id)
  ]);

  if (results[results.length - 1].meta.changes === 0) {
    return { ok: false, message: "세트를 찾을 수 없습니다." };
  }

  return { ok: true };
}

export async function addDocumentsToSet(env, setId, documentIds, actor = "") {
  const ids = [...new Set(documentIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return { added: 0 };
  }

  const statements = ids.map((documentId) => env.DB.prepare(`
    INSERT OR IGNORE INTO document_set_items (set_id, document_id)
    SELECT s.id, d.id
    FROM document_sets s
    JOIN documents d ON d.id = ?
    WHERE s.id = ?
  `).bind(documentId, setId));
  const results = await env.DB.batch(statements);
  const added = results.reduce((sum, result) => sum + (result.meta?.changes || 0), 0);

  if (added > 0) {
    await touchDocumentSet(env, setId);

    const addedIds = ids.filter((_, index) => (results[index]?.meta?.changes || 0) > 0);
    const [set, numbers] = await Promise.all([
      getDocumentSet(env, setId),
      getDocumentNumbersByIds(env, addedIds)
    ]);
    await logDocumentSetAction(env, setId, set?.name ?? "", "add", actor, `문서 ${added}건 추가: ${summarizeNumbers(numbers)}`);
  }

  return { added };
}

export async function removeDocumentFromSet(env, setId, documentId, actor = "") {
  const result = await env.DB.prepare(`
    DELETE FROM document_set_items
    WHERE set_id = ? AND document_id = ?
  `).bind(setId, documentId).run();

  if (result.meta.changes > 0) {
    await touchDocumentSet(env, setId);

    const [set, numbers] = await Promise.all([
      getDocumentSet(env, setId),
      getDocumentNumbersByIds(env, [documentId])
    ]);
    await logDocumentSetAction(env, setId, set?.name ?? "", "remove", actor, `문서 제외: ${numbers[0] ?? `문서 ID ${documentId}`}`);
    return { ok: true };
  }

  return { ok: false, message: "세트에서 해당 문서를 찾을 수 없습니다." };
}

async function logDocumentSetAction(env, setId, setName, action, actor, details = "") {
  await env.DB.prepare(`
    INSERT INTO document_set_logs (set_id, set_name, action, actor, details)
    VALUES (?, ?, ?, ?, ?)
  `).bind(setId, setName || "이름 없는 세트", action, actor || "알 수 없음", details || null).run();
}

export async function getDocumentSetLogs(env, setId, limit = 50) {
  const result = await env.DB.prepare(`
    SELECT id, set_name, action, actor, details, created_at
    FROM document_set_logs
    WHERE set_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(setId, Math.max(1, Math.min(Number(limit) || 50, 200))).all();

  return result.results ?? [];
}

async function getDocumentNumbersByIds(env, documentIds) {
  const ids = [...new Set(documentIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT document_number
    FROM documents
    WHERE id IN (${placeholders})
    ORDER BY document_number
  `).bind(...ids).all();

  return (result.results ?? []).map((row) => row.document_number);
}

function summarizeNumbers(numbers, max = 30) {
  if (numbers.length <= max) {
    return numbers.join(", ");
  }
  return `${numbers.slice(0, max).join(", ")} 외 ${numbers.length - max}건`;
}

async function touchDocumentSet(env, setId) {
  await env.DB.prepare(`
    UPDATE document_sets
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(setId).run();
}

export function parseDocumentNumberList(text) {
  const seen = new Set();
  const numbers = [];

  // 문서번호/보관코드는 공백 없는 코드이므로 공백·줄바꿈·쉼표·세미콜론·탭을 모두 구분자로 본다.
  for (const token of String(text ?? "").split(/[\s,;]+/)) {
    const value = clean(token);
    if (!value) {
      continue;
    }

    const key = value.toUpperCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    numbers.push(value);
  }

  return numbers;
}

export async function findDocumentsByNumbers(env, numbers) {
  if (!numbers.length) {
    return { documents: [], missing: [] };
  }

  const upperNumbers = numbers.map((number) => number.toUpperCase());
  const placeholders = upperNumbers.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT id, document_number, storage_code
    FROM documents
    WHERE UPPER(document_number) IN (${placeholders})
       OR UPPER(storage_code) IN (${placeholders})
  `).bind(...upperNumbers, ...upperNumbers).all();
  const documents = result.results ?? [];
  const matched = new Set();

  for (const document of documents) {
    matched.add(String(document.document_number).toUpperCase());
    matched.add(String(document.storage_code).toUpperCase());
  }

  const missing = numbers.filter((number) => !matched.has(number.toUpperCase()));
  return { documents, missing };
}

// 붙여넣은 문서번호/보관코드를 세트 저장 없이 즉석 픽리스트로 해석한다.
// 매칭된 문서를 동선순(구역→랙→면→열→선반)으로, 못 찾은 번호는 그대로 돌려줘 걷기 전에 드러나게 한다.
export async function resolvePicklist(env, numbers) {
  const parsed = [...new Set((numbers || []).map((value) => clean(value)).filter(Boolean))];
  if (!parsed.length) {
    return { documents: [], missing: [] };
  }

  const { documents: matched, missing } = await findDocumentsByNumbers(env, parsed);
  const ids = matched.map((document) => Number(document.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return { documents: [], missing };
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      d.storage_code,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.rack_face,
      d.status,
      c.name AS category_name,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      rs.column_number,
      rs.shelf_number,
      co.borrower AS checkout_borrower
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_checkouts co ON co.document_id = d.id AND co.returned_at IS NULL
    WHERE d.id IN (${placeholders})
    ORDER BY r.zone_number, r.rack_number, d.rack_face, rs.column_number, rs.shelf_number, d.document_number
  `).bind(...ids).all();

  return { documents: result.results ?? [], missing };
}

export function valuesFromDocumentForm(form) {
  return {
    documentNumber: clean(form.get("documentNumber")),
    revisionNumber: clean(form.get("revisionNumber")),
    documentName: clean(form.get("documentName")),
    categoryId: Number(form.get("categoryId")),
    rackSlotId: Number(form.get("rackSlotId")),
    rackFace: clean(form.get("rackFace")).toUpperCase(),
    note: clean(form.get("note")),
    tagIds: form.getAll("tagIds").map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0),
    // 낙관적 잠금: 사용자가 수정 화면을 연 시점의 updated_at(hidden). 비어 있으면 잠금 없이 동작.
    expectedUpdatedAt: clean(form.get("expectedUpdatedAt"))
  };
}
