import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { escapeHtml } from "../src/utils.js";
import * as clientScriptModule from "../src/views/clientScript.js";

test("전역 클라이언트 스크립트는 LF 정규화 후 현재 golden과 같다", () => {
  const script = clientScriptModule.clientScript();
  const canonicalScript = script.replace(/\r\n?/g, "\n");

  assert.deepEqual(Object.keys(clientScriptModule).sort(), ["clientScript", "searchCoreScript"]);
  assert.equal(canonicalScript.length, 25282);
  assert.equal(Buffer.byteLength(canonicalScript), 26146);
  assert.equal(
    createHash("sha256").update(canonicalScript).digest("hex"),
    "552996689ea8793e71a4a3e7fbc60d76cf799a98786c8cef717b6a31dfd922ed"
  );
  assert.equal((script.match(/DOMContentLoaded/g) || []).length, 1);
  assert.doesNotThrow(() => new Function(script));
});

test("직렬화 소스·초기화 순서·검색 계약은 호환 파사드를 지나도 유지된다", () => {
  const script = clientScriptModule.clientScript();
  const searchCoreTag = clientScriptModule.searchCoreScript();
  assert.equal(searchCoreTag, `<script type="module" src="/assets/search-core.js"></script>`);
  assert.doesNotMatch(script, /window\.__name|createSearchCore\.toString/);
  assert.ok(script.includes(`var escapeHtmlClient = (${escapeHtml.toString()});`));

  const orderedMarkers = [
    "DOMContentLoaded",
    "[data-suggest-input]",
    "[data-bulk-bar]",
    "var currentPath = location.pathname;",
    "var viewerApp = document.querySelector('[data-viewer-app]');",
    "viewer-result-table",
    "fetch('/api/search-index'"
  ];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const markerIndex = script.indexOf(marker);
    assert.ok(markerIndex > previousIndex, `${marker} 실행 순서가 바뀌었습니다.`);
    previousIndex = markerIndex;
  }

  assert.ok(script.includes("'/api/search-suggestions?q=' + encodeURIComponent(q)"));
  assert.ok(script.includes("검색 중…"));
  assert.ok(script.includes("검색 결과가 없습니다."));
  assert.ok(script.includes("viewer-result-row"));
  assert.ok(script.includes("status !== 'all'"));
});
