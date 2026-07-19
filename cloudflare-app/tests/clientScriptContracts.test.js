import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml } from "../src/ui/html/escape.js";
import * as clientScriptModule from "../src/views/clientScript.js";

test("전역 클라이언트 스크립트는 한 번 초기화되고 문법적으로 실행 가능하다", () => {
  const script = clientScriptModule.clientScript();

  assert.deepEqual(Object.keys(clientScriptModule).sort(), ["clientScript", "searchCoreScript"]);
  assert.equal((script.match(/DOMContentLoaded/g) || []).length, 1);
  assert.doesNotThrow(() => new Function(script));
});

test("정적 client 조립은 직렬화 소스·초기화 순서·검색 계약을 유지한다", () => {
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
