import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import * as html from "../src/html.js";
import * as documentViews from "../src/views/documentViews.js";

const session = Object.freeze({
  displayName: "문서 관리자",
  role: "Admin",
  csrfToken: "fixed-csrf-token"
});

const document = Object.freeze({
  id: 7,
  document_name: "밸리데이션 <보고서>",
  document_number: "PV-2026-014",
  revision_number: "Rev.1",
  revision_date: "2026-04-14",
  disposal_due_year: 2031,
  category_name: "PV",
  note: "원본 보관",
  status: "active",
  rack_code: "1-03",
  zone_number: 1,
  rack_number: 3,
  rack_face: "B",
  is_single_sided: 0,
  column_number: 2,
  shelf_number: 1,
  column_count: 2,
  shelf_count: 2
});

test("documentViews 호환 façade와 html 배럴의 공개 export 표면은 그대로다", () => {
  assert.deepEqual(Object.keys(documentViews).sort(), [
    "disposalWorkspacePage",
    "documentDetailsPage",
    "documentFormPage",
    "documentResults",
    "documentsPage"
  ]);
  for (const name of ["disposalWorkspacePage", "documentDetailsPage", "documentFormPage", "documentsPage"]) {
    assert.equal(html[name], documentViews[name]);
  }
});

test("대표 문서 목록·폐기·폼·상세 출력은 nonce 정규화 후 바이트 계약을 유지한다", async () => {
  const pages = withFixedRandom(() => ({
    list: documentViews.documentsPage({
      session,
      query: "PV 2026",
      documents: [document],
      categories: [{ id: 1, name: "PV" }],
      tags: [{ id: 2, name: "중요문서" }],
      filters: { categoryId: 1, tagId: 2, zoneNumber: 1, status: "active", sort: "location" },
      suggestions: [{ value: "PV-2026-014", label: "밸리데이션 보고서" }],
      pagination: { page: 2, pageSize: 30, totalDocuments: 31, totalPages: 2 }
    }),
    disposal: documentViews.disposalWorkspacePage({
      session,
      documents: [document],
      categories: [{ id: 1, name: "PV" }],
      racks: [{ id: 3, zone_number: 1, rack_number: 3 }],
      years: [2030, 2031],
      filters: { categoryId: 1, rackId: 3, disposalDueYear: 2031 },
      capped: true,
      legacyLimit: 10,
      feedback: { type: "success", message: "1건 처리됨" }
    }),
    form: documentViews.documentFormPage({
      session,
      title: "문서 수정",
      action: "/documents/7/edit",
      values: { ...document, returnTo: "/documents?q=PV", row_version: 4, updated_at: "2026-07-17 09:00:00", category_id: 1, rack_slot_id: 12 },
      categories: [{ id: 1, name: "PV" }],
      tags: [{ id: 2, name: "중요문서" }, { id: 3, name: "원본보관" }],
      slots: [{ id: 12, zone_number: 1, rack_number: 3, column_number: 2, shelf_number: 1, is_single_sided: 0, label: "1구역 / 3번 랙 / 2열 / 1선반" }],
      selectedTags: [2],
      error: "확인 <필요>",
      showLocation: true
    }),
    detail: documentViews.documentDetailsPage({
      session,
      document,
      tags: [{ name: "중요문서" }],
      disposalLogs: [{ action: "disposed", reason: "기한 만료" }],
      auditLogs: [{ action: "update", summary: "정보 수정", actor: "관리자", actor_role: "Admin", created_at: "2026-07-17", details: '{"storageCode":"ARC-000007","note":"유지"}' }],
      movements: [{ from_location_snapshot: "1구역 2번", to_location_snapshot: "1구역 3번", performed_by_name: "관리자", created_at: "2026-07-17", reason: "정리" }],
      floorPlan: [{
        key: "zone-1",
        label: "1구역",
        zoneNumber: 1,
        topPct: 3.2,
        leftPct: 4.7,
        widthPct: 47.5,
        heightPct: 38.2,
        racks: [{ id: 3, code: "1-03", rackNumber: 3, isSingleSided: false, leftPct: 50, topPct: 50, widthPct: 4 }]
      }]
    })
  }));

  const actual = Object.fromEntries(await Promise.all(Object.entries(pages).map(async ([name, response]) => [name, await responseFingerprint(response)])));
  assert.deepEqual(actual, {
    list: "95c42dcdf5ac0c69aa87f324e8c2dd942327d2cce3bac4df9f44019473de3cf0",
    disposal: "8d958a2bed0f4f458846267543ff7f220380f7603d31e4bfa72fa0d6d578f1d0",
    form: "7aa4daf6154f93388fe30b1ea9e8c6a2cb924dd14ada014d890f98d18b478c42",
    detail: "27468acf8012167d8d88d1602942817d1df750e8d744a3d3578d4430d2a1c5dc"
  });
});

function withFixedRandom(callback) {
  const original = Math.random;
  Math.random = () => 0.25;
  try {
    return callback();
  } finally {
    Math.random = original;
  }
}

async function responseFingerprint(response) {
  const html = await response.text();
  const csp = response.headers.get("Content-Security-Policy") || "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1] || "";
  const normalizedCsp = nonce ? csp.replaceAll(nonce, "<nonce>") : csp;
  const main = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/)?.[1] || "";
  const normalizedMain = nonce ? main.replaceAll(nonce, "<nonce>") : main;
  return createHash("sha256").update(JSON.stringify({
    status: response.status,
    contentType: response.headers.get("Content-Type"),
    cacheControl: response.headers.get("Cache-Control"),
    csp: normalizedCsp,
    main: normalizedMain
  })).digest("hex");
}
