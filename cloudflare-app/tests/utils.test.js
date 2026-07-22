import assert from "node:assert/strict";
import test from "node:test";

import { locationLabel, normalizeRackFace, rackFaceLabel } from "../src/domains/racks/index.js";
import { isValidCsrfToken } from "../src/platform/security/csrf.js";
import { isTrustedPostOrigin } from "../src/platform/security/origin.js";
import { parseCsv } from "../src/shared/csv/parser.js";
import { csvEscape } from "../src/shared/csv/writer.js";

test("rackFaceLabel follows the physical naming: single 13, double 13-1/13-2", () => {
  assert.equal(rackFaceLabel({ rack_number: 13, rack_face: "A", is_single_sided: 0 }), "13-1");
  assert.equal(rackFaceLabel({ rack_number: 13, rack_face: "B", is_single_sided: 0 }), "13-2");
  assert.equal(rackFaceLabel({ rack_number: 13, rack_face: "A", is_single_sided: 1 }), "13");
  assert.equal(rackFaceLabel({ rack_face: "A" }), "", "랙 번호가 없으면 빈 문자열");
});

test("locationLabel folds the face into the rack designation", () => {
  assert.equal(
    locationLabel({ zone_number: 1, rack_number: 13, is_single_sided: 0, rack_face: "B", column_number: 3, shelf_number: 2 }),
    "1구역 / 13-2번 랙 / 3열 / 2선반"
  );
  assert.equal(
    locationLabel({ zone_number: 2, rack_number: 9, is_single_sided: 1, rack_face: "A", column_number: 7, shelf_number: 6 }),
    "2구역 / 9번 랙 / 7열 / 6선반"
  );
});

test("normalizeRackFace accepts physical numbering and legacy A/B", () => {
  assert.equal(normalizeRackFace("1"), "A");
  assert.equal(normalizeRackFace("2"), "B");
  assert.equal(normalizeRackFace("a"), "A");
  assert.equal(normalizeRackFace("B"), "B");
  assert.equal(normalizeRackFace("3"), "3", "매핑 불가 값은 검증에서 걸리도록 그대로 반환");
});

test("csvEscape neutralizes Excel formulas", () => {
  assert.equal(csvEscape("=1+1"), "'=1+1");
  assert.equal(csvEscape("+1"), "'+1");
  assert.equal(csvEscape("-1"), "'-1");
  assert.equal(csvEscape("@SUM(1,2)"), '"\'@SUM(1,2)"');
  assert.equal(csvEscape(" \t=1+1"), "' \t=1+1");
  assert.equal(csvEscape("\u00a0+1"), "'\u00a0+1");
  assert.equal(csvEscape("\u0000@SUM(1,2)"), '"\'\u0000@SUM(1,2)"');
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
