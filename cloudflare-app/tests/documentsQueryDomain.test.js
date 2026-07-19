import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as documents from "../src/domains/documents/index.js";
import * as documentRulesAdapter from "../src/documentRules.js";
import { prepareDocumentImportRows } from "../src/documentCsv.js";

test("문서 폼 파서는 입력 정규화와 낙관적 잠금 값을 한 경계에서 처리한다", () => {
  const form = new FormData();
  form.set("documentNumber", "  HL-001  ");
  form.set("revisionNumber", " A ");
  form.set("revisionDate", "2026-07-19");
  form.set("disposalDueYear", "2031");
  form.set("documentName", "  시험 기록서 ");
  form.set("categoryId", "4");
  form.set("rackSlotId", "12");
  form.set("rackFace", "2");
  form.set("note", " 메모 ");
  form.append("tagIds", "3");
  form.append("tagIds", "3");
  form.append("tagIds", "0");
  form.set("expectedUpdatedAt", " 2026-07-19T00:00:00.000Z ");
  form.set("expectedRowVersion", "7");

  assert.deepEqual(documents.valuesFromDocumentForm(form), {
    documentNumber: "HL-001", revisionNumber: "A", revisionDate: "2026-07-19",
    disposalDueYear: "2031", documentName: "시험 기록서", categoryId: 4,
    rackSlotId: 12, rackFace: "B", note: "메모", tagIds: [3, 3],
    expectedUpdatedAt: "2026-07-19T00:00:00.000Z", expectedRowVersion: 7,
    updatedAt: "2026-07-19T00:00:00.000Z", rowVersion: 7
  });
});

test("문서 presenter가 snake_case 저장 행을 공개 read model로 한 번만 변환한다", () => {
  const readModel = documents.documentRowToPublicReadModel({
    id: 9, storage_code: "internal-only", document_number: "HL-009", revision_number: "B",
    revision_date: "2026-07-19", disposal_due_year: 2030, document_name: "품질 기록",
    note: null, status: "active", category_name: "품질", zone_number: 1, rack_number: 2,
    rack_face: "A", column_number: 3, shelf_number: 4,
    updated_at: "2026-07-19T00:00:00.000Z", row_version: 2
  });

  assert.equal(readModel.documentNumber, "HL-009");
  assert.equal(readModel.categoryName, "품질");
  assert.equal(Object.hasOwn(readModel, "storageCode"), false);
  assert.equal(Object.hasOwn(readModel, "storage_code"), false);
  assert.equal(Object.isFrozen(readModel), true);
});

test("문서 조회와 폼은 도메인 공개 API에서 제공된다", () => {
  for (const name of [
    "getDocumentPage", "getDocumentCount", "getDocumentsForExport", "getDocument",
    "findDuplicateDocument", "getDocumentTags", "getDisposalLogs", "getDocumentAuditLogs",
    "findDocumentsByNumbers", "loadDocumentFormOptions", "valuesFromDocumentForm", "documentToFormValues"
  ]) assert.equal(typeof documents[name], "function", name);
});

test("문서 infrastructure에는 FormData 처리 코드가 없다", async () => {
  for (const file of ["queries.js", "referenceValidation.js", "rows.js"]) {
    const source = await readFile(new URL(`../src/domains/documents/infrastructure/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bFormData\b|\.formData\s*\(/, file);
  }
});

test("CSV 가져오기와 UI는 동일한 문서 필드 검증 함수를 사용한다", () => {
  assert.equal(typeof documents.validateDocumentInput, "function");
  assert.equal(documentRulesAdapter.validateDocumentTextFields, documents.validateDocumentTextFields);
  assert.equal(documentRulesAdapter.validateDocumentRecordFields, documents.validateDocumentRecordFields);
  assert.equal(typeof prepareDocumentImportRows, "function");
});
