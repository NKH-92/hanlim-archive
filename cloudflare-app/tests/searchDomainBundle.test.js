import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as search from "../src/domains/search/index.js";
import { searchCoreScript } from "../src/views/clientScript.js";

test("검색 repository/service/presenter 공개 API는 도메인에서 제공된다", () => {
  for (const name of [
    "searchDocuments", "searchDocumentsWithSuggestions", "getSearchIndexMeta",
    "getSearchIndexDocuments", "getSearchSuggestions", "recordSearchClick",
    "recordSearchLog", "getSearchReport", "documentToViewerItem", "buildViewerFacets"
  ]) assert.equal(typeof search[name], "function", name);
});

test("검색 browser bootstrap에는 source serialization과 __name shim이 없다", async () => {
  const client = await readFile(new URL("../src/views/clientScript.js", import.meta.url), "utf8");
  const bootstrap = await readFile(new URL("../src/views/clientScript/bootstrap.js", import.meta.url), "utf8");
  assert.doesNotMatch(client, /createSearchCore\.toString|window\.__name/);
  assert.doesNotMatch(bootstrap, /window\.__name/);
  assert.equal(searchCoreScript(), `<script type="module" src="/assets/search-core.js"></script>`);
});

test("확장 검색 parity 표본은 서버와 browser ESM에서 동일하다", async () => {
  const browser = await import("../public/assets/search-core.js");
  const rows = [
    { document_number: "PV-2026-014", revision_number: "Rev.1", document_name: "밸리데이션 보고서", category_name: "PV", tag_names: "중요문서", note: "", rack_face: "A" },
    { document_number: "QMS-100", revision_number: "A", document_name: "품질 매뉴얼", category_name: "QMS", tag_names: "", note: "", rack_face: "B" }
  ];
  for (const query of ["PV 2026 014", "qwerty", "ㅂㄹㄷㅇㅅ", "품질 매뉴얼"]) {
    assert.deepEqual(
      rows.map((row) => search.sharedSearchCore.scoreDocumentMatch(row, query)),
      rows.map((row) => browser.sharedSearchCore.scoreDocumentMatch(row, query)),
      query
    );
  }
});
