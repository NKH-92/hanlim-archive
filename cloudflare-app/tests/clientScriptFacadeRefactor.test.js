import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createSearchCore } from "../src/searchCore.js";
import { escapeHtml } from "../src/utils.js";
import * as clientScriptModule from "../src/views/clientScript.js";

test("전역 클라이언트 스크립트는 LF 정규화 후 리팩토링 전 golden과 같다", () => {
  const script = clientScriptModule.clientScript();
  const canonicalScript = script.replace(/\r\n?/g, "\n");

  assert.deepEqual(Object.keys(clientScriptModule).sort(), ["clientScript", "searchCoreScript"]);
  assert.equal(canonicalScript.length, 27865);
  assert.equal(Buffer.byteLength(canonicalScript), 28723);
  assert.equal(
    createHash("sha256").update(canonicalScript).digest("hex"),
    "f7066e4419e2ab125326fe729dd9ae26cf7221c697652f87c780dc9019ab1876"
  );
  assert.equal((script.match(/DOMContentLoaded/g) || []).length, 1);
  assert.doesNotThrow(() => new Function(script));
});

test("직렬화 소스·초기화 순서·검색 계약은 호환 파사드를 지나도 유지된다", () => {
  const script = clientScriptModule.clientScript();
  const searchCoreTag = clientScriptModule.searchCoreScript();
  const searchCoreBody = searchCoreTag.slice("<script>".length, -"</script>".length);

  assert.ok(script.includes("window.__name = window.__name || function (target) { return target; };"));
  assert.ok(script.includes(`var escapeHtmlClient = (${escapeHtml.toString()});`));
  assert.ok(searchCoreBody.includes(`window.SearchCore = window.SearchCore || (${createSearchCore.toString()})();`));
  assert.doesNotThrow(() => new Function(searchCoreBody));

  const orderedMarkers = [
    "DOMContentLoaded",
    "[data-suggest-input]",
    "[data-bulk-bar]",
    "var currentPath = location.pathname;",
    "var viewerApp = document.querySelector('[data-viewer-app]');",
    "core.decideDominantAnswer({",
    "fetch('/api/search-index'"
  ];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const markerIndex = script.indexOf(marker);
    assert.ok(markerIndex > previousIndex, `${marker} 실행 순서가 바뀌었습니다.`);
    previousIndex = markerIndex;
  }

  assert.ok(script.includes("'/api/search-suggestions?q=' + encodeURIComponent(q)"));
  assert.ok(script.includes("'<section class=\"answer-card\" data-answer-card>'"));
  assert.ok(script.includes("'<div class=\"viewer-result-list\">'"));
});
