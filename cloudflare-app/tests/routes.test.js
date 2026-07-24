import assert from "node:assert/strict";
import test from "node:test";

import {
  matchAdminUserRoute,
  matchDisposalBatchRoute,
  matchDocumentImportJobRoute,
  matchDocumentSnapshotRoute,
  matchDocumentRoute,
  matchMasterRoute,
  matchRackRoute,
  matchSetRoute
} from "../src/routes.js";

test("matchDocumentRoute resolves document detail and action routes", () => {
  assert.deepEqual(matchDocumentRoute("/documents/42"), { id: 42, action: "details" });
  assert.deepEqual(matchDocumentRoute("/documents/42/edit"), { id: 42, action: "edit" });
  assert.equal(matchDocumentRoute("/documents/new"), null);
});

test("matchRackRoute resolves rack detail and action routes", () => {
  assert.deepEqual(matchRackRoute("/racks/7"), { id: 7, action: "details" });
  assert.deepEqual(matchRackRoute("/racks/7/edit"), { id: 7, action: "edit" });
  assert.equal(matchRackRoute("/racks/configure"), null);
});

test("matchSetRoute resolves set detail and action routes", () => {
  assert.deepEqual(matchSetRoute("/sets/3"), { id: 3, action: "details" });
  assert.deepEqual(matchSetRoute("/sets/3/edit"), { id: 3, action: "edit" });
  assert.deepEqual(matchSetRoute("/sets/3/add"), { id: 3, action: "add" });
  assert.deepEqual(matchSetRoute("/sets/3/remove"), { id: 3, action: "remove" });
  assert.deepEqual(matchSetRoute("/sets/3/clone"), { id: 3, action: "clone" });
  assert.deepEqual(matchSetRoute("/sets/3/export.csv"), { id: 3, action: "export.csv" });
  assert.equal(matchSetRoute("/sets/new"), null);
  assert.equal(matchSetRoute("/sets"), null);
});

test("matchMasterRoute and matchAdminUserRoute resolve admin POST routes", () => {
  assert.deepEqual(matchMasterRoute("/categories/3/delete", "categories"), { id: 3, action: "delete" });
  assert.deepEqual(matchMasterRoute("/tags/4/edit", "tags"), { id: 4, action: "edit" });
  assert.deepEqual(matchAdminUserRoute("/admin/users/5/approve"), { id: 5, action: "approve" });
  assert.deepEqual(matchAdminUserRoute("/admin/users/5/permissions"), { id: 5, action: "permissions" });
  assert.deepEqual(matchAdminUserRoute("/admin/users/5/reset-password"), { id: 5, action: "reset-password" });
  assert.equal(matchAdminUserRoute("/admin/users/5/delete"), null);
});

test("campaign and import job matchers resolve nested workflow routes", () => {
  assert.deepEqual(matchDisposalBatchRoute("/disposal-batches/4"), { id: 4, action: "details", itemId: 0 });
  assert.deepEqual(matchDisposalBatchRoute("/disposal-batches/4/export.csv"), { id: 4, action: "export.csv", itemId: 0 });
  assert.deepEqual(matchDisposalBatchRoute("/disposal-batches/4/items/9/exclude"), { id: 4, itemId: 9, action: "exclude" });
  assert.deepEqual(matchDocumentImportJobRoute("/document-import-jobs/8"), { id: 8, action: "details" });
  assert.deepEqual(matchDocumentImportJobRoute("/document-import-jobs/8/failures.csv"), { id: 8, action: "failures.csv" });
});

test("엑셀 snapshot matcher는 행 staging·검증·반영·취소 경로를 구분한다", () => {
  assert.deepEqual(matchDocumentSnapshotRoute("/document-snapshots/8"), { id: 8, action: "details" });
  assert.deepEqual(matchDocumentSnapshotRoute("/document-snapshots/8/rows"), { id: 8, action: "rows" });
  assert.deepEqual(matchDocumentSnapshotRoute("/document-snapshots/8/prepare"), { id: 8, action: "prepare" });
  assert.deepEqual(matchDocumentSnapshotRoute("/document-snapshots/8/apply"), { id: 8, action: "apply" });
  assert.deepEqual(matchDocumentSnapshotRoute("/document-snapshots/8/cancel"), { id: 8, action: "cancel" });
  assert.equal(matchDocumentSnapshotRoute("/document-snapshots/new"), null);
});
