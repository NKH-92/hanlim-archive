import assert from "node:assert/strict";
import test from "node:test";

import {
  adminDashboardPage,
  dashboardPage,
  disposalWorkspacePage,
  documentDetailsPage,
  documentFormPage,
  documentsPage,
  page,
  setDetailsPage
} from "../src/html.js";

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
  // 본문 POST 폼 1개 + 헤더 로그아웃 POST 폼 1개
  assert.equal(html.match(/name="csrf_token"/g).length, 2);
  assert.match(html, /method="post" action="\/logout"/);
});

test("disposal workspace renders one selectable bulk disposal flow", async () => {
  const html = await disposalWorkspacePage({
    session: {
      username: "admin",
      displayName: "관리자",
      role: "Admin",
      csrfToken: "csrf-token-123"
    },
    documents: [{
      id: 7,
      document_name: "밸리데이션 보고서",
      document_number: "PV-2026-014",
      revision_number: "Rev.1",
      revision_date: "2026-04-14",
      disposal_due_year: 2031,
      status: "active",
      rack_code: "1-03",
      zone_number: 1,
      rack_number: 3,
      column_number: 2,
      shelf_number: 3,
      rack_face: "A"
    }],
    categories: [{ id: 2, name: "PV" }],
    racks: [{ id: 3, zone_number: 1, rack_number: 3 }],
    years: [2031],
    filters: { categoryId: 2, rackId: 3, disposalDueYear: 2031 }
  }).text();

  assert.match(html, /action="\/documents\/disposal"/);
  assert.match(html, /name="category"/);
  assert.match(html, /name="rack"/);
  assert.match(html, /name="disposalDueYear"/);
  assert.match(html, /data-bulk-select-all/);
  assert.match(html, /class="doc-table is-bulk-selectable"/);
  assert.match(html, /bulk-select-all-text">현재 목록 전체 선택<\/span>/);
  assert.match(html, /\.doc-table\.is-bulk-selectable thead \{ display: block; \}/);
  assert.match(html, /data-bulk-item/);
  assert.match(html, /action="\/documents\/bulk-dispose"/);
  assert.match(html, /name="returnTo" value="\/documents\/disposal\?/);
  assert.match(html, /name="reason"[^>]*required/);
  assert.match(html, /data-bulk-count>0건 선택/);
  assert.match(html, />선택 문서 폐기</);
  assert.match(html, /name="csrf_token" value="csrf-token-123"/);
  assert.doesNotMatch(html, /action="\/documents\/dispose-filtered"/);
  assert.equal((html.match(/name="reason"/g) || []).length, 1);
});

test("document edit form includes metadata and editable storage location", async () => {
  const html = await documentFormPage({
    session: {
      username: "admin",
      displayName: "관리자",
      role: "Admin",
      csrfToken: "csrf-token-123"
    },
    title: "문서 수정",
    action: "/documents/7/edit",
    values: {
      documentName: "밸리데이션 보고서",
      documentNumber: "PV-2026-014",
      revisionNumber: "Rev.1",
      revisionDate: "2026-04-14",
      disposalDueYear: 2031,
      categoryId: 2,
      rackSlotId: 30,
      rackFace: "B"
    },
    categories: [{ id: 2, name: "PV" }],
    tags: [],
    slots: [{
      id: 30,
      zone_number: 1,
      rack_number: 3,
      column_number: 1,
      shelf_number: 1,
      is_single_sided: 0
    }]
  }).text();

  assert.match(html, /action="\/documents\/7\/edit"/);
  assert.match(html, /name="documentName"[^>]*required/);
  assert.match(html, /name="documentNumber"[^>]*required/);
  assert.match(html, /name="revisionNumber"[^>]*required/);
  assert.match(html, /type="date" name="revisionDate"[^>]*required/);
  assert.match(html, /type="number" name="disposalDueYear"[^>]*required/);
  assert.match(html, /name="rackSlotId"[^>]*required/);
  assert.match(html, /value="30"[^>]*selected/);
  assert.match(html, /name="rackFace"[^>]*required/);
  assert.match(html, /value="B" selected/);
  assert.match(html, /열 \(면 안쪽부터\)/);
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
          label: "1구역 / 1-1번 랙 / 2열 / 3선반",
          zoneNumber: 1,
          rackNumber: 1,
          rackCode: "1-01",
          rackLabel: "1-1",
          isSingleSided: false,
          columnNumber: 2,
          shelfNumber: 3,
          rackFace: "A"
        },
        matchReason: "문서번호 부분 일치",
        relevanceScore: 320,
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

  assert.match(html, /문서 위치 검색/);
  assert.match(html, /data-viewer-results/);
  assert.match(html, /문서고 도면/);
  assert.match(html, /Archive\.png/);
  assert.match(html, /class="floor-plan-scroll"/);
  assert.match(html, /class="floor-plan-scroll" tabindex="0" aria-label="문서고 랙 도면/);
  assert.match(html, /class="rack-num">1<\/span>/);
  assert.match(html, /data-rack-code="1-01"[^>]*aria-label="1-01 · 양면/);
  assert.doesNotMatch(html, /title="[^"]*\d+건/);
  assert.match(html, /class="floor-wall-marker">벽면 ↑/);
  assert.match(html, /각 면의 1열 = 통로 안쪽/);
  assert.match(html, /data-answer-card/, "단독 결과는 정답 카드로 렌더된다");
  assert.match(html, /1-1번 랙/, "양면 랙은 면 단위 표기(1-1)로 안내한다");
  assert.match(html, /상세 정보/);
  assert.match(html, /<mark>PV<\/mark>/, "검색어 일치 부분이 하이라이트된다");
  assert.match(html, /window\.SearchCore/, "즉시 검색 코어가 내려간다");
  assert.match(html, /<select name="status">[\s\S]*?보관중 문서[\s\S]*?폐기 문서만/);
  assert.doesNotMatch(html, /name="includeDisposed"/);
  assert.match(html, /href="\/app" class="brand"/);
  const viewerNav = html.match(/<nav aria-label="주 메뉴"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(viewerNav, /href="\/app"[^>]*>[\s\S]*?검색/);
  assert.doesNotMatch(viewerNav, /href="\/(documents|sets|qa|racks|categories|tags|admin)"/);
  assert.doesNotMatch(html, /command-palette|data-command-palette|Ctrl\+K/);
  assert.match(html, /suggestionUrl \+= '&status=disposed'/, "폐기 검색 자동완성도 상태를 전달한다");
  assert.doesNotMatch(html, />Dashboard</);
});

test("dashboard home mode renders the search shell with a large floor plan", async () => {
  const response = dashboardPage({
    session: { username: "viewer", displayName: "조회자", role: "User", csrfToken: "csrf-token-123" },
    mode: "home",
    query: "",
    categories: [{ id: 1, name: "PV" }],
    tags: [],
    filters: {},
    floorPlan: [{
      key: "zone-1",
      label: "1구역",
      description: "",
      zoneNumber: 1,
      topPct: 8,
      leftPct: 5,
      widthPct: 40,
      heightPct: 35,
      racks: [
        { id: 1, code: "1-01", rackNumber: 1, documentCount: 1, isSingleSided: false, leftPct: 10, topPct: 50, widthPct: 4 },
        { id: 13, code: "1-13", rackNumber: 13, documentCount: 0, isSingleSided: false, leftPct: 90, topPct: 50, widthPct: 4 }
      ]
    }]
  });
  const html = await response.text();

  assert.match(html, /data-search-home/);
  assert.match(html, /home-floor-plan/, "홈에는 도면이 크게 들어간다");
  assert.match(html, /문서고 도면/);
  assert.match(html, /data-rack-code="1-13"/, "도면 위에 랙이 투영된다");
  assert.match(html, /2개 랙/);
  assert.doesNotMatch(html, /자주 찾는 문서/, "자주 찾는 문서 기능은 제거되었다");
  assert.match(html, /window\.SearchCore/);
  assert.doesNotMatch(html, /검색 리포트/, "일반 사용자에게 관리자 링크가 없다");
  assert.doesNotMatch(html, /href="\/(sets|qa|racks|categories|tags)"/, "검색 홈에 보조 기능 바로가기가 없다");
});

test("admin navigation and management settings keep advanced routes off the top level", async () => {
  const session = { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" };
  const html = await adminDashboardPage({ session, pendingCount: 2, quality: null }).text();

  const nav = html.match(/<nav aria-label="주 메뉴"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(nav, /href="\/app"[^>]*>[\s\S]*?검색/);
  assert.match(nav, /href="\/documents"[^>]*>[\s\S]*?문서 관리/);
  assert.match(nav, /href="\/documents\/disposal"[^>]*>[\s\S]*?폐기 작업/);
  assert.match(nav, /href="\/admin"[^>]*>[\s\S]*?관리 설정/);
  assert.doesNotMatch(nav, /href="\/(sets|qa|racks|categories|tags)"/);

  assert.match(html, /<h1>관리 설정<\/h1>/);
  assert.match(html, /class="panel admin-tile" href="\/admin\/settings"/);
  assert.match(html, /href="\/racks"/);
  assert.match(html, /href="\/racks\/configure"/);
  assert.match(html, /href="\/categories"/);
  assert.match(html, /href="\/tags"/);
  assert.match(html, /href="\/documents\/import"/);
  assert.match(html, /href="\/admin\/search-report"/);
  assert.match(html, /고급 도구/);
  assert.match(html, /href="\/sets"/);
});

test("ordinary document management list has no disposal selection and keeps mobile data labels", async () => {
  const html = await documentsPage({
    session: { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" },
    query: "",
    documents: [{
      id: 7,
      document_name: "밸리데이션 보고서",
      document_number: "PV-2026-014",
      revision_number: "Rev.1",
      revision_date: "2026-04-14",
      disposal_due_year: 2031,
      status: "active",
      rack_code: "1-03",
      zone_number: 1,
      rack_number: 3,
      column_number: 2,
      shelf_number: 3,
      rack_face: "A"
    }],
    categories: [],
    tags: [],
    filters: { status: "active", sort: "updated" }
  }).text();

  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";
  assert.match(main, /<h1>문서 관리<\/h1>/);
  assert.match(main, /data-label="문서명"/);
  assert.match(main, /data-label="문서번호"/);
  assert.match(main, /data-label="보관 위치"/);
  assert.doesNotMatch(main, /data-bulk-item|data-bulk-select-all|data-bulk-bar/);
  assert.doesNotMatch(main, /is-bulk-selectable/);
  assert.doesNotMatch(main, /action="\/documents\/bulk-dispose"/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*?\.doc-table/);
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
      is_single_sided: 0,
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
      is_single_sided: 0,
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
  assert.match(adminHtml, /1구역 \/ 1-2번 랙 \/ 1열 \/ 1선반/);
  assert.match(adminHtml, /2구역 \/ 1-1번 랙 \/ 3열 \/ 2선반/);
  assert.match(adminHtml, /action="\/sets\/5\/add"/);
  assert.match(adminHtml, /action="\/sets\/5\/remove"/);
  assert.match(adminHtml, /data-print/);
  assert.doesNotMatch(adminHtml, /보관코드|ARC-00000[12]/);
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

test("set details page shows set history", async () => {
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
    rack_face: "A"
  }];

  const html = await setDetailsPage({
    session: { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf-token-123" },
    set: { id: 5, name: "정기감사 준비문서", description: "" },
    documents,
    racks: [{ id: 1, code: "1-01", zone_number: 1, rack_number: 1, document_count: 1 }],
    logs: [{ id: 1, action: "add", actor: "관리자", details: "문서 1건 추가: MR-2026-001", created_at: "2026-07-08" }]
  }).text();

  assert.match(html, /세트 변경 이력/);
  assert.match(html, /문서 추가/);
});

test("document details page keeps location tools, collapses the floor plan, and limits admin actions", async () => {
  const baseDocument = {
    id: 7,
    storage_code: "ARC-000007",
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    document_name: "밸리데이션 보고서",
    category_name: "PV",
    status: "active",
    rack_code: "1-03",
    zone_number: 1,
    rack_number: 3,
    is_single_sided: 0,
    column_number: 2,
    shelf_number: 3,
    column_count: 7,
    shelf_count: 6,
    rack_face: "A",
    note: ""
  };
  const session = { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" };
  const floorPlan = [{
    key: "zone-1",
    label: "1구역",
    description: "",
    zoneNumber: 1,
    topPct: 8,
    leftPct: 5,
    widthPct: 40,
    heightPct: 35,
    racks: [
      { id: 1, code: "1-01", rackNumber: 1, documentCount: 1, isSingleSided: true, leftPct: 8, topPct: 50, widthPct: 4 },
      { id: 3, code: "1-03", rackNumber: 3, documentCount: 1, isSingleSided: false, leftPct: 30, topPct: 50, widthPct: 4 }
    ]
  }];
  const emptyLogs = { tags: [], disposalLogs: [], auditLogs: [] };

  const adminHtml = await documentDetailsPage({ session, document: baseDocument, ...emptyLogs, floorPlan }).text();
  assert.match(adminHtml, /id="tab-audit"[^>]*>Audit Trail/);
  assert.doesNotMatch(adminHtml, /id="tab-disposal"/);
  assert.doesNotMatch(adminHtml, /<small>보관코드<\/small>/);
  assert.doesNotMatch(adminHtml, /ARC-000007/);
  assert.match(adminHtml, /<span class="mono">1-03<\/span>/);
  assert.doesNotMatch(adminHtml, /<small>폐기사유<\/small>/);
  assert.ok(
    adminHtml.indexOf("<small>상태</small>") <
      adminHtml.indexOf("<small>대분류</small>") &&
    adminHtml.indexOf("<small>대분류</small>") <
      adminHtml.indexOf("<small>태그</small>") &&
    adminHtml.indexOf("<small>태그</small>") <
      adminHtml.indexOf("<small>비고</small>"),
    "기본정보 보조 항목은 상태, 대분류, 태그, 비고 순서로 표시한다"
  );
  assert.match(adminHtml, /1구역 \/ 3-1번 랙 \/ 2열 \/ 3선반/, "위치 히어로가 면 단위 표기를 쓴다");
  assert.doesNotMatch(adminHtml, /<small>보관위치<\/small>/, "정보 그리드에 위치를 중복 표시하지 않는다");
  assert.match(adminHtml, /<details class="panel doc-floor-plan">/);
  assert.doesNotMatch(adminHtml, /<details class="panel doc-floor-plan"[^>]*\bopen\b/);
  assert.match(adminHtml, /floor-zoom/, "접힌 구역 확대 도면이 유지된다");
  // 양면 랙은 좌우 두 면으로 나뉘고, 문서가 있는 면(좌=A)만 data-face-hit로 강조된다.
  assert.match(adminHtml, /class="floor-rack is-double"[^>]*data-face-hit="A"[^>]*data-rack-code="1-03"/);
  assert.match(adminHtml, /data-rack-code="1-03"[^>]*>[\s\S]*?<span class="rack-num">3-1<\/span>/);
  assert.match(adminHtml, /rack-face-a/);
  assert.match(adminHtml, /class="floor-wall-marker">벽면 ↑/);
  assert.match(adminHtml, /class="mini-rack-grid" data-column-origin="left"/);
  assert.match(adminHtml, /왼쪽에서 2번째 열/);
  assert.ok(adminHtml.indexOf("<span>1-6</span>") < adminHtml.indexOf("<span>7-6</span>"));
  // 단면 랙(1-01)은 면 분할 없이 렌더된다.
  assert.match(adminHtml, /class="floor-rack is-single column-origin-right"[^>]*data-rack-code="1-01"/);
  assert.doesNotMatch(adminHtml, /is-single"[^>]*data-face-hit/, "단면 랙에는 면 강조가 붙지 않는다");
  assert.ok(
    adminHtml.indexOf('class="panel minimap-card"') > adminHtml.indexOf('class="panel detail-grid"') &&
    adminHtml.indexOf('class="panel minimap-card"') < adminHtml.indexOf('class="panel doc-floor-plan"'),
    "서가 미니 시각화 뒤에 접힌 큰 도면이 렌더된다"
  );
  assert.match(adminHtml, /좌측\)입니다/, "강조된 면이 좌측(1면)임을 설명한다");
  assert.match(adminHtml, /data-open-modal="dispose-modal"/, "관리자에게 폐기 버튼이 보인다");
  assert.match(adminHtml, /href="\/documents\?q=1-03"[^>]*>같은 랙 문서 보기/);
  // 실물 취급 기능은 남아있지 않아야 한다.
  assert.doesNotMatch(adminHtml, /\/checkout"|\/return"|\/move"|\/guide"|\/custody"/);
  assert.doesNotMatch(adminHtml, /반출|이동 이력/);

  const auditHtml = await documentDetailsPage({
    session,
    document: baseDocument,
    tags: [],
    disposalLogs: [],
    auditLogs: [{
      action: "update",
      summary: "문서 정보 수정",
      actor: "관리자",
      actor_role: "Admin",
      created_at: "2026-07-17",
      details: JSON.stringify({
        before: { storageCode: "ARC-000007", documentNumber: "PV-2026-013" },
        after: { storage_code: "ARC-000007", documentNumber: "PV-2026-014" }
      })
    }]
  }).text();
  assert.match(auditHtml, /documentNumber/);
  assert.doesNotMatch(auditHtml, /storageCode|storage_code|ARC-000007/);

  const rightFaceHtml = await documentDetailsPage({
    session,
    document: { ...baseDocument, rack_face: "B" },
    ...emptyLogs,
    floorPlan
  }).text();
  assert.match(rightFaceHtml, /class="mini-rack-grid" data-column-origin="right"/);
  assert.match(rightFaceHtml, /오른쪽에서 2번째 열/);
  assert.ok(rightFaceHtml.indexOf("<span>7-6</span>") < rightFaceHtml.indexOf("<span>1-6</span>"));

  const singleRackHtml = await documentDetailsPage({
    session,
    document: {
      ...baseDocument,
      rack_code: "1-01",
      rack_number: 1,
      is_single_sided: 1,
      rack_face: "A"
    },
    ...emptyLogs,
    floorPlan
  }).text();
  assert.match(singleRackHtml, /1구역 1번 단면랙은 우측 랙과 같은 방향이므로 오른쪽이 1열입니다/);
  assert.match(singleRackHtml, /class="mini-rack-grid" data-column-origin="right"/);
  assert.ok(singleRackHtml.indexOf("<span>7-6</span>") < singleRackHtml.indexOf("<span>1-6</span>"));

  const disposedHtml = await documentDetailsPage({
    session,
    document: { ...baseDocument, status: "disposed" },
    tags: [],
    disposalLogs: [{
      id: 2,
      action: "disposed",
      performed_by: "관리자",
      reason: "보존기간 만료",
      created_at: "2026-07-17"
    }],
    auditLogs: []
  }).text();
  const disposedMain = disposedHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";
  assert.match(disposedMain, /<small>폐기사유<\/small><strong>보존기간 만료<\/strong>/);
  assert.doesNotMatch(disposedMain, /id="tab-disposal"/);
  assert.doesNotMatch(disposedMain, /delete-permanent|완전 삭제|delete-modal/);
  assert.match(disposedMain, /action="\/documents\/7\/restore"/);

  const viewerHtml = await documentDetailsPage({
    session: { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf-token-123" },
    document: baseDocument,
    ...emptyLogs
  }).text();
  assert.doesNotMatch(viewerHtml, /data-open-modal="dispose-modal"/, "일반 사용자에게 폐기 버튼이 없다");
  assert.doesNotMatch(viewerHtml, /Audit Trail|id="tab-audit"|id="panel-audit"/, "일반 사용자에게 감사 이력이 없다");
  assert.doesNotMatch(viewerHtml, /href="\/documents">문서 관리/, "일반 사용자 상세 경로는 검색으로 돌아간다");
  assert.match(viewerHtml, /href="\/app">문서 검색/);
  assert.match(viewerHtml, /href="\/app\?q=1-03"[^>]*>같은 랙 문서 보기/, "일반 사용자는 같은 랙 검색도 일상 검색 화면을 쓴다");
});
