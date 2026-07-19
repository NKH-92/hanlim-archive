import assert from "node:assert/strict";
import test from "node:test";

import { secureHtmlDocument } from "../src/platform/web/htmlSecurity.js";

test("security rendering preserves raw script and style contents", () => {
  const source = `<script>const template = '<form method="post"><style>raw</style></form>';</script>
    <form method="post" action="/save"><button>save</button></form>`;
  const secured = secureHtmlDocument(source, { nonce: "nonce-value", csrfToken: "csrf-value" });

  assert.match(secured, /const template = '<form method="post"><style>raw<\/style><\/form>';/);
  assert.equal((secured.match(/name="csrf_token"/g) || []).length, 1);
  assert.equal((secured.match(/nonce="nonce-value"/g) || []).length, 1);
});
