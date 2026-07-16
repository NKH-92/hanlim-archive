// 문서 검색 필터: URL/API 파라미터 파싱과 SQL WHERE 절 생성을 한곳에 둔다.
// /app·/documents·/api/viewer/search가 같은 의미의 category/zone/tag/status를 쓰게 한다.

import { clean } from "../utils.js";

const VALID_SORTS = new Set(["relevance", "updated", "docnum", "category", "location"]);

function readParam(params, ...names) {
  for (const name of names) {
    const value = typeof params?.get === "function" ? params.get(name) : params?.[name];
    if (value !== null && value !== undefined && clean(value)) {
      return value;
    }
  }
  return "";
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

// params: URLSearchParams 값 또는 plain object (category|categoryId 등 별칭 허용).
// emptySort: true면 sort 기본값을 넣지 않는다(명시 필터만 읽을 때).
export function parseDocumentFilters(params = {}, { emptySort = false, query = "", defaultActive = true } = {}) {
  const q = clean(query || readParam(params, "q", "query"));
  const sortRaw = clean(readParam(params, "sort"));
  const includeDisposed = ["1", "true", "on", "yes"].includes(clean(readParam(params, "includeDisposed")).toLowerCase());
  const sort = VALID_SORTS.has(sortRaw) ? sortRaw : "";
  const status = defaultActive && !includeDisposed ? "active" : "";

  return {
    categoryId: positiveInteger(readParam(params, "category", "categoryId")),
    zoneNumber: positiveInteger(readParam(params, "zone", "zoneNumber")),
    tagId: positiveInteger(readParam(params, "tag", "tagId")),
    status,
    includeDisposed,
    sort: emptySort ? sort : (sort || (q ? "relevance" : "updated"))
  };
}

// searchDocuments가 쓰는 WHERE 절. SQL 조각·바인드 순서를 바꾸면 안 된다.
export function buildDocumentFilterWhere(filters = {}) {
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

  return {
    where: filterClauses.length ? `WHERE ${filterClauses.join(" AND ")}` : "",
    binds: filterBinds
  };
}
