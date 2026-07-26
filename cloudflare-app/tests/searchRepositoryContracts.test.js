import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchSuggestions,
  buildViewerFacets,
  documentToViewerItem,
  MAX_SEARCH_RESULTS,
  parseDocumentFilters,
  parseSearchQuery,
  searchDocuments
} from "../src/domains/search/index.js";
import { recordingEnv, sampleDocument } from "./helpers/recordingD1.js";

test("검색 필터는 URLSearchParams를 지원하고 비정상 값을 안전한 기본값으로 정규화한다", () => {
  const params = new URLSearchParams({
    q: "PV",
    category: "2",
    zoneNumber: "3",
    tag: "4",
    status: "disposed",
    sort: "location"
  });
  assert.deepEqual(parseDocumentFilters(params), {
    categoryId: 2, zoneNumber: 3, tagId: 4, rackId: 0, rackFace: "",
    columnNumber: 0, shelfNumber: 0, status: "disposed", includeDisposed: true, sort: "location"
  });
  assert.deepEqual(parseDocumentFilters({ category: "1.5", status: "unknown", sort: "drop-table", q: "검색" }), {
    categoryId: 0, zoneNumber: 0, tagId: 0, rackId: 0, rackFace: "",
    columnNumber: 0, shelfNumber: 0, status: "active", includeDisposed: false, sort: "relevance"
  });
  assert.deepEqual(parseDocumentFilters({ includeDisposed: "1" }), {
    categoryId: 0, zoneNumber: 0, tagId: 0, rackId: 0, rackFace: "",
    columnNumber: 0, shelfNumber: 0, status: "disposed", includeDisposed: true, sort: "updated"
  });
  assert.deepEqual(parseDocumentFilters({ status: "active", includeDisposed: "1" }), {
    categoryId: 0, zoneNumber: 0, tagId: 0, rackId: 0, rackFace: "",
    columnNumber: 0, shelfNumber: 0, status: "active", includeDisposed: false, sort: "updated"
  });
  assert.deepEqual(parseDocumentFilters({ status: "all" }), {
    categoryId: 0, zoneNumber: 0, tagId: 0, rackId: 0, rackFace: "",
    columnNumber: 0, shelfNumber: 0, status: "all", includeDisposed: false, sort: "updated"
  });
});

test("자연어 필터는 제거 가능한 원래 token을 보존한다", () => {
  const parsed = parseSearchQuery("2구역 PV 폐기문서", {
    categories: [{ id: 7, name: "PV" }],
    tags: []
  });
  assert.equal(parsed.text, "");
  assert.deepEqual(parsed.chips.map((chip) => chip.token), ["2구역", "PV", "폐기문서"]);
});

test("검색 suggestion은 요청한 상한을 넘지 않는다", () => {
  const suggestions = buildSearchSuggestions([{
    document_number: "PV-2026-014",
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    rack_code: "2-01"
  }], 2);
  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions.map((item) => item.type), ["document_number", "document_name"]);
});

test("권위 검색은 설정된 전체 후보 window를 결정적으로 score한다", async () => {
  const env = recordingEnv({ all: () => [] });
  await searchDocuments(env, "PV", MAX_SEARCH_RESULTS);
  const documentQuery = env.state.calls.find((call) =>
    call.type === "all" && call.sql.includes("FROM documents d") && call.sql.includes("LIMIT ?")
  );
  assert.ok(documentQuery);
  assert.equal(documentQuery.args.at(-1), MAX_SEARCH_RESULTS);
  assert.match(documentQuery.sql, /ORDER BY d\.updated_at DESC, d\.id DESC\s+LIMIT \?/);
});

test("viewer search item은 내부 보관코드 없이 위치 중심 API shape를 제공한다", () => {
  const item = documentToViewerItem({
    id: 7,
    storage_code: "ARC-000007",
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    revision_date: "2026-04-14",
    disposal_due_year: 2031,
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    tag_names: "중요문서; 원본보관",
    status: "active",
    rack_code: "2-01",
    zone_number: 2,
    rack_number: 1,
    is_single_sided: 0,
    column_number: 3,
    shelf_number: 2,
    rack_face: "A",
    match_reason: "문서번호 부분 일치",
    relevance_score: 177,
    updated_at: "2026-06-28"
  });
  assert.equal(item.id, 7);
  assert.equal(item.documentNumber, "PV-2026-014");
  assert.equal("storageCode" in item, false);
  assert.equal(item.revisionDate, "2026-04-14");
  assert.equal(item.disposalDueYear, 2031);
  assert.deepEqual(item.tags, ["중요문서", "원본보관"]);
  assert.equal(item.location.label, "2구역 / 1-1번 랙 / 3열 / 2선반");
  assert.equal(item.location.rackLabel, "1-1");
  assert.equal(item.location.isSingleSided, false);
  assert.equal(item.matchReason, "문서번호 부분 일치");
});

test("정확 문서번호 검색은 내부 보관코드 없이 direct SQL path를 사용한다", async () => {
  const env = recordingEnv({
    all: (sql) => sql.includes("UPPER(d.document_number)")
      ? [sampleDocument({ document_number: "PV-2026-014" })]
      : []
  });
  const rows = await searchDocuments(env, "PV-2026-014", 30, { status: "active" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].match_reason, "문서번호 정확히 일치");
  assert.equal(env.state.calls.filter((call) => call.type === "all").length, 1);
  assert.match(env.state.calls[0].sql, /UPPER\(d\.document_number\)/);
  assert.doesNotMatch(env.state.calls[0].sql, /UPPER\(d\.storage_code\)/);
});

test("viewer 위치 label은 단면 rack과 양면 B면을 물리 표기로 구분한다", () => {
  const single = documentToViewerItem({
    id: 8, document_number: "MR-2026-001", revision_number: "Rev.0", document_name: "제조기록서",
    category_name: "제조기록서", status: "active", rack_code: "2-09", zone_number: 2, rack_number: 9,
    is_single_sided: 1, column_number: 7, shelf_number: 6, rack_face: "A", updated_at: "2026-06-28"
  });
  assert.equal(single.location.rackLabel, "9");
  assert.equal(single.location.isSingleSided, true);
  assert.equal(single.location.label, "2구역 / 9번 랙 / 7열 / 6선반");

  const faceB = documentToViewerItem({
    id: 9, document_number: "PV-2026-020", revision_number: "Rev.0", document_name: "밸리데이션 보고서",
    category_name: "PV", status: "active", rack_code: "1-13", zone_number: 1, rack_number: 13,
    is_single_sided: 0, column_number: 1, shelf_number: 1, rack_face: "B", updated_at: "2026-06-28"
  });
  assert.equal(faceB.location.rackLabel, "13-2");
  assert.equal(faceB.location.label, "1구역 / 13-2번 랙 / 1열 / 1선반");
});

test("viewer facet은 결과 row의 현재 category/zone/tag/status를 집계한다", () => {
  const facets = buildViewerFacets([
    { category_id: 1, category_name: "PV", tag_names: "중요문서", zone_number: 1, status: "active" },
    { category_id: 1, category_name: "PV", tag_names: "원본보관", zone_number: 1, status: "disposed" },
    { category_id: 2, category_name: "SOP", tag_names: "중요문서; 교육", zone_number: 2, status: "active" }
  ]);
  assert.deepEqual(facets.categories.map((item) => [item.label, item.count]), [["PV", 2], ["SOP", 1]]);
  assert.deepEqual(facets.zones.map((item) => [item.label, item.count]), [["1구역", 2], ["2구역", 1]]);
  assert.equal(facets.tags.find((item) => item.label === "중요문서").count, 2);
  assert.equal(facets.statuses.find((item) => item.value === "active").count, 2);
});
