import assert from "node:assert/strict";
import test from "node:test";

import { collectDocumentFieldErrors } from "../src/documentRules.js";

test("등록 화면 검증은 누락된 필드와 잘못된 형식을 한 번에 반환한다", () => {
  const errors = collectDocumentFieldErrors({
    documentNumber: "",
    revisionNumber: "",
    documentName: "",
    revisionDate: "2026-02-30",
    disposalDueYear: "20.5",
    categoryId: 0,
    rackSlotId: 0,
    rackFace: ""
  });

  assert.deepEqual(Object.keys(errors), [
    "documentNumber",
    "revisionNumber",
    "documentName",
    "revisionDate",
    "disposalDueYear",
    "categoryId",
    "rackSlotId",
    "rackFace"
  ]);
  assert.match(errors.revisionDate, /유효한 날짜/);
  assert.match(errors.disposalDueYear, /정수/);
});
