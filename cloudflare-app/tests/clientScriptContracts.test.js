import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml } from "../src/ui/html/escape.js";
import * as clientScriptModule from "../src/views/clientScript.js";
import { TOAST_MESSAGES } from "../src/views/clientScript/navigationFeedback.js";

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
    "fetch('/api/viewer/search?'"
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
  assert.ok(script.includes("data-search-more"));
  assert.ok(script.includes("payload.nextCursor"));
  assert.doesNotMatch(script, /fetch\('\/api\/search-index'/);
});

test("명령 팔레트는 키보드 이동과 포커스 복귀 계약을 유지한다", () => {
  const script = clientScriptModule.clientScript();

  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]) {
    assert.match(script, new RegExp(`event\\.key === '${key}'`));
  }
  assert.match(script, /commandPreviousFocus = document\.activeElement/);
  assert.match(script, /commandPreviousFocus\.focus\(\)/);
  assert.match(script, /scrollIntoView\(\{ block: 'nearest' \}\)/);
});

test("문서 작업 공간은 검색 단축키·행 탐색·열 설정·선택 폼을 연결한다", () => {
  const script = clientScriptModule.clientScript();

  assert.match(script, /event\.key === '\/'/);
  assert.match(script, /event\.key === 'ArrowDown'/);
  assert.match(script, /event\.key === 'ArrowUp'/);
  assert.match(script, /data-document-preview/);
  assert.match(script, /\(min-width: 1180px\)/);
  assert.doesNotMatch(script, /\(min-width: 1181px\)/);
  assert.match(script, /hanlimDocumentColumns/);
  assert.match(script, /data-set-selection-form/);
  assert.match(script, /data-disposal-limit/);
});

test("라우트가 생산하는 전역 토스트 키는 모두 표시 문구를 가진다", () => {
  const producedKeys = [
    "approved",
    "bulk-disposed",
    "created",
    "deleted",
    "disabled",
    "disposed",
    "document-created",
    "enabled",
    "moved",
    "password-changed",
    "password-reset",
    "permissions-saved",
    "rejected",
    "restored",
    "revised",
    "saved",
    "set-locked",
    "set-unlocked",
    "updated"
  ];

  for (const key of producedKeys) {
    assert.equal(typeof TOAST_MESSAGES[key], "string", `${key} 토스트 문구가 필요합니다.`);
    assert.ok(TOAST_MESSAGES[key].length > 0);
  }
});

test("브라우저 CSV helper는 공백·제어문자 뒤 수식 접두어도 실제로 중화한다", () => {
  const script = clientScriptModule.clientScript();
  const patternMatch = script.match(/var excelCsvFormulaPrefix = new RegExp\(("(?:\\.|[^"\\])*")\);/);
  const helperMatch = script.match(/function excelCsvCell\(value\) \{([\s\S]*?)\n      \}\n\n      document\.querySelectorAll\('\[data-snapshot-errors-csv\]'/);
  assert.ok(patternMatch);
  assert.ok(helperMatch);

  const excelCsvFormulaPrefix = new RegExp(JSON.parse(patternMatch[1]));
  const excelCsvCell = new Function(
    "excelCsvFormulaPrefix",
    `return function excelCsvCell(value) {${helperMatch[1]}\n}`
  )(excelCsvFormulaPrefix);

  assert.equal(excelCsvCell("\t=SUM(A1:A2)"), `"'\t=SUM(A1:A2)"`);
  assert.equal(excelCsvCell("\u00A0+1"), `"'\u00A0+1"`);
  assert.equal(excelCsvCell("\u0000@cmd"), `"'\u0000@cmd"`);
  assert.equal(excelCsvCell("일반 값"), `"일반 값"`);
});
