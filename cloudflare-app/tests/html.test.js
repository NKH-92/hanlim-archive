import assert from "node:assert/strict";
import test from "node:test";

import { dashboardPage, documentDetailsPage, page, setDetailsPage } from "../src/html.js";

test("page injects csrf token into authenticated post forms", async () => {
  const response = page("Test", `
    <form method="post" action="/documents">
      <button type="submit">Save</button>
    </form>
    <form method="get" action="/documents"></form>
  `, {
    username: "admin",
    displayName: "Admin",
    role: "Admin",
    csrfToken: "csrf-token-123"
  });
  const html = await response.text();

  assert.match(html, /name="csrf_token" value="csrf-token-123"/);
  assert.equal(html.match(/name="csrf_token"/g).length, 1);
});

test("dashboard page renders viewer-first search and floor plan landmarks", async () => {
  const response = dashboardPage({
    session: {
      username: "viewer",
      displayName: "조회자",
      role: "User",
      csrfToken: "csrf-token-123"
    },
    query: "PV",
    racks: [{ id: 1, code: "1-01", zone_number: 1, rack_number: 1, active_document_count: 1, column_count: 3, shelf_count: 4 }],
    viewerSearch: {
      items: [{
        id: 7,
        documentNumber: "PV-2026-014",
        revisionNumber: "Rev.1",
        documentName: "충전 공정 밸리데이션 보고서",
        categoryName: "PV",
        tags: ["중요문서"],
        status: "active",
        location: {
          label: "1구역 / 1번 랙 / 2열 / 3선반 / A면",
          rackCode: "1-01",
          rackFace: "A"
        },
        matchReason: "문서번호 부분 일치",
        updatedAt: "2026-06-28"
      }],
      pagination: { page: 1, pageSize: 12, totalItems: 1, totalPages: 1 },
      facets: { categories: [{ value: 1, label: "PV", count: 1 }], tags: [], zones: [{ value: 1, label: "1구역", count: 1 }], statuses: [{ value: "active", label: "보관중", count: 1 }] },
      suggestions: [{ value: "PV-2026-014", label: "PV-2026-014" }]
    },
    floorPlan: [{
      key: "zone-1",
      label: "1구역",
      description: "",
      zoneNumber: 1,
      topPct: 8,
      leftPct: 5,
      widthPct: 40,
      heightPct: 35,
      racks: [{ id: 1, code: "1-01", rackNumber: 1, documentCount: 1, leftPct: 50, topPct: 50 }]
    }],
    categories: [{ id: 1, name: "PV" }],
    tags: [],
    filters: { sort: "relevance" },
    categoryIndex: [],
    quality: null
  });

  const html = await response.text();

  assert.match(html, /문서를 찾고 실제 위치로 이동하세요/);
  assert.match(html, /data-viewer-results/);
  assert.match(html, /문서고 도면/);
  assert.match(html, /Archive\.png/);
  assert.match(html, /같은 랙 문서/);
  assert.doesNotMatch(html, />Dashboard</);
});

test("set details page lists documents in location order with admin tools", async () => {
  const documents = [
    {
      id: 1,
      storage_code: "ARC-000001",
      document_number: "MR-2026-001",
      revision_number: "Rev.0",
      document_name: "제조기록서",
      category_name: "제조기록서",
      status: "active",
      rack_code: "1-01",
      zone_number: 1,
      rack_number: 1,
      column_number: 1,
      shelf_number: 1,
      rack_face: "B"
    },
    {
      id: 2,
      storage_code: "ARC-000002",
      document_number: "PV-2026-014",
      revision_number: "Rev.1",
      document_name: "밸리데이션 보고서",
      category_name: "PV",
      status: "disposed",
      rack_code: "2-01",
      zone_number: 2,
      rack_number: 1,
      column_number: 3,
      shelf_number: 2,
      rack_face: "A"
    }
  ];
  const racks = [
    { id: 1, code: "1-01", zone_number: 1, rack_number: 1, document_count: 1 },
    { id: 2, code: "2-01", zone_number: 2, rack_number: 1, document_count: 1 }
  ];

  const adminHtml = await setDetailsPage({
    session: { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" },
    set: { id: 5, name: "정기감사 준비문서", description: "규제기관 감사 대비" },
    documents,
    racks
  }).text();

  assert.match(adminHtml, /정기감사 준비문서/);
  assert.match(adminHtml, /1구역 \/ 1번 랙 \/ 1열 \/ 1선반 \/ B면/);
  assert.match(adminHtml, /2구역 \/ 1번 랙 \/ 3열 \/ 2선반 \/ A면/);
  assert.match(adminHtml, /action="\/sets\/5\/add"/);
  assert.match(adminHtml, /action="\/sets\/5\/remove"/);
  assert.match(adminHtml, /data-print/);
  assert.ok(adminHtml.indexOf("MR-2026-001") < adminHtml.indexOf("PV-2026-014"));

  const userHtml = await setDetailsPage({
    session: { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf-token-123" },
    set: { id: 5, name: "정기감사 준비문서", description: "" },
    documents,
    racks
  }).text();

  assert.doesNotMatch(userHtml, /action="\/sets\/5\/add"/);
  assert.doesNotMatch(userHtml, /action="\/sets\/5\/remove"/);
  assert.doesNotMatch(userHtml, /세트 삭제/);
});

test("set details page warns about checked-out documents and shows set history", async () => {
  const documents = [{
    id: 1,
    storage_code: "ARC-000001",
    document_number: "MR-2026-001",
    revision_number: "Rev.0",
    document_name: "제조기록서",
    category_name: "제조기록서",
    status: "active",
    rack_code: "1-01",
    zone_number: 1,
    rack_number: 1,
    column_number: 1,
    shelf_number: 1,
    rack_face: "A",
    checkout_borrower: "홍길동"
  }];

  const html = await setDetailsPage({
    session: { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf-token-123" },
    set: { id: 5, name: "정기감사 준비문서", description: "" },
    documents,
    racks: [{ id: 1, code: "1-01", zone_number: 1, rack_number: 1, document_count: 1 }],
    logs: [{ id: 1, action: "add", actor: "관리자", details: "문서 1건 추가: MR-2026-001", created_at: "2026-07-08" }]
  }).text();

  assert.match(html, /반출 중 문서 1건/);
  assert.match(html, /반출 중 · 홍길동/);
  assert.match(html, /세트 변경 이력/);
  assert.match(html, /문서 추가/);
});

test("document details page offers checkout and return controls to admins", async () => {
  const baseDocument = {
    id: 7,
    storage_code: "ARC-000007",
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    document_name: "밸리데이션 보고서",
    category_name: "PV",
    status: "active",
    rack_code: "1-01",
    zone_number: 1,
    rack_number: 1,
    column_number: 2,
    shelf_number: 3,
    column_count: 3,
    shelf_count: 4,
    rack_face: "A",
    note: ""
  };
  const session = { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" };
  const emptyLogs = { tags: [], movementLogs: [], disposalLogs: [], auditLogs: [], checkoutLogs: [] };

  const inRackHtml = await documentDetailsPage({ session, document: baseDocument, ...emptyLogs }).text();
  assert.match(inRackHtml, /action="\/documents\/7\/checkout"/);
  assert.doesNotMatch(inRackHtml, /action="\/documents\/7\/return"/);

  const checkedOutHtml = await documentDetailsPage({
    session,
    document: { ...baseDocument, checkout_borrower: "홍길동", checkout_purpose: "불시감사 대응", checkout_at: "2026-07-08" },
    ...emptyLogs
  }).text();
  assert.match(checkedOutHtml, /action="\/documents\/7\/return"/);
  assert.doesNotMatch(checkedOutHtml, /action="\/documents\/7\/checkout"/);
  assert.match(checkedOutHtml, /반출 중 · 홍길동/);

  const viewerHtml = await documentDetailsPage({
    session: { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf-token-123" },
    document: { ...baseDocument, checkout_borrower: "홍길동" },
    ...emptyLogs
  }).text();
  assert.doesNotMatch(viewerHtml, /action="\/documents\/7\/return"/);
  assert.match(viewerHtml, /반출 중 · 홍길동/);
});
