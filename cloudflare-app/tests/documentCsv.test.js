import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDocumentCsv,
  prepareDocumentImportRows,
  readDocumentImportRows
} from "../src/documentCsv.js";

test("buildDocumentCsv creates deterministic filename and safe cells", () => {
  const result = buildDocumentCsv([{
    document_number: "=DOC-1",
    revision_number: "Rev.0",
    revision_date: "2026-04-14",
    disposal_due_year: 2031,
    document_name: "문서",
    category_name: "PV",
    rack_code: "1-01",
    column_number: 1,
    shelf_number: 2,
    rack_face: "A",
    tag_names: "중요",
    note: "비고",
    status: "active"
  }], new Date("2026-04-14T00:00:00Z"));

  assert.equal(result.filename, "hanlim-archive-documents-2026-04-14.csv");
  assert.match(result.body, /^\uFEFF문서명,문서번호,개정번호,제\/개정일,폐기 예정 년도,보관위치\r\n/);
  assert.match(result.body, /'=DOC-1/);
  // 면은 실물 표기(1/2)로 내보낸다: rackCode,rackColumn,shelfNumber,rackFace 순.
  assert.match(result.body, /2026-04-14,2031,/);
  assert.match(result.body, /1-01 \/ 1.* \/ 2/);
});

test("readDocumentImportRows enforces configured row and byte limits", async () => {
  const form = new FormData();
  form.set("csvText", "documentNumber,revisionNumber,documentName,category,rackCode,rackColumn,shelfNumber,rackFace\nA,Rev.0,Doc,PV,1-01,1,1,A\nB,Rev.0,Doc,PV,1-01,1,1,A");

  const result = await readDocumentImportRows(form, { maxBytes: 4096, maxRows: 1 });

  assert.equal(result.ok, false);
  assert.match(result.error, /1건/);
});

test("prepareDocumentImportRows maps category, tags, slot, and disposed status", () => {
  const prepared = prepareDocumentImportRows([{
    documentNumber: "DOC-1",
    revisionNumber: "Rev.0",
    revisionDate: "",
    disposalDueYear: "",
    documentName: "문서",
    category: "PV",
    rackCode: "1-01",
    rackColumn: "1",
    shelfNumber: "2",
    rackFace: "B",
    tags: "중요; 원본",
    status: "폐기"
  }], {
    categories: [{ id: 10, name: "PV" }],
    tags: [{ id: 20, name: "중요" }, { id: 21, name: "원본" }],
    slots: [{
      id: 30,
      code: "1-01",
      slot_code: "1-2",
      column_number: 1,
      shelf_number: 2,
      is_single_sided: 0
    }]
  });

  assert.deepEqual(prepared.errors, []);
  assert.deepEqual(prepared.items[0].values, {
    documentNumber: "DOC-1",
    revisionNumber: "Rev.0",
    revisionDate: "",
    disposalDueYear: "",
    documentName: "문서",
    categoryId: 10,
    rackSlotId: 30,
    rackFace: "B",
    note: "",
    tagIds: [20, 21]
  });
  assert.equal(prepared.items[0].status, "disposed");
});

test("prepareDocumentImportRows accepts numeric faces and blocks face 2 on single-sided racks", () => {
  const context = {
    categories: [{ id: 10, name: "PV" }],
    tags: [],
    slots: [
      { id: 30, code: "1-01", slot_code: "1-2", column_number: 1, shelf_number: 2, is_single_sided: 0 },
      { id: 31, code: "2-09", slot_code: "1-2", column_number: 1, shelf_number: 2, is_single_sided: 1 }
    ]
  };
  const base = { revisionNumber: "Rev.0", documentName: "문서", category: "PV", rackColumn: "1", shelfNumber: "2" };

  const numeric = prepareDocumentImportRows([
    { ...base, documentNumber: "DOC-2", rackCode: "1-01", rackFace: "2" }
  ], context);
  assert.deepEqual(numeric.errors, []);
  assert.equal(numeric.items[0].values.rackFace, "B", "실물 표기 2는 저장값 B로 매핑된다");

  const singleSided = prepareDocumentImportRows([
    { ...base, documentNumber: "DOC-3", rackCode: "2-09", rackFace: "2" }
  ], context);
  assert.equal(singleSided.errors.length, 1);
  assert.match(singleSided.errors[0], /단면 랙/);

  const invalid = prepareDocumentImportRows([
    { ...base, documentNumber: "DOC-4", rackCode: "1-01", rackFace: "3" }
  ], context);
  assert.equal(invalid.errors.length, 1);
  assert.match(invalid.errors[0], /1 또는 2/);
});

test("prepareDocumentImportRows enforces the same document text limits as the form", () => {
  const context = {
    categories: [{ id: 10, name: "PV" }],
    tags: [],
    slots: [{
      id: 30,
      code: "1-01",
      slot_code: "1-1",
      column_number: 1,
      shelf_number: 1,
      is_single_sided: 0
    }]
  };
  const base = {
    revisionNumber: "Rev.0",
    documentName: "문서",
    category: "PV",
    rackCode: "1-01",
    rackColumn: "1",
    shelfNumber: "1",
    rackFace: "1"
  };

  const prepared = prepareDocumentImportRows([
    { ...base, documentNumber: "D".repeat(101) },
    { ...base, documentNumber: "DOC-2", note: "N".repeat(2001) }
  ], context);

  assert.equal(prepared.errors.length, 2);
  assert.match(prepared.errors[0], /^2행: 문서번호는 100자 이하/);
  assert.match(prepared.errors[1], /^3행: 비고는 2000자 이하/);
});
