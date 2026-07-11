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
  assert.match(html, /data-answer-card/, "단독 결과는 정답 카드로 렌더된다");
  assert.match(html, /1-1번 랙/, "양면 랙은 면 단위 표기(1-1)로 안내한다");
  assert.match(html, /상세 정보/);
  assert.match(html, /<mark>PV<\/mark>/, "검색어 일치 부분이 하이라이트된다");
  assert.match(html, /window\.SearchCore/, "즉시 검색 코어가 내려간다");
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

test("document details page renders info, audit, and disposal tabs for admins", async () => {
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
  assert.match(adminHtml, /감사 이력/);
  assert.match(adminHtml, /폐기 이력/);
  assert.match(adminHtml, /1구역 \/ 3-1번 랙 \/ 2열 \/ 3선반/, "위치 히어로가 면 단위 표기를 쓴다");
  // 기본정보 탭: 문서 정보와 서가 위치 사이에 "그 구역만 확대한" 도면이 들어간다.
  assert.match(adminHtml, /doc-floor-plan/);
  assert.match(adminHtml, /floor-zoom/, "구역 확대 도면이 쓰인다");
  // 양면 랙은 좌우 두 면으로 나뉘고, 문서가 있는 면(좌=A)만 data-face-hit로 강조된다.
  assert.match(adminHtml, /class="floor-rack is-double"[^>]*data-face-hit="A"[^>]*data-rack-code="1-03"/);
  assert.match(adminHtml, /rack-face-a/);
  // 단면 랙(1-01)은 면 분할 없이 렌더된다.
  assert.match(adminHtml, /class="floor-rack is-single"[^>]*data-rack-code="1-01"/);
  assert.doesNotMatch(adminHtml, /is-single"[^>]*data-face-hit/, "단면 랙에는 면 강조가 붙지 않는다");
  assert.ok(
    adminHtml.indexOf('class="panel doc-floor-plan"') > adminHtml.indexOf('class="panel detail-grid"') &&
    adminHtml.indexOf('class="panel doc-floor-plan"') < adminHtml.indexOf('class="panel minimap-card"'),
    "도면은 문서 정보와 서가 위치 사이에 렌더된다"
  );
  assert.match(adminHtml, /좌측\)입니다/, "강조된 면이 좌측(1면)임을 설명한다");
  assert.match(adminHtml, /data-open-modal="dispose-modal"/, "관리자에게 폐기 버튼이 보인다");
  assert.match(adminHtml, /같은 랙 문서 보기/);
  // 실물 취급 기능은 남아있지 않아야 한다.
  assert.doesNotMatch(adminHtml, /\/checkout"|\/return"|\/move"|\/guide"|\/custody"/);
  assert.doesNotMatch(adminHtml, /반출|이동 이력/);

  const viewerHtml = await documentDetailsPage({
    session: { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf-token-123" },
    document: baseDocument,
    ...emptyLogs
  }).text();
  assert.doesNotMatch(viewerHtml, /data-open-modal="dispose-modal"/, "일반 사용자에게 폐기 버튼이 없다");
});
