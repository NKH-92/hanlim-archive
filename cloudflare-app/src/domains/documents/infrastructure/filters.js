// 문서 목록·검색 공통 필터. URL/API 파라미터 파싱과 SQL WHERE 의미를 documents 도메인이 소유한다.
import { clean } from "../../../shared/text/normalize.js";

const VALID_SORTS = new Set(["relevance", "updated", "docnum", "category", "location"]);
const VALID_STATUSES = new Set(["active", "all", "disposed"]);

function readParam(params, ...names) {
  for (const name of names) {
    const value = typeof params?.get === "function" ? params.get(name) : params?.[name];
    if (value !== null && value !== undefined && clean(value)) return value;
  }
  return "";
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function rackFace(value) {
  const normalized = clean(value).toUpperCase();
  if (normalized === "1") return "A";
  if (normalized === "2") return "B";
  return normalized === "A" || normalized === "B" ? normalized : "";
}

export function parseDocumentFilters(params = {}, { emptySort = false, query = "", defaultActive = true } = {}) {
  const q = clean(query || readParam(params, "q", "query"));
  const sortRaw = clean(readParam(params, "sort"));
  const statusRaw = clean(readParam(params, "status")).toLowerCase();
  const legacyIncludeDisposed = ["1", "true", "on", "yes"].includes(clean(readParam(params, "includeDisposed")).toLowerCase());
  const sort = VALID_SORTS.has(sortRaw) ? sortRaw : "";
  const status = VALID_STATUSES.has(statusRaw)
    ? statusRaw
    : legacyIncludeDisposed
      ? "disposed"
      : defaultActive
        ? "active"
        : "";

  return {
    categoryId: positiveInteger(readParam(params, "category", "categoryId")),
    zoneNumber: positiveInteger(readParam(params, "zone", "zoneNumber")),
    tagId: positiveInteger(readParam(params, "tag", "tagId")),
    rackId: positiveInteger(readParam(params, "rack", "rackId")),
    rackFace: rackFace(readParam(params, "face", "rackFace")),
    columnNumber: positiveInteger(readParam(params, "column", "columnNumber")),
    shelfNumber: positiveInteger(readParam(params, "shelf", "shelfNumber")),
    status,
    includeDisposed: status === "disposed",
    sort: emptySort ? sort : (sort || (q ? "relevance" : "updated"))
  };
}

export function buildDocumentFilterWhere(filters = {}) {
  const filterClauses = ["d.sync_state = 'current'"];
  const filterBinds = [];

  if (filters.categoryId && Number.isInteger(filters.categoryId) && filters.categoryId > 0) {
    filterClauses.push("d.category_id = ?");
    filterBinds.push(filters.categoryId);
  }
  if (filters.zoneNumber && Number.isInteger(filters.zoneNumber) && filters.zoneNumber > 0) {
    filterClauses.push("r.zone_number = ?");
    filterBinds.push(filters.zoneNumber);
  }
  if (filters.rackId && Number.isInteger(filters.rackId) && filters.rackId > 0) {
    filterClauses.push("r.id = ?");
    filterBinds.push(filters.rackId);
  }
  if (filters.rackFace === "A" || filters.rackFace === "B") {
    filterClauses.push("d.rack_face = ?");
    filterBinds.push(filters.rackFace);
  }
  if (filters.columnNumber && Number.isInteger(filters.columnNumber) && filters.columnNumber > 0) {
    filterClauses.push("rs.column_number = ?");
    filterBinds.push(filters.columnNumber);
  }
  if (filters.shelfNumber && Number.isInteger(filters.shelfNumber) && filters.shelfNumber > 0) {
    filterClauses.push("rs.shelf_number = ?");
    filterBinds.push(filters.shelfNumber);
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
