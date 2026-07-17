import assert from "node:assert/strict";
import test from "node:test";

import {
  canMoveDocuments,
  dataQualityPage,
  disposalBatchFormPage,
  disposalBatchListPage,
  documentImportJobCreatePage,
  documentImportJobsPage,
  loginPage,
  movementFormPage,
  movementsPage,
  passwordPage,
  rackConfigurePage,
  rackDetailsPage,
  rackFormPage,
  racksPage,
  searchReportPage,
  setFormPage,
  setsPage
} from "../src/html.js";

const CSRF_TOKEN = "view-contract-csrf-token-1234567890";
const admin = { username: "admin@hanlim.com", displayName: "관리자", role: "Admin", csrfToken: CSRF_TOKEN };
const viewer = { username: "viewer@hanlim.com", displayName: "조회자", role: "User", csrfToken: CSRF_TOKEN };

test("로그인과 최초 비밀번호 변경 화면은 등록 이메일·보안 폼 계약을 유지한다", async () => {
  const login = await htmlPage(loginPage({
    returnUrl: `/app?next="><script>alert(1)</script>`,
    error: "",
    setupWarning: `<img src=x onerror=alert(1)>`,
    signupSubmitted: false
  }), "로그인");

  assert.match(login, /등록된 사내 이메일 계정만 로그인할 수 있습니다/);
  assert.match(login, /<input name="username" type="email" autocomplete="username" required>/);
  assertPostForm(login, "/login", ["returnUrl", "username", "password"], { csrf: false });
  assert.doesNotMatch(login, /href="\/signup"/);
  assert.doesNotMatch(login, /<img src=x|<script>alert\(1\)<\/script>/);
  assert.match(login, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const password = await htmlPage(passwordPage({ session: admin, required: true }), "비밀번호 변경");
  assert.match(password, /최초 로그인입니다/);
  assertPostForm(password, "/account/password", ["currentPassword", "newPassword", "confirmPassword"]);
});

test("랙 목록·설정·상세·폼은 위치 구조와 입력 계약을 공개 배럴에서 유지한다", async () => {
  const list = await htmlPage(racksPage({
    session: admin,
    racks: [{ id: 7, zone_number: 1, rack_number: 2, code: `1-02<script>bad()</script>`, is_single_sided: 0, active_document_count: 3 }]
  }), "랙 관리");
  assert.match(list, /<h1>보관 랙 목록<\/h1>/);
  assert.match(list, /href="\/racks\/7"/);
  assert.match(list, /1-02&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(list, /<script>bad\(\)<\/script>/);

  const configure = await htmlPage(rackConfigurePage({ session: admin, counts: { 1: 2, 2: 3, 3: 4 } }), "랙 설정");
  assertPostForm(configure, "/racks/configure", ["zone1Count", "zone2Count", "zone3Count"]);

  const details = await htmlPage(rackDetailsPage({
    session: admin,
    rack: { id: 7, code: "1-02", zone_number: 1, rack_number: 2, is_single_sided: 0, column_count: 7, shelf_count: 6 },
    documents: [],
    grid: [],
    selectedFace: "B"
  }), "1-02 랙");
  assert.match(details, /role="grid" aria-rowcount="6" aria-colcount="7"/);
  assert.match(details, /2-2면 위치 격자/);
  assert.match(details, /href="\/racks\/7\/edit"/);

  const form = await htmlPage(rackFormPage({
    session: admin,
    action: "/racks",
    title: "랙 추가",
    values: { zoneNumber: 2, rackNumber: 8, name: `<b>위험</b>`, description: `설명 <script>x</script>` }
  }), "랙 추가");
  assertPostForm(form, "/racks", ["zoneNumber", "rackNumber", "name", "description", "isSingleSided", "isActive"]);
  assert.match(form, /value="&lt;b&gt;위험&lt;\/b&gt;"/);
  assert.doesNotMatch(form, /<script>x<\/script>/);
});

test("위치 이동 화면은 권한 판정·낙관적 잠금·이력 escape 계약을 유지한다", async () => {
  const mover = { ...viewer, can_move_documents: true };
  assert.equal(canMoveDocuments(mover), true);
  assert.equal(canMoveDocuments(viewer), false);

  const document = {
    id: 11,
    document_number: `DOC-11<script>x</script>`,
    document_name: `이동 <img src=x>`,
    rack_slot_id: 3,
    rack_face: "A",
    rack_code: "1-02",
    zone_number: 1,
    rack_number: 2,
    is_single_sided: 0,
    column_number: 3,
    shelf_number: 4,
    updated_at: "2026-07-17 12:00:00",
    row_version: 9
  };
  const slots = [{ id: 3, zone_number: 1, rack_number: 2, column_number: 3, shelf_number: 4, is_single_sided: 0, label: "1구역 <위치>" }];
  const form = await htmlPage(movementFormPage({ session: mover, document, slots, values: { reason: `<script>이유</script>` } }), "문서 위치 이동");
  assertPostForm(form, "/documents/11/move", ["expectedUpdatedAt", "expectedRowVersion", "rackSlotId", "rackFace", "reason"]);
  assert.match(form, /name="expectedRowVersion" value="9"/);
  assert.match(form, /1구역 &lt;위치&gt;/);
  assert.doesNotMatch(form, /<script>이유<\/script>|<img src=x>/);

  const history = await htmlPage(movementsPage({
    session: mover,
    query: `담당자"><script>x</script>`,
    result: {
      page: 1,
      totalPages: 1,
      items: [{
        document_id: 11,
        created_at: "2026-07-17",
        document_number_snapshot: "DOC-11",
        from_location_snapshot: "1구역 2-1",
        to_location_snapshot: "2구역 <새 위치>",
        reason: `<img src=x onerror=1>`,
        performed_by_name: "담당자",
        performed_by_username: "user@hanlim.com"
      }]
    }
  }), "위치 이동 이력");
  assertGetForm(history, "/admin/movements", ["q"]);
  assert.match(history, /2구역 &lt;새 위치&gt;/);
  assert.match(history, /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(history, /<img src=x onerror=1>/);
});

test("데이터 품질과 검색 리포트는 작업 링크·집계·사용자 값 escape 계약을 유지한다", async () => {
  const quality = await htmlPage(dataQualityPage({
    session: admin,
    result: {
      issues: [{ key: "missing-location", label: "누락 <위치>" }],
      issue: "missing-location",
      label: "누락 위치",
      totalItems: 1,
      page: 1,
      totalPages: 1,
      items: [{
        id: 21,
        document_number: "DOC-21",
        revision_number: "R1",
        document_name: `<script>품질</script>`,
        category_name: "분류",
        status: "active"
      }]
    }
  }), "데이터 품질");
  assert.match(quality, /aria-label="데이터 품질 문제 유형"/);
  assert.match(quality, /href="\/admin\/data-quality\?issue=missing-location" class="chip active"/);
  assert.match(quality, /href="\/documents\/21\/edit"/);
  assert.match(quality, /&lt;script&gt;품질&lt;\/script&gt;/);

  const report = await htmlPage(searchReportPage({
    session: admin,
    report: {
      topQueries: [{ query_text: `<svg onload=1>`, hits: 4, last_result_count: 2, last_searched_at: "2026-07-17" }],
      failedQueries: [{ query_text: `실패"><img src=x>`, hits: 3, last_searched_at: "2026-07-17" }],
      topDocuments: [{ id: 8, document_number: "DOC-8", document_name: `<b>문서</b>`, click_count: 5 }]
    }
  }), "검색 리포트");
  assert.match(report, /자주 찾는 검색어/);
  assert.match(report, /결과 없는 검색어/);
  assert.match(report, /href="\/documents\/8"/);
  assert.match(report, /&lt;svg onload=1&gt;|&lt;b&gt;문서&lt;\/b&gt;/);
  assert.doesNotMatch(report, /<svg onload=1>|<img src=x>|<b>문서<\/b>/);
});

test("문서 세트 목록과 생성 폼은 관리 권한에 따른 동작 노출을 유지한다", async () => {
  const manager = { ...viewer, can_manage_sets: true };
  const fixture = [{ id: 4, name: `<b>감사 세트</b>`, description: `설명 <script>x</script>`, document_count: 2, disposed_count: 1 }];
  const managed = await htmlPage(setsPage({ session: manager, sets: fixture }), "문서 세트");
  const readonly = await htmlPage(setsPage({ session: viewer, sets: fixture }), "문서 세트");
  assert.match(managed, /href="\/sets\/new">세트 만들기<\/a>/);
  assert.doesNotMatch(readonly, /href="\/sets\/new"/);
  assert.match(managed, /&lt;b&gt;감사 세트&lt;\/b&gt;/);
  assert.doesNotMatch(managed, /<script>x<\/script>/);

  const form = await htmlPage(setFormPage({
    session: manager,
    action: "/sets",
    title: "세트 만들기",
    values: { name: `<img src=x>`, description: `설명 & 확인` }
  }), "세트 만들기");
  assertPostForm(form, "/sets", ["name", "description"]);
  assert.match(form, /value="&lt;img src=x&gt;"/);
  assert.match(form, /설명 &amp; 확인/);
});

test("CSV 가져오기 목록과 생성 폼은 작업 링크·multipart 입력 계약을 유지한다", async () => {
  const list = await htmlPage(documentImportJobsPage({
    session: admin,
    jobs: [{
      id: 3,
      job_code: "IMP-3",
      source_name: `<script>원본</script>`,
      status: "ready",
      total_count: 5,
      completed_count: 1,
      failed_count: 1,
      pending_count: 3,
      created_by_name: "관리자",
      created_at: "2026-07-17"
    }]
  }), "CSV 가져오기 작업");
  assert.match(list, /href="\/document-import-jobs\/3"/);
  assert.match(list, /&lt;script&gt;원본&lt;\/script&gt;/);
  assert.doesNotMatch(list, /<script>원본<\/script>/);

  const form = await htmlPage(documentImportJobCreatePage({ session: admin }), "CSV 가져오기");
  assertPostForm(form, "/document-import-jobs", ["csvFile", "csvText"]);
  assert.match(form, /enctype="multipart\/form-data"/);
  assert.match(form, /accept="\.csv,text\/csv"/);
});

test("폐기 캠페인 목록과 초안 폼은 조건 필드·민감 값 escape 계약을 유지한다", async () => {
  const list = await htmlPage(disposalBatchListPage({
    session: admin,
    batches: [{
      id: 9,
      batch_code: "DSP-9",
      title: `<img src=x>폐기`,
      status: "draft",
      target_count: 2,
      completed_count: 0,
      excluded_count: 0,
      changed_count: 0,
      failed_count: 0,
      created_by_name: "관리자",
      created_at: "2026-07-17"
    }]
  }), "폐기 캠페인");
  assert.match(list, /href="\/disposal-batches\/9"/);
  assert.match(list, /&lt;img src=x&gt;폐기/);
  assert.doesNotMatch(list, /<img src=x>폐기/);

  const form = await htmlPage(disposalBatchFormPage({
    session: admin,
    values: { title: `<script>초안</script>`, disposalReason: `기한 & 만료`, criteria: { disposalDueYear: 2030 } },
    categories: [{ id: 2, name: `<b>분류</b>` }],
    racks: [{ id: 7, zone_number: 1, rack_number: 2 }]
  }), "폐기 캠페인 생성");
  assertPostForm(form, "/disposal-batches", ["title", "disposalReason", "approvalReference", "disposalDueYear", "yearMode", "categoryId", "zoneNumber", "rackId"]);
  assert.match(form, /value="&lt;script&gt;초안&lt;\/script&gt;"/);
  assert.match(form, /기한 &amp; 만료/);
  assert.match(form, /&lt;b&gt;분류&lt;\/b&gt;/);
  assert.doesNotMatch(form, /<script>초안<\/script>|<b>분류<\/b>/);
});

async function htmlPage(response, title) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const policy = response.headers.get("Content-Security-Policy") || "";
  const nonce = policy.match(/script-src 'self' 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, "CSP script nonce가 필요하다");

  const html = await response.text();
  assert.match(html, new RegExp(`<title>${escapePattern(title)} - 한림문서고<\\/title>`));
  assert.match(html, /<main id="main-content"/);
  for (const match of html.matchAll(/<(?:script|style)\b([^>]*)>/gi)) {
    assert.match(match[1], new RegExp(`\\bnonce="${escapePattern(nonce)}"`));
  }
  return html;
}

function assertPostForm(html, action, names, { csrf = true } = {}) {
  const form = html.match(new RegExp(`<form\\b[^>]*method="post"[^>]*action="${escapePattern(action)}"[^>]*>([\\s\\S]*?)<\\/form>`));
  assert.ok(form, `POST form ${action}`);
  if (csrf) assert.match(form[1], new RegExp(`name="csrf_token" value="${escapePattern(CSRF_TOKEN)}"`));
  for (const name of names) assert.match(form[1], new RegExp(`name="${escapePattern(name)}"`));
}

function assertGetForm(html, action, names) {
  const form = html.match(new RegExp(`<form\\b[^>]*method="get"[^>]*action="${escapePattern(action)}"[^>]*>([\\s\\S]*?)<\\/form>`));
  assert.ok(form, `GET form ${action}`);
  for (const name of names) assert.match(form[1], new RegExp(`name="${escapePattern(name)}"`));
}

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
