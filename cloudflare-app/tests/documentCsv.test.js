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
  assert.match(result.body, /documentNumber,revisionNumber/);
  assert.match(result.body, /'=DOC-1/);
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
    documentName: "문서",
    categoryId: 10,
    rackSlotId: 30,
    rackFace: "B",
    note: "",
    tagIds: [20, 21]
  });
  assert.equal(prepared.items[0].status, "disposed");
});
