import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loginPage } from "../src/views/authViews.js";
import { page } from "../src/views/layout.js";
import { setDetailsPage } from "../src/views/setViews.js";

const LOGO_URL = "/images/hanlim-pharm-logo.svg";
const EXPECTED_SOURCE_SHA256 = "fa10dcacc4ff250e629782a87507ba7164a83783589199b8bee8896acc58885b";

test("한림제약 CI 자산은 전달받은 투명 PNG 바이트를 그대로 보존한다", async () => {
  const svg = await readFile(new URL("../public/images/hanlim-pharm-logo.svg", import.meta.url), "utf8");
  const encoded = svg.match(/data:image\/png;base64,([^"']+)/)?.[1];

  assert.ok(encoded, "embedded PNG가 있어야 한다");
  assert.equal(createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex"), EXPECTED_SOURCE_SHA256);
  assert.match(svg, /viewBox="0 0 295 211"/);
});

test("로그인 화면은 문자 임시 마크 대신 회사 로고를 사용한다", async () => {
  const loginHtml = await loginPage({ returnUrl: "/app" }).text();
  assert.match(loginHtml, new RegExp(`<img class="login-logo" src="${LOGO_URL}" alt="한림제약">`));
  assert.doesNotMatch(loginHtml, /class="login-logo">HA</);
});

test("인증 화면 헤더와 브라우저 아이콘은 회사 로고를 사용한다", async () => {
  const html = await page("브랜드", "<p>본문</p>", {
    username: "admin",
    displayName: "관리자",
    role: "Admin",
    csrfToken: "csrf-token"
  }).text();

  assert.match(html, new RegExp(`<link rel="icon" type="image/svg\\+xml" href="${LOGO_URL}">`));
  assert.match(html, new RegExp(`<img class="brand-logo" src="${LOGO_URL}" alt="한림제약">`));
  assert.doesNotMatch(html, /fa-building-columns/);
});

test("일반 navigation은 검색 중심이며 업무 권한별 등록·동기화·폐기만 노출한다", async () => {
  const base = {
    username: "user@hanlim.com",
    displayName: "사용자",
    role: "User",
    csrfToken: "navigation-csrf-token-1234567890"
  };
  const viewerHtml = await page("조회", "<p>본문</p>", base).text();
  assert.match(viewerHtml, /href="\/app"[^>]*>[\s\S]*?문서 검색/);
  assert.match(viewerHtml, /href="\/floor-plan"/);
  assert.doesNotMatch(viewerHtml, /href="\/sets"|href="\/documents\/new"|href="\/documents\/import"|href="\/documents\/disposal"/);

  const documentManagerHtml = await page("문서 관리", "<p>본문</p>", {
    ...base,
    can_manage_documents: true
  }).text();
  assert.match(documentManagerHtml, /href="\/documents\/new"[\s\S]*문서 등록/);
  assert.match(documentManagerHtml, /href="\/documents\/import"[\s\S]*엑셀 대장 동기화/);
  assert.doesNotMatch(documentManagerHtml, /href="\/sets"|href="\/document-import-jobs"|href="\/admin\/data-quality"|href="\/admin\/search-report"/);

  const disposalManagerHtml = await page("폐기 관리", "<p>본문</p>", {
    ...base,
    can_manage_disposals: true
  }).text();
  assert.match(disposalManagerHtml, /href="\/documents\/disposal"[\s\S]*문서 폐기/);
  assert.doesNotMatch(disposalManagerHtml, /href="\/documents\/new"|href="\/documents\/import"/);
});

test("세트 인쇄 헤더에도 회사 로고를 표시한다", async () => {
  const html = await setDetailsPage({
    session: { username: "user", displayName: "사용자", role: "User", csrfToken: "csrf-token" },
    set: { id: 1, name: "감사 문서", description: "" },
    documents: [],
    racks: []
  }).text();

  assert.match(html, new RegExp(`<div class="set-print-brand"><img src="${LOGO_URL}" alt="한림제약"><span>한림문서고</span></div>`));
});
