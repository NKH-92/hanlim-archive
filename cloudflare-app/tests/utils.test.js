import assert from "node:assert/strict";
import test from "node:test";

import { csvEscape, isTrustedPostOrigin, isValidCsrfToken, parseCsv } from "../src/utils.js";

test("csvEscape neutralizes Excel formulas", () => {
  assert.equal(csvEscape("=1+1"), "'=1+1");
  assert.equal(csvEscape("+1"), "'+1");
  assert.equal(csvEscape("-1"), "'-1");
  assert.equal(csvEscape("@SUM(1,2)"), '"\'@SUM(1,2)"');
});

test("csvEscape still quotes normal CSV delimiters", () => {
  assert.equal(csvEscape("normal,text"), '"normal,text"');
  assert.equal(csvEscape('a"b'), '"a""b"');
});

test("parseCsv parses basic rows and rejects unclosed quotes", () => {
  assert.deepEqual(parseCsv("a,b\n1,2"), [{ a: "1", b: "2" }]);
  assert.throws(() => parseCsv('a,b\n"1,2'), /닫히지/);
});

test("isTrustedPostOrigin rejects cross-site posts", () => {
  assert.equal(isTrustedPostOrigin(new Request("https://archive.example.com/documents", {
    method: "POST",
    headers: {
      Origin: "https://archive.example.com"
    }
  })), true);

  assert.equal(isTrustedPostOrigin(new Request("https://archive.example.com/documents", {
    method: "POST",
    headers: {
      Origin: "https://evil.example"
    }
  })), false);

  assert.equal(isTrustedPostOrigin(new Request("https://archive.example.com/documents", {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "cross-site"
    }
  })), false);

  assert.equal(isTrustedPostOrigin(new Request("https://archive.example.com/documents", {
    method: "POST"
  })), false);
});

test("isValidCsrfToken accepts only the current session token", async () => {
  const session = { csrfToken: "csrf-token-123" };
  const goodRequest = new Request("https://archive.example.com/documents", {
    method: "POST",
    body: new URLSearchParams({ csrf_token: "csrf-token-123" })
  });
  const badRequest = new Request("https://archive.example.com/documents", {
    method: "POST",
    body: new URLSearchParams({ csrf_token: "wrong-token" })
  });

  assert.equal(await isValidCsrfToken(goodRequest, session), true);
  assert.equal(await isValidCsrfToken(badRequest, session), false);
});
