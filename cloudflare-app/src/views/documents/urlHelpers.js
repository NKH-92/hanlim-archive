// 문서 목록·폐기 작업공간 URL 생성기. 파라미터 순서도 화면 계약의 일부다.

import { listUrl } from "../layout.js";

export function disposalListUrl(filters = {}) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.rackId) params.set("rack", filters.rackId);
  if (filters.disposalDueYear) params.set("disposalDueYear", filters.disposalDueYear);
  const query = params.toString();
  return query ? `/documents/disposal?${query}` : "/documents/disposal";
}

export function documentListUrl({ query, filters = {}, page = 1 }) {
  return listUrl("/documents", { query, filters, page }, [
    ["category", "categoryId"],
    ["zone", "zoneNumber"],
    ["tag", "tagId"],
    ["rack", "rackId"],
    ["face", "rackFace"],
    ["column", "columnNumber"],
    ["shelf", "shelfNumber"],
    ["status", "status"],
    ["sort", "sort"]
  ]);
}
