import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";

import { documentFormPage } from "../src/html.js";
import worker from "../src/index.js";
import { createSearchCore } from "../src/searchCore.js";
import { escapeHtml } from "../src/utils.js";

test("createSearchCore.toString()은 fresh realm에서 외부 모듈 없이 실행된다", () => {
  const context = vm.createContext(Object.create(null));
  const core = vm.runInContext(`(${createSearchCore.toString()})()`, context, {
    filename: "serialized-search-core.js"
  });
  const document = vm.runInContext(`({
    id: 7,
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    tag_names: "중요문서",
    note: "",
    zone_number: 1,
    rack_number: 13,
    is_single_sided: 0,
    column_number: 2,
    shelf_number: 3,
    rack_face: "B",
    updated_at: "2026-07-17"
  })`, context);

  assert.equal(core.rackFaceLabel(document), "13-2");
  assert.equal(core.documentLocationText(document), "1구역 13-2번 랙 2열 3선반");
  assert.ok(core.scoreDocumentMatch(document, "PV 밸리데이션").relevance_score > 0);
  assert.equal(core.highlightHtml("<PV-2026>", "PV", (value) => core.clean(value)), "<<mark>PV</mark>-2026>");
});

test("escapeHtml.toString()은 fresh realm에서 자기완결적으로 실행된다", () => {
  const context = vm.createContext(Object.create(null));
  const serializedEscapeHtml = vm.runInContext(`(${escapeHtml.toString()})`, context, {
    filename: "serialized-escape-html.js"
  });

  assert.equal(serializedEscapeHtml(`<script data-x="'">&`), "&lt;script data-x=&quot;&#039;&quot;&gt;&amp;");
  assert.equal(serializedEscapeHtml(null), "");
});

test("실제 로그인·문서 등록 페이지의 모든 inline script/style은 응답별 CSP nonce를 사용한다", async () => {
  const loginResponse = await worker.fetch(new Request("https://archive.example.com/login"), {
    SESSION_SECRET: "test-session-secret-with-at-least-32-characters"
  });
  const documentResponse = documentFormPage({
    session: {
      username: "admin",
      displayName: "관리자",
      role: "Admin",
      csrfToken: "csrf-token-with-at-least-32-characters"
    },
    title: "문서 등록",
    action: "/documents",
    values: {},
    categories: [{ id: 1, name: "PV" }],
    tags: [{ id: 2, name: "중요문서" }],
    slots: [{
      id: 3,
      zone_number: 1,
      rack_number: 13,
      column_number: 2,
      shelf_number: 3,
      is_single_sided: 0
    }]
  });

  const login = await nonceContract(loginResponse, "로그인");
  const document = await nonceContract(documentResponse, "문서 등록");

  assert.notEqual(login.nonce, document.nonce, "각 응답은 독립 nonce를 생성해야 한다");
  assert.ok(document.scriptCount > login.scriptCount, "문서 폼의 위치 선택 스크립트도 nonce 보호를 받아야 한다");
  assert.match(document.html, /<form method="post" action="\/documents"/);
  assert.match(document.html, /<input type="hidden" name="csrf_token"/);
});

async function nonceContract(response, label) {
  assert.equal(response.status, 200, `${label} status`);
  assert.match(response.headers.get("Content-Type"), /^text\/html;/, `${label} content type`);
  const csp = response.headers.get("Content-Security-Policy") || "";
  const nonce = csp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, `${label} CSP nonce`);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, `${label} script CSP`);

  const html = await response.text();
  const tags = [...html.matchAll(/<(script|style)\b[^>]*>/gi)];
  assert.ok(tags.length >= 2, `${label} inline tags`);
  for (const tag of tags) {
    const nonces = [...tag[0].matchAll(/\bnonce="([^"]+)"/gi)].map((match) => match[1]);
    assert.deepEqual(nonces, [nonce], `${label} ${tag[1]} nonce: ${tag[0].slice(0, 100)}`);
  }

  return {
    html,
    nonce,
    scriptCount: tags.filter((tag) => tag[1].toLowerCase() === "script").length
  };
}
