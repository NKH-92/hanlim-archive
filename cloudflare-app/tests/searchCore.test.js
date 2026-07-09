import assert from "node:assert/strict";
import test from "node:test";

import { createSearchCore } from "../src/searchCore.js";

const core = createSearchCore();

const sampleDocument = {
  document_number: "PV-2026-014",
  revision_number: "Rev.2",
  document_name: "정제공정 밸리데이션 보고서",
  storage_code: "ARC-900014",
  category_name: "PV",
  tag_names: "밸리데이션; 정제",
  note: "",
  zone_number: 2,
  rack_number: 1,
  column_number: 3,
  shelf_number: 2,
  rack_face: "A"
};

test("chosungOf extracts leading consonants from hangul text", () => {
  assert.equal(core.chosungOf("제조기록서"), "ㅈㅈㄱㄹㅅ");
  assert.equal(core.chosungOf("정제공정 밸리데이션"), "ㅈㅈㄱㅈㅂㄹㄷㅇㅅ");
  assert.ok(core.isChosungToken("ㅈㅈㄱㄹㅅ"));
  assert.ok(!core.isChosungToken("제조"));
  assert.ok(!core.isChosungToken("ㅈ"));
});

test("chosung query matches document names", () => {
  const result = core.scoreDocumentMatch(sampleDocument, "ㅂㄹㄷㅇㅅ");
  assert.ok(result.relevance_score > 0);
  assert.match(result.match_reason, /초성 일치/);
});

test("qwertyToHangul composes two-beolsik typing mistakes", () => {
  assert.equal(core.qwertyToHangul("vmfhwprxm"), "프로젝트");
  assert.equal(core.qwertyToHangul("qkfflepdltus"), "발리데이션");
  assert.equal(core.qwertyToHangul("gksfla"), "한림");
});

test("hangulToQwerty recovers english typed under korean IME", () => {
  assert.equal(core.hangulToQwerty("ㅔㅍ"), "pv");
  assert.equal(core.hangulToQwerty("한림"), "gksfla");
});

test("korean/english keyboard slips still match documents", () => {
  const koreanSlip = core.scoreDocumentMatch(sampleDocument, "ㅔㅍ");
  assert.ok(koreanSlip.relevance_score > 0, "hangul-typed PV should match");

  const englishSlip = core.scoreDocumentMatch(sampleDocument, "qofflepdl");
  assert.ok(englishSlip.relevance_score > 0, "english-typed 밸리데이 should match");
  assert.match(englishSlip.match_reason, /한\/영 자판 보정/);
});

test("scoreDocumentMatch keeps existing behavior", () => {
  assert.deepEqual(core.searchTokens("PV 2026"), ["pv", "2026", "pv2026"]);
  assert.equal(core.levenshteinDistance("밸리데이션", "밸리데이선"), 1);
  assert.ok(core.scoreDocumentMatch(sampleDocument, "2026-014").relevance_score > 0);
  assert.ok(core.scoreDocumentMatch(sampleDocument, "밸리데이선").relevance_score > 0);
  assert.ok(core.scoreDocumentMatch(sampleDocument, "2구역 1랙").relevance_score > 0);
  assert.equal(core.scoreDocumentMatch(sampleDocument, "완전히다른검색어").relevance_score, 0);
});

test("loose coverage option keeps weak matches for did-you-mean", () => {
  const strict = core.scoreDocumentMatch(sampleDocument, "밸리데이션 완전다른말 또다른말");
  assert.equal(strict.relevance_score, 0);

  const loose = core.scoreDocumentMatch(sampleDocument, "밸리데이션 완전다른말 또다른말", { minCoverage: 0.2 });
  assert.ok(loose.relevance_score > 0);
});

test("parseSearchQuery splits filters from search text", () => {
  const context = {
    categories: [{ id: 3, name: "PV" }, { id: 5, name: "제조기록서" }],
    tags: [{ id: 9, name: "밸리데이션" }]
  };

  const parsed = core.parseSearchQuery("2구역 PV 2026", context);
  assert.equal(parsed.filters.zoneNumber, 2);
  assert.equal(parsed.filters.categoryId, 3);
  assert.equal(parsed.text, "2026");
  assert.deepEqual(parsed.chips.map((chip) => chip.type), ["zone", "category"]);

  const status = core.parseSearchQuery("폐기 세척", context);
  assert.equal(status.filters.status, "disposed");
  assert.equal(status.text, "세척");

  const explicit = core.parseSearchQuery("2구역 PV", { ...context, explicit: { zoneNumber: 1 } });
  assert.equal(explicit.filters.zoneNumber, undefined);
  assert.equal(explicit.text, "2구역");
});

test("highlightHtml wraps matched tokens with mark", () => {
  const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  assert.equal(core.highlightHtml("PV-2026-014", "2026", escape), "PV-<mark>2026</mark>-014");
  assert.equal(core.highlightHtml("정제공정 보고서", "정제", escape), "<mark>정제</mark>공정 보고서");
  assert.equal(core.highlightHtml("<b>주의</b>", "주의", escape), "&lt;b&gt;<mark>주의</mark>&lt;/b&gt;");
  assert.equal(core.highlightHtml("아무 문서", "", escape), "아무 문서");
});

test("click and popularity boosts are bounded", () => {
  assert.equal(core.clickBoost(0), 0);
  assert.equal(core.clickBoost(3), 18);
  assert.equal(core.clickBoost(999), 72);
  assert.equal(core.popularityBoost(999), 40);
});
