import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRevisionLabel,
  normalizeImportedRevision,
  revisionForExcel
} from "../src/shared/documents/revision.js";
import { documentToViewerItem } from "../src/domains/search/infrastructure/repository.js";

test("개정번호 표시 계약은 NULL·N/A와 숫자 개정을 구분한다", () => {
  assert.equal(formatRevisionLabel(null), "N/A");
  assert.equal(formatRevisionLabel("N/A"), "N/A");
  assert.equal(formatRevisionLabel("3"), "Rev.3");
  assert.equal(formatRevisionLabel("Rev.3"), "Rev.3");
  assert.equal(normalizeImportedRevision(""), null);
  assert.equal(normalizeImportedRevision("N/A"), null);
  assert.equal(normalizeImportedRevision("3"), "Rev.3");
  assert.equal(revisionForExcel(null), "N/A");
  assert.equal(revisionForExcel("Rev.3"), "3");
});

test("검색 공개 모델은 공란 개정을 N/A label로 제공한다", () => {
  const item = documentToViewerItem({ id: 1, document_number: "BINDER-1", revision_number: null, status: "active" });
  assert.equal(item.revisionNumber, "");
  assert.equal(item.revisionLabel, "N/A");
});
