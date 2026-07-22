import assert from "node:assert/strict";
import test from "node:test";

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

test("documentViews는 문서 화면의 명시적 공개 표면을 제공한다", () => {
  assert.deepEqual(Object.keys(documentViews).sort(), [
    "disposalWorkspacePage",
    "documentDetailsPage",
    "documentFormPage",
    "documentResults",
    "documentRevisionPage",
    "documentsPage"
  ]);
});

test("대표 문서 목록·폐기·폼·상세는 응답·보안·업무 계약을 유지한다", async () => {
  const pages = {
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
  };

  const list = await responseHtml(pages.list);
  assert.match(list, /PV-2026-014/);
  assert.match(list, /밸리데이션 &lt;보고서&gt;/);
  assert.match(list, /href="\/documents\/7"/);

  const disposal = await responseHtml(pages.disposal);
  assert.match(disposal, /1건 처리됨/);
  assert.match(disposal, /name="disposalDueYear"/);
  assert.match(disposal, /action="\/documents\/disposal\/process"[^>]*data-bulk-form/);
  assert.match(disposal, /name="confirmedTargetCount"/);
  assert.match(disposal, /name="confirmDisposal" value="1"/);

  const form = await responseHtml(pages.form);
  assert.match(form, /action="\/documents\/7\/edit"/);
  assert.match(form, /name="expectedRowVersion" value="4"/);
  assert.match(form, /확인 &lt;필요&gt;/);

  const detail = await responseHtml(pages.detail);
  assert.match(detail, /PV-2026-014/);
  assert.match(detail, /밸리데이션 &lt;보고서&gt;/);
  assert.match(detail, /1구역 3번/);
  assert.doesNotMatch(detail, /ARC-000007|<보고서>/);
});

async function responseHtml(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const html = await response.text();
  const csp = response.headers.get("Content-Security-Policy") || "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1] || "";
  assert.ok(nonce, "CSP nonce가 필요하다");
  assert.match(html, /<main id="main-content"/);
  for (const match of html.matchAll(/<(?:script|style)\b([^>]*)>/gi)) {
    assert.match(match[1], new RegExp(`\\bnonce="${nonce}"`));
  }
  return html;
}
