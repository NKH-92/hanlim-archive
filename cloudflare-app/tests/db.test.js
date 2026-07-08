import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFloorPlanLayout,
  buildViewerFacets,
  compactSearchText,
  documentToViewerItem,
  disposeDocument,
  levenshteinDistance,
  parseDocumentNumberList,
  scoreDocumentMatch,
  searchTokens
} from "../src/db.js";

test("parseDocumentNumberList splits, trims, and dedupes pasted numbers", () => {
  const numbers = parseDocumentNumberList("MR-2026-001, PV-2026-014\n mr-2026-001 ;\tARC-000002\n\n");

  assert.deepEqual(numbers, ["MR-2026-001", "PV-2026-014", "ARC-000002"]);
  assert.deepEqual(parseDocumentNumberList(""), []);
  assert.deepEqual(parseDocumentNumberList(null), []);
});

test("search normalization supports partial numbers, spacing, and light typos", () => {
  const document = {
    storage_code: "ARC-000123",
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    tag_names: "중요문서; 원본보관",
    rack_code: "2-01",
    zone_number: 2,
    rack_number: 1,
    column_number: 3,
    shelf_number: 2,
    rack_face: "A",
    note: ""
  };

  assert.deepEqual(searchTokens("PV 2026"), ["pv", "2026", "pv2026"]);
  assert.equal(compactSearchText("PV-2026 014"), "pv2026014");
  assert.equal(levenshteinDistance("밸리데이션", "밸리데이선"), 1);
  assert.ok(scoreDocumentMatch(document, "2026-014").relevance_score > 0);
  assert.ok(scoreDocumentMatch(document, "밸리데이선").relevance_score > 0);
  assert.ok(scoreDocumentMatch(document, "2구역 1랙").relevance_score > 0);
  assert.equal(scoreDocumentMatch(document, "완전히다른검색어").relevance_score, 0);
});

test("disposeDocument does not write logs when the status update changes no rows", async () => {
  const env = envForDispose({ updateChanges: 0 });

  const result = await disposeDocument(env, 1, "관리자", "폐기 사유", "Admin");

  assert.equal(result.ok, false);
  assert.equal(env.batchCalls, 0);
});

test("viewer search item exposes location-first api shape", () => {
  const item = documentToViewerItem({
    id: 7,
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    tag_names: "중요문서; 원본보관",
    status: "active",
    rack_code: "2-01",
    zone_number: 2,
    rack_number: 1,
    column_number: 3,
    shelf_number: 2,
    rack_face: "A",
    match_reason: "문서번호 부분 일치",
    relevance_score: 177,
    updated_at: "2026-06-28"
  });

  assert.equal(item.id, 7);
  assert.equal(item.documentNumber, "PV-2026-014");
  assert.deepEqual(item.tags, ["중요문서", "원본보관"]);
  assert.equal(item.location.label, "2구역 / 1번 랙 / 3열 / 2선반 / A면");
  assert.equal(item.matchReason, "문서번호 부분 일치");
});

test("viewer facets count active filters from result rows", () => {
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

test("floor plan layout clamps regions and auto-places racks by zone", () => {
  const layout = buildFloorPlanLayout([
    { id: 1, code: "1-01", zone_number: 1, rack_number: 1, active_document_count: 3, is_single_sided: 0 },
    { id: 2, code: "1-02", zone_number: 1, rack_number: 2, active_document_count: 1, is_single_sided: 1 },
    { id: 3, code: "3-01", zone_number: 3, rack_number: 1, active_document_count: 2, is_single_sided: 0 }
  ], [
    { region_key: "zone-1", label: "1구역", description: "", top_pct: -5, left_pct: 12, width_pct: 38, height_pct: 40, default_rack_count: 4 },
    { region_key: "zone-3", label: "3구역", description: "", top_pct: 55, left_pct: 52, width_pct: 160, height_pct: 38, default_rack_count: 2 }
  ]);

  assert.equal(layout[0].topPct, 0);
  assert.equal(layout[1].widthPct, 100);
  assert.deepEqual(layout[0].racks.map((rack) => rack.code), ["1-01", "1-02"]);
  assert.ok(layout[0].racks[0].leftPct < layout[0].racks[1].leftPct);
  assert.equal(layout[1].racks[0].documentCount, 2);
});

test("disposeDocument writes logs after a successful status update", async () => {
  const env = envForDispose({ updateChanges: 1 });

  const result = await disposeDocument(env, 1, "관리자", "폐기 사유", "Admin");

  assert.equal(result.ok, true);
  assert.equal(env.batchCalls, 1);
});

function envForDispose({ updateChanges }) {
  const env = {
    batchCalls: 0,
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes("FROM documents d")) {
                  return {
                    id: 1,
                    storage_code: "ARC-000001",
                    document_number: "MR-001",
                    revision_number: "Rev.0",
                    document_name: "문서",
                    category_name: "제조기록서",
                    category_id: 1,
                    rack_slot_id: 1,
                    rack_face: "A",
                    status: "active",
                    rack_code: "1-01",
                    zone_number: 1,
                    rack_number: 1,
                    column_number: 1,
                    shelf_number: 1,
                    slot_code: "1-1",
                    note: ""
                  };
                }

                return null;
              },
              async all() {
                if (sql.includes("FROM document_tags")) {
                  return { results: [] };
                }

                return { results: [] };
              },
              async run() {
                return { meta: { changes: updateChanges } };
              }
            };
          }
        };
      },
      async batch() {
        env.batchCalls += 1;
        return [];
      }
    }
  };

  return env;
}
