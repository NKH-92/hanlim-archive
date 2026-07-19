import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createSearchCore } from "../src/searchCore.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/search-golden.json", import.meta.url), "utf8"));
const core = createSearchCore();

test("Phase 0 search golden은 점수·이유·정렬을 그대로 유지한다", () => {
  for (const fixtureCase of fixture.cases) {
    const actual = fixture.documents
      .map((document) => ({
        ...document,
        ...core.scoreDocumentMatch(document, fixtureCase.query)
      }))
      .filter((document) => document.relevance_score > 0)
      .sort((left, right) => core.compareSearchResults(left, right, fixture.sort, true))
      .map((document) => ({
        id: document.id,
        score: document.relevance_score,
        reason: document.match_reason
      }));

    assert.deepEqual(actual, fixtureCase.expected, fixtureCase.name);
  }
});

test("Phase 0 search golden은 자연어 필터 분해 계약을 유지한다", () => {
  const { query, context, expected } = fixture.parseCase;
  const actual = core.parseSearchQuery(query, context);

  assert.equal(actual.text, expected.text);
  assert.deepEqual(actual.filters, expected.filters);
  assert.deepEqual(actual.chips.map((chip) => chip.type), expected.chipTypes);
});
