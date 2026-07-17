import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { createSearchCore } from "../src/searchCore.js";
import { clientScript, searchCoreScript } from "../src/views/clientScript.js";
import { dashboardPage } from "../src/views/searchViews.js";

const SESSION = {
  username: "viewer",
  displayName: "조회자",
  role: "User",
  csrfToken: "csrf-token"
};

function serverItem(overrides = {}) {
  return {
    id: 7,
    documentNumber: "PV-2026-014",
    revisionNumber: "Rev.1",
    revisionDate: "2026-04-14",
    disposalDueYear: 2031,
    documentName: "충전 공정 밸리데이션 보고서",
    categoryName: "PV",
    status: "active",
    location: {
      label: "1구역 / 1-1번 랙 / 2열 / 3선반",
      zoneNumber: 1,
      rackCode: "1-01",
      rackLabel: "1-1",
      columnNumber: 2,
      shelfNumber: 3
    },
    relevanceScore: 500,
    ...overrides
  };
}

function browserItem(overrides = {}) {
  return {
    id: 7,
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    revision_date: "2026-04-14",
    disposal_due_year: 2031,
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    tag_names: "밸리데이션",
    status: "active",
    zone_number: 1,
    rack_code: "1-01",
    rack_number: 1,
    rack_face: "A",
    is_single_sided: 0,
    column_number: 2,
    shelf_number: 3,
    updated_at: "2026-07-17",
    popularity: 0,
    ...overrides
  };
}

function answerHead(html) {
  return html.match(/<div class="answer-head">[\s\S]*?<\/div>/)?.[0] || "";
}

function serverResultsBody(html) {
  const start = html.indexOf("<div data-results-body>");
  const end = html.indexOf("\n        </div>\n      </article>", start);
  return start >= 0 && end >= 0 ? html.slice(start, end) : "";
}

async function renderServer(items, query, totalItems = items.length) {
  const response = dashboardPage({
    session: SESSION,
    query,
    viewerSearch: {
      items,
      pagination: { page: 1, pageSize: 12, totalItems, totalPages: 1 },
      suggestions: []
    },
    categories: [],
    tags: [],
    filters: { sort: "relevance" }
  });
  return response.text();
}

async function renderBrowser(documents, query) {
  const listeners = {};
  const inputListeners = {};
  const input = {
    value: query,
    addEventListener(type, handler) {
      inputListeners[type] = handler;
    }
  };
  const resultsBody = { innerHTML: "" };
  const resultsTitle = { textContent: "" };
  const resultsCount = { textContent: "" };
  const viewerApp = {
    hidden: false,
    classList: { contains() { return false; } }
  };
  const viewerForm = {
    querySelector(selector) {
      if (selector === 'input[name="q"]') return input;
      if (selector === 'select[name="status"]') return { value: "active" };
      if (selector === 'select[name="sort"]') return { value: "relevance" };
      if (selector.startsWith('select[name="')) return { value: "" };
      return null;
    }
  };
  const selectors = new Map([
    ["[data-viewer-app]", viewerApp],
    ["[data-viewer-form]", viewerForm],
    ["[data-viewer-context]", { textContent: "{}" }],
    ["[data-results-body]", resultsBody],
    ["[data-results-title]", resultsTitle],
    ["[data-results-count]", resultsCount]
  ]);
  const document = {
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    querySelector(selector) {
      return selectors.get(selector) || null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const sandbox = {
    clearTimeout() {},
    console,
    document,
    fetch: async () => ({ ok: true, json: async () => ({ documents }) }),
    location: { href: "https://archive.example.com/app", pathname: "/app", search: "" },
    navigator: {},
    setTimeout(handler) {
      handler();
      return 1;
    },
    URL,
    URLSearchParams
  };
  sandbox.window = sandbox;

  const context = vm.createContext(sandbox);
  const coreSource = searchCoreScript().replace(/^<script>|<\/script>$/g, "");
  vm.runInContext(coreSource, context);
  vm.runInContext(clientScript(), context);
  listeners.DOMContentLoaded();
  await new Promise((resolve) => setImmediate(resolve));

  return {
    html: resultsBody.innerHTML,
    title: resultsTitle.textContent,
    count: resultsCount.textContent,
    core: sandbox.SearchCore
  };
}

test("server and browser keep the exact-code answer grade and key markup", async () => {
  const query = "PV-2026-014";
  const serverHtml = serverResultsBody(await renderServer([serverItem()], query));
  const browser = await renderBrowser([browserItem()], query);

  const expectedHead = '<div class="answer-head"><small class="answer-label">가장 정확한 결과</small><span class="answer-grade certain">확실</span></div>';
  assert.equal(answerHead(serverHtml), expectedHead);
  assert.equal(answerHead(browser.html), expectedHead);
  assert.match(serverHtml, /<section class="answer-card" data-answer-card>/);
  assert.match(browser.html, /^<section class="answer-card" data-answer-card>/);
  assert.match(serverHtml, /href="\/documents\/7" data-doc-click="7">충전 공정 밸리데이션 보고서<\/a>/);
  assert.match(browser.html, /href="\/documents\/7" data-doc-click="7">충전 공정 밸리데이션 보고서<\/a>/);
  const expectedNumber = '<span class="mono"><mark>PV</mark>-<mark>2026</mark>-<mark>014</mark></span>';
  assert.match(serverHtml, new RegExp(expectedNumber));
  assert.match(browser.html, new RegExp(expectedNumber));
  assert.equal(browser.title, `"${query}" 검색 결과`);
  assert.equal(browser.count, "1건");
});

test("server and browser keep likely dominance and ambiguous-list behavior", async () => {
  const query = "밸리데이션";
  const dominantServer = [
    serverItem({ relevanceScore: 300 }),
    serverItem({ id: 8, documentNumber: "PV-2026-015", relevanceScore: 200 })
  ];
  const dominantBrowser = [
    browserItem({ document_name: "밸리데이션", tag_names: "", popularity: 20 }),
    browserItem({ id: 8, document_number: "PV-2026-015", document_name: "설비 밸리데이션 보고서", tag_names: "" })
  ];
  const serverHtml = serverResultsBody(await renderServer(dominantServer, query, 2));
  const browser = await renderBrowser(dominantBrowser, query);
  const expectedHead = '<div class="answer-head"><small class="answer-label">가장 정확한 결과</small><span class="answer-grade likely">유력 · 확인 권장</span></div>';

  assert.equal(answerHead(serverHtml), expectedHead);
  assert.equal(answerHead(browser.html), expectedHead);
  assert.match(serverHtml, /<p class="rest-label">다른 결과 1건<\/p>/);
  assert.match(browser.html, /<p class="rest-label">다른 결과 1건<\/p>/);

  const ambiguousServer = serverResultsBody(await renderServer([
    serverItem({ relevanceScore: 299 }),
    serverItem({ id: 8, documentNumber: "PV-2026-015", relevanceScore: 200 })
  ], query, 2));
  assert.doesNotMatch(ambiguousServer, /data-answer-card/);

  const core = createSearchCore();
  const first = { ...browserItem(), ...core.scoreDocumentMatch(browserItem(), query) };
  const second = { ...browserItem({ id: 8, document_number: "PV-2026-015" }), ...core.scoreDocumentMatch(browserItem({ id: 8, document_number: "PV-2026-015" }), query) };
  first.relevance_score = second.relevance_score;
  const ambiguousBrowser = await renderBrowser([first, second], query);
  assert.doesNotMatch(ambiguousBrowser.html, /data-answer-card/);
  assert.match(ambiguousBrowser.html, /^<div class="viewer-result-list">/);
});

test("serialized search core remains self-contained and executable", () => {
  const sandbox = { window: { __name: (target) => target } };
  const core = vm.runInNewContext(`(${createSearchCore.toString()})()`, sandbox);

  assert.equal(core.compactSearchText(" PV-2026 / 014 "), "pv2026014");
  assert.equal(core.rackFaceLabel(browserItem()), "1-1");
  assert.equal(core.decideDominantAnswer({
    query: "PV-2026-014",
    documentNumber: "PV-2026-014",
    firstScore: 500,
    resultCount: 2
  }).grade, "certain");
  assert.match(searchCoreScript(), /^<script>window\.__name = window\.__name \|\| function/);
});

test("dominant-answer policy keeps exact, single, threshold, and ambiguous boundaries", () => {
  const core = createSearchCore();

  assert.deepEqual(core.decideDominantAnswer({
    query: "PV-2026-014",
    documentNumber: "PV 2026/014",
    firstScore: 1,
    secondScore: 999,
    resultCount: 2
  }), { show: true, grade: "certain" });
  assert.deepEqual(core.decideDominantAnswer({
    query: "밸리데이션",
    documentNumber: "PV-2026-014",
    firstScore: 1,
    resultCount: 1
  }), { show: true, grade: "likely" });
  assert.deepEqual(core.decideDominantAnswer({
    query: "밸리데이션",
    documentNumber: "PV-2026-014",
    firstScore: 300,
    secondScore: 200,
    resultCount: 2
  }), { show: true, grade: "likely" });
  assert.deepEqual(core.decideDominantAnswer({
    query: "밸리데이션",
    documentNumber: "PV-2026-014",
    firstScore: 299,
    secondScore: 200,
    resultCount: 2
  }), { show: false, grade: "likely" });
  assert.deepEqual(core.decideDominantAnswer({
    query: "PV-2026-014",
    documentNumber: "PV-2026-014",
    firstScore: 0,
    resultCount: 1
  }), { show: false, grade: "certain" });
});
