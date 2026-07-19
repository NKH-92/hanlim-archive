import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { htmlContentSecurityPolicy, withSecurityHeaders } from "../src/security.js";
import { page } from "../src/html.js";
import { sanitizeReturnUrl } from "../src/utils.js";

test("withSecurityHeaders injects base headers and a restrictive fallback CSP", () => {
  const original = new Response("{}", { headers: { "Content-Type": "application/json" } });
  const request = new Request("https://example.com/api/x");
  const wrapped = withSecurityHeaders(original, request);

  assert.equal(wrapped.headers.get("X-Frame-Options"), "DENY");
  assert.equal(wrapped.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(wrapped.headers.get("Referrer-Policy"), "same-origin");
  assert.ok(wrapped.headers.get("Permissions-Policy"));
  assert.equal(wrapped.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
  // HTTPS 요청에는 HSTS가 붙는다.
  assert.match(wrapped.headers.get("Strict-Transport-Security"), /max-age=\d+/);
  // CSP가 없던 응답에는 제한적 폴백 CSP를 붙인다.
  assert.match(wrapped.headers.get("Content-Security-Policy"), /default-src 'none'/);
});

test("withSecurityHeaders omits HSTS on plain http and preserves an existing CSP", () => {
  const original = new Response("<html></html>", {
    headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'" }
  });
  const request = new Request("http://127.0.0.1:8787/login");
  const wrapped = withSecurityHeaders(original, request);

  assert.equal(wrapped.headers.get("Strict-Transport-Security"), null);
  // 이미 CSP가 있으면(HTML nonce CSP) 폴백으로 덮어쓰지 않는다.
  assert.equal(wrapped.headers.get("Content-Security-Policy"), "default-src 'self'");
});

test("htmlContentSecurityPolicy locks scripts to a nonce and denies framing", () => {
  const csp = htmlContentSecurityPolicy("abc123");
  assert.match(csp, /script-src 'self' 'nonce-abc123'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  // 인라인 이벤트 핸들러가 없으므로 script-src에 'unsafe-inline'을 두지 않는다.
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
});

test("page() emits a CSP whose nonce matches every inline script and style tag", async () => {
  const response = page("테스트", "<p>본문</p>", { csrfToken: "x".repeat(40), role: "Admin", username: "a", displayName: "A" });
  const csp = response.headers.get("Content-Security-Policy");
  const html = await response.text();

  const cspNonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
  assert.ok(cspNonce, "CSP should carry a nonce");

  const htmlNonces = [...new Set([...html.matchAll(/nonce="([^"]+)"/g)].map((m) => m[1]))];
  assert.equal(htmlNonces.length, 1, "all inline tags share one nonce");
  assert.equal(htmlNonces[0], cspNonce, "HTML nonce equals CSP nonce");

  // 모든 인라인 script/style에 nonce가 있어야 한다(누락 시 CSP가 해당 태그를 차단).
  assert.equal((html.match(/<script(?![^>]*nonce=)/g) || []).length, 0);
  assert.equal((html.match(/<style(?![^>]*nonce=)/g) || []).length, 0);
  // 외부 CDN 없이 로컬 아이콘 스타일만 사용한다.
  assert.ok(!html.includes("cdn.jsdelivr.net"));
  assert.ok(!html.includes("cdnjs.cloudflare.com"));
  assert.match(html, /href="\/assets\/app\.css"/);
  assert.match(await readFile(new URL("../public/assets/app.css", import.meta.url), "utf8"), /--icon-mask:/);
});

test("sanitizeReturnUrl blocks open-redirect vectors but keeps internal paths", () => {
  assert.equal(sanitizeReturnUrl("/documents?q=pv"), "/documents?q=pv");
  assert.equal(sanitizeReturnUrl("/"), "/");
  // 백슬래시(브라우저가 //evil.com으로 정규화), 프로토콜 상대, 절대 URL, 제어문자는 모두 거부.
  assert.equal(sanitizeReturnUrl("/\\evil.com"), "/");
  assert.equal(sanitizeReturnUrl("//evil.com"), "/");
  assert.equal(sanitizeReturnUrl("https://evil.com"), "/");
  assert.equal(sanitizeReturnUrl("/foo\nbar"), "/");
  assert.equal(sanitizeReturnUrl(""), "/");
});
