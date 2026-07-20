import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adminDashboardPage } from "../src/views/adminViews.js";
import { disposalWorkspacePage, documentDetailsPage, documentFormPage, documentsPage } from "../src/views/documentViews.js";
import { floorPlanPage } from "../src/views/floorPlanViews.js";
import { page } from "../src/views/layout.js";
import { dashboardPage, qaPage } from "../src/views/searchViews.js";
import { setDetailsPage } from "../src/views/setViews.js";

const APP_SCRIPT = await readFile(new URL("../public/assets/app.js", import.meta.url), "utf8");
const APP_STYLES = await readFile(new URL("../public/assets/app.css", import.meta.url), "utf8");

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

test("disposal workspace renders target/history tabs and a review-first disposal flow", async () => {
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
  assert.match(html, /<span>폐기 예정 연도<\/span>/);
  assert.match(html, /<span>대분류<\/span>/);
  assert.match(html, /<span>보관 위치<\/span>/);
  assert.match(html, /data-bulk-select-all/);
  assert.match(html, /class="doc-table is-bulk-selectable"/);
  assert.match(html, /bulk-select-all-text">현재 목록 전체 선택<\/span>/);
  assert.match(APP_STYLES, /\.doc-table\.is-bulk-selectable thead \{ display: block; \}/);
  assert.match(html, /data-bulk-item/);
  assert.match(html, />폐기 대상<\/a>/);
  assert.match(html, />폐기 이력<\/a>/);
  assert.match(html, /action="\/documents\/disposal\/process"/);
  assert.match(html, /id="disposal-review-modal"/);
  assert.match(html, /data-bulk-summary/);
  assert.match(html, /class="revision-cell"/);
  assert.match(html, /name="reason"[^>]*required/);
  assert.match(html, /name="approvalReference"/);
  assert.match(html, /data-bulk-count>0건 선택/);
  assert.match(html, />폐기 검토</);
  assert.match(html, />폐기 확인</);
  assert.match(html, /name="csrf_token" value="csrf-token-123"/);
  assert.doesNotMatch(html, /action="\/documents\/dispose-filtered"/);
  assert.equal((html.match(/name="reason"/g) || []).length, 1);

  const historyHtml = await disposalWorkspacePage({
    session: { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" },
    tab: "history",
    history: [{
      id: 9,
      document_id: 7,
      document_name: "밸리데이션 보고서",
      document_number: "PV-2026-014",
      revision_number: "Rev.1",
      category_name: "PV",
      location_snapshot: "1구역 / 3-1번 랙 / 2열 / 3선반",
      reason: "보존기간 만료",
      approval_reference: "QA-APP-2026-041",
      performed_by: "관리자",
      created_at: "2026-07-18"
    }],
    pagination: { page: 1, totalPages: 1, totalItems: 1 },
    filters: {},
    feedback: { type: "success", message: "문서 1건을 폐기했습니다." }
  }).text();
  const historyMain = historyHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";
  assert.match(historyMain, /class="status disposed">폐기<\/span>/);
  assert.match(historyMain, /보존기간 만료/);
  assert.match(historyMain, /QA-APP-2026-041/);
  assert.match(historyMain, />폐기 이력 보기<\/a>/);
  assert.match(historyMain, />문서검색으로 이동<\/a>/);
  assert.doesNotMatch(historyMain, /data-bulk-item|data-bulk-bar|폐기 캠페인/);
});

test("copy controls use delegated events for dynamically rendered search results", async () => {
  const response = page("복사", `<button type="button" data-copy-text="1구역">위치 복사</button>`, {
    username: "admin",
    displayName: "관리자",
    role: "Admin",
    csrfToken: "csrf-token-123"
  });
  const html = await response.text();

  assert.match(APP_SCRIPT, /document\.addEventListener\('click'/);
  assert.match(APP_SCRIPT, /closest\('\[data-copy-text\]'\)/);
  assert.match(APP_SCRIPT, /button\.textContent = '복사됨'/);
});

test("Q&A renders optional support settings without a hard-coded address", async () => {
  const session = { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf" };
  const configured = await qaPage({
    session,
    support: { department: "SQA팀", name: "담당자", email: "archive@example.com" }
  }).text();
  const unconfigured = await qaPage({ session, support: {} }).text();

  assert.match(configured, /SQA팀 \/ 담당자/);
  assert.match(configured, /mailto:archive@example\.com/);
  assert.doesNotMatch(unconfigured, /mailto:/);
  assert.match(unconfigured, /운영 관리자에게 문의하세요/);
});

test("document form groups metadata, previews values, and progressively enhances storage location", async () => {
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
  assert.match(html, /<legend>문서 정보<\/legend>/);
  assert.match(html, /<legend>보존 정보<\/legend>/);
  assert.match(html, /<legend>보관 위치<\/legend>/);
  assert.match(html, /data-form-review/);
  assert.match(html, /location-picker-steps/);
  assert.match(html, /wrap\('구역'/);
  assert.match(html, /wrap\('랙'/);
  assert.match(html, /wrap\('면'/);
  assert.match(html, /wrap\('열'/);
  assert.match(html, /wrap\('선반'/);
  assert.match(html, /field-locationZone/);
  assert.match(html, /field-locationFace/);
  assert.match(html, /\/api\/documents\/duplicate/);
  assert.ok(html.indexOf("var current = ++requestId;") < html.indexOf("if (!number || !revision || !notice)"));
  for (const script of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])) {
    assert.doesNotThrow(() => new Function(script));
  }

  const revisionHtml = await documentFormPage({
    session: { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" },
    title: "새 개정 등록",
    action: "/documents",
    values: { documentNumber: "SOP-QA-014", documentName: "변경관리 절차서", categoryId: 1, rackSlotId: 1, rackFace: "A", revisionSourceId: 7 },
    categories: [{ id: 1, name: "품질보증" }],
    tags: [{ id: 2, name: "원본보관" }],
    slots: [{ id: 1, zone_number: 1, rack_number: 13, column_number: 3, shelf_number: 4, is_single_sided: 0 }],
    selectedTags: [2]
  }).text();
  assert.match(revisionHtml, /<h2 id="note-title">필요한 변경사항<\/h2>/);
  assert.match(revisionHtml, /name="documentNumber" value="SOP-QA-014"/);
  assert.match(revisionHtml, /name="revisionNumber" value=""/);

  const errorHtml = await documentFormPage({
    session: { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" },
    title: "문서 등록",
    action: "/documents",
    values: {},
    categories: [],
    tags: [],
    slots: [],
    validation: {
      fieldErrors: {
        documentNumber: "문서번호를 입력하세요.",
        disposalDueYear: "폐기 예정 년도를 입력하세요."
      },
      formErrors: []
    }
  }).text();
  assert.match(errorHtml, /data-error-summary/);
  assert.match(errorHtml, /아래 2개 항목을 확인하세요/);
  assert.match(errorHtml, /href="#field-documentNumber"/);
  assert.match(errorHtml, /href="#field-disposalDueYear"/);
  assert.match(errorHtml, /aria-invalid="true"/);
});

test("dashboard page renders search-first row results without a floor plan", async () => {
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
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";

  assert.match(html, /data-viewer-form/);
  assert.match(html, /data-viewer-results/);
  assert.doesNotMatch(main, /문서고 도면|Archive\.png|floor-plan|data-answer-card/);
  assert.doesNotMatch(main, /문서번호 부분 일치/);
  assert.match(html, /viewer-result-header/);
  for (const label of ["문서명", "문서번호", "개정", "제·개정일", "대분류", "보관 위치", "상태"]) {
    assert.match(html, new RegExp(">" + label + "<"));
  }
  assert.match(html, /<mark>PV<\/mark>/, "검색어 일치 부분이 하이라이트된다");
  assert.match(APP_SCRIPT, /window\.SearchCore/, "즉시 검색 코어가 정적 자산에 포함된다");
  assert.match(html, /<select name="status">[\s\S]*?보관중 문서[\s\S]*?폐기 문서[\s\S]*?전체/);
  assert.doesNotMatch(html, /name="includeDisposed"/);
  assert.match(html, /href="\/app" class="brand"/);
  const viewerNav = html.match(/<nav aria-label="주 메뉴"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(viewerNav, /href="\/app"[^>]*>[\s\S]*?문서검색/);
  assert.doesNotMatch(viewerNav, /href="\/(documents|sets|qa|racks|categories|tags|admin|disposal-batches)/);
  assert.match(html, /class="mobile-tabs"[\s\S]*?href="\/app"/);
  assert.match(html, /data-command-palette/);
  assert.match(html, /Ctrl\+K/);
  assert.match(APP_SCRIPT, /suggestionUrl \+= '&status=disposed'/, "폐기 검색 자동완성도 상태를 전달한다");
  assert.doesNotMatch(html, />Dashboard</);
});

test("dashboard home mode starts with the search input and no hero or floor plan", async () => {
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
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";

  assert.match(html, /data-search-home/);
  assert.match(html, /data-viewer-form/);
  assert.match(html, /검색어를 입력하면 보관중 문서를 바로 찾습니다/);
  assert.match(html, /<details class="filter-details" open>/);
  assert.doesNotMatch(main, /search-home-hero|home-floor-plan|문서고 도면|data-rack-code/);
  assert.doesNotMatch(html, /자주 찾는 문서/, "자주 찾는 문서 기능은 제거되었다");
  assert.match(APP_SCRIPT, /window\.SearchCore/);
  assert.doesNotMatch(html, /검색 리포트/, "일반 사용자에게 관리자 링크가 없다");
  const mainNav = html.match(/<nav aria-label="주 메뉴"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(mainNav, /href="\/app"/);
  assert.match(mainNav, /href="\/floor-plan"[^>]*>[\s\S]*?문서고 도면/);
  assert.doesNotMatch(mainNav, /href="\/(documents|sets|qa|racks|categories|tags|disposal-batches)"/);
});

test("floor plan page keeps the map separate from search and opens rack results for every user", async () => {
  const html = await floorPlanPage({
    session: { username: "viewer", displayName: "조회자", role: "User", csrfToken: "csrf-token-123" },
    floorPlan: [{
      key: "zone-1",
      label: "1구역",
      description: "좌상단 문서 보관 구역",
      zoneNumber: 1,
      topPct: 3.2,
      leftPct: 4.7,
      widthPct: 47.5,
      heightPct: 38.2,
      racks: [{ id: 3, code: "1-03", rackNumber: 3, documentCount: 2, isSingleSided: false, leftPct: 50, topPct: 50, widthPct: 4 }]
    }]
  }).text();
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";

  assert.match(main, /<h1>문서고 도면<\/h1>/);
  assert.match(main, /src="\/images\/Archive\.png"/);
  assert.match(main, /data-rack-code="1-03"/);
  assert.match(main, /href="\/documents\?rack=3&amp;status=active&amp;sort=location"/);
  assert.doesNotMatch(main, /href="\/app\?q=1-03/);
});

test("admin navigation exposes permission-scoped work routes", async () => {
  const session = { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf-token-123" };
  const html = await adminDashboardPage({ session, pendingCount: 2, quality: null }).text();

  const nav = html.match(/<nav aria-label="주 메뉴"[\s\S]*?<\/nav>/)?.[0] || "";
  const commands = html.match(/<dialog class="command-palette"[\s\S]*?<\/dialog>/)?.[0] || "";
  assert.match(nav, /href="\/app"[^>]*>[\s\S]*?문서검색/);
  assert.match(nav, /href="\/floor-plan"[^>]*>[\s\S]*?문서고 도면/);
  assert.match(nav, /href="\/documents\/import"[^>]*>[\s\S]*?엑셀대장/);
  assert.match(nav, /href="\/documents\/disposal"[^>]*>[\s\S]*?문서폐기/);
  assert.match(nav, /class="nav-settings"/);
  assert.match(nav, />관리자 설정<\/summary>/);
  assert.match(APP_STYLES, /\.topbar ~ \.app-shell/);
  assert.match(commands, /href="\/documents\/import"[^>]*>[\s\S]*?엑셀대장/);
  assert.match(commands, /href="\/floor-plan"[^>]*>[\s\S]*?문서고 도면/);
  assert.match(commands, /href="\/documents\/import"[^>]*>[\s\S]*?엑셀 문서대장/);
  assert.match(commands, /href="\/racks"[^>]*>[\s\S]*?랙/);
  assert.match(commands, /href="\/categories"[^>]*>[\s\S]*?대분류/);
  assert.match(commands, /href="\/tags"[^>]*>[\s\S]*?태그/);
  assert.match(commands, /href="\/admin\/settings"[^>]*>[\s\S]*?사용자·권한/);
  assert.match(commands, /href="\/admin\/audit"[^>]*>[\s\S]*?감사 이력/);
  assert.match(nav, /href="\/admin"[^>]*>[\s\S]*?운영 관리/);

  assert.match(html, /<h1>관리 설정<\/h1>/);
  assert.match(html, /class="panel admin-tile" href="\/admin\/settings"/);
  assert.match(html, /href="\/racks"/);
  assert.match(html, /href="\/racks\/configure"/);
  assert.match(html, /href="\/categories"/);
  assert.match(html, /href="\/tags"/);
  assert.match(html, /href="\/documents\/import"/);
  assert.match(html, /href="\/admin\/search-report"/);
  assert.doesNotMatch(html, /href="\/(?:disposal-batches|sets)"|폐기 캠페인|문서 세트/);
});

test("desktop navigation and mobile tabs hide every unauthorized work route", async () => {
  const archiveManagerHtml = await dashboardPage({
    session: { username: "manager", displayName: "문서 담당자", role: "User", csrfToken: "csrf-token-123", can_manage_documents: true },
    mode: "home",
    query: "",
    categories: [],
    tags: [],
    filters: {}
  }).text();
  const archiveManagerNav = archiveManagerHtml.match(/<nav aria-label="주 메뉴"[\s\S]*?<\/nav>/)?.[0] || "";
  const archiveManagerTabs = archiveManagerHtml.match(/<nav class="mobile-tabs"[\s\S]*?<\/nav>/)?.[0] || "";
  for (const navigation of [archiveManagerNav, archiveManagerTabs]) {
    assert.match(navigation, /href="\/app"/);
    assert.match(navigation, /href="\/floor-plan"/);
    assert.match(navigation, /href="\/documents\/import"/);
    assert.doesNotMatch(navigation, /href="\/documents\/disposal"|관리자 설정/);
  }

  const disposalManagerHtml = await dashboardPage({
    session: { username: "disposal", displayName: "폐기 담당자", role: "User", csrfToken: "csrf-token-123", can_manage_disposals: true },
    mode: "home",
    query: "",
    categories: [],
    tags: [],
    filters: {}
  }).text();
  const disposalManagerTabs = disposalManagerHtml.match(/<nav class="mobile-tabs"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(disposalManagerTabs, /href="\/app"/);
  assert.match(disposalManagerTabs, /href="\/floor-plan"/);
  assert.match(disposalManagerTabs, /href="\/documents\/disposal"/);
  assert.doesNotMatch(disposalManagerTabs, /href="\/documents\/import"|관리자 설정/);
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
  assert.match(main, /<select name="status">[\s\S]*?보관중[\s\S]*?폐기[\s\S]*?전체/);
  assert.doesNotMatch(main, /action="\/documents\/bulk-dispose"/);
  assert.match(APP_STYLES, /@media \(max-width: 760px\)[\s\S]*?\.doc-table/);
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
  assert.match(adminHtml, /href="\/documents\?rack=1&amp;status=active&amp;sort=location"/);
  assert.match(adminHtml, /href="\/documents\?rack=2&amp;status=active&amp;sort=location"/);
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

test("document details page keeps core information and permission-scoped actions", async () => {
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
  const coreEmptyLogs = {
    tags: [],
    disposalLogs: [],
    auditLogs: [],
    movements: [],
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
  };
  const coreAdminHtml = await documentDetailsPage({ session, document: baseDocument, ...coreEmptyLogs }).text();
  const coreAdminMain = coreAdminHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";
  assert.match(coreAdminHtml, /밸리데이션 보고서/);
  assert.match(coreAdminHtml, /PV-2026-014/);
  assert.match(coreAdminHtml, /1구역 \/ 3-1번 랙 \/ 2열 \/ 3선반/);
  assert.match(coreAdminHtml, /기본 정보/);
  assert.match(coreAdminHtml, /보존 정보/);
  assert.match(coreAdminHtml, /href="\/documents\/7\/edit"[^>]*>수정/);
  assert.match(coreAdminHtml, /href="\/documents\/7\/revise"[^>]*>새 개정 등록/);
  assert.match(coreAdminHtml, /data-open-modal="dispose-modal"/);
  assert.match(coreAdminHtml, /<details[^>]*>[\s\S]*감사 이력/);
  assert.match(coreAdminMain, /<section class="panel doc-floor-plan"/);
  assert.match(coreAdminMain, /<h2 id="location-map-title">위치 도면 · 1구역<\/h2>/);
  assert.match(coreAdminMain, /src="\/images\/Archive\.png"/);
  assert.match(coreAdminMain, /data-face-hit="A"/);
  assert.match(coreAdminMain, /class="mini-rack-grid"/);
  assert.match(coreAdminMain, /class="mini-slot active" title="2열 3선반"/);
  assert.doesNotMatch(coreAdminMain, /<details class="panel doc-floor-plan"|위치 복사|같은 랙 문서 보기|\/documents\/7\/move/);
  assert.doesNotMatch(coreAdminMain, /ARC-000007|완전 삭제|세트에 추가|QR/);

  const coreDisposedHtml = await documentDetailsPage({
    session,
    document: { ...baseDocument, status: "disposed" },
    tags: [],
    disposalLogs: [{ action: "disposed", performed_by: "관리자", reason: "보존기간 만료", created_at: "2026-07-17" }],
    auditLogs: [],
    movements: []
  }).text();
  const coreDisposedMain = coreDisposedHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";
  assert.match(coreDisposedMain, /<dt>폐기 사유<\/dt><dd class="">보존기간 만료<\/dd>/);
  assert.match(coreDisposedMain, /action="\/documents\/7\/restore"/);
  assert.doesNotMatch(coreDisposedMain, /완전 삭제|\/documents\/7\/edit|\/documents\/7\/revise|data-open-modal="dispose-modal"/);

  const coreViewerHtml = await documentDetailsPage({
    session: { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf-token-123" },
    document: baseDocument,
    ...coreEmptyLogs
  }).text();
  assert.doesNotMatch(coreViewerHtml, /data-open-modal="dispose-modal"|감사 이력|위치 이동/);
  const coreViewerNav = coreViewerHtml.match(/<nav aria-label="주 메뉴"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(coreViewerNav, /href="\/app"/);
  assert.match(coreViewerNav, /href="\/floor-plan"/);
  assert.doesNotMatch(coreViewerNav, /href="\/(documents|sets|qa|admin|racks|categories|tags)/);
});
