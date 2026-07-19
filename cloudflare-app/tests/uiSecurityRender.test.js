import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { secureHtmlDocument, scanHtmlOpeningTags } from "../src/platform/web/htmlSecurity.js";
import { safeEmbeddedJson } from "../src/platform/web/renderContext.js";
import { documentFormPage } from "../src/html.js";

test("HTML tokenizer는 모든 POST form에 정확히 한 CSRF token을 넣는다", async () => {
  const response = documentFormPage({
    session: { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "c".repeat(40) },
    title: "문서 등록", action: "/documents", values: {}, categories: [], tags: [], slots: []
  });
  const tags = scanHtmlOpeningTags(await response.text());
  const postForms = tags.filter((tag) => tag.name === "form" && tag.attributes.method?.toLowerCase() === "post");
  const csrfInputs = tags.filter((tag) => tag.name === "input" && tag.attributes.name === "csrf_token");
  assert.ok(postForms.length > 1);
  assert.equal(csrfInputs.length, postForms.length);
  assert.ok(csrfInputs.every((tag) => tag.attributes.value === "c".repeat(40)));
});

test("HTML tokenizer는 인용부호와 > 문자가 있는 속성을 건너뛰고 실행 태그에 nonce를 적용한다", () => {
  const secured = secureHtmlDocument(
    `<form method='post' data-note="a > b"><button>저장</button></form><script data-x="1 > 0">run()</script><style>.x{}</style>`,
    { nonce: "nonce-value", csrfToken: "csrf-value" }
  );
  const tags = scanHtmlOpeningTags(secured);
  assert.equal(tags.find((tag) => tag.name === "form").attributes["data-note"], "a > b");
  assert.equal(tags.find((tag) => tag.name === "script").attributes.nonce, "nonce-value");
  assert.equal(tags.find((tag) => tag.name === "style").attributes.nonce, "nonce-value");
  assert.equal(tags.filter((tag) => tag.attributes.name === "csrf_token").length, 1);
});

test("embedded JSON helper는 script 종료와 Unicode separator를 안전하게 직렬화한다", () => {
  const json = safeEmbeddedJson({ value: "</script>\u2028\u2029" });
  assert.doesNotMatch(json, /<\/script>|\u2028|\u2029/u);
  assert.match(json, /\\u003c\/script>/);
});

test("전역 CSS와 JS는 source에서 생성된 정적 asset이다", async () => {
  const [css, js] = await Promise.all([
    readFile(new URL("../public/assets/app.css", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/app.js", import.meta.url), "utf8")
  ]);
  assert.match(css, /^\/\* generated from src\/views\/styles\.js/);
  assert.match(js, /^\/\/ generated from src\/views\/clientScript\.js/);
  assert.match(css, /@media print/);
  assert.match(js, /keydown/);
});
