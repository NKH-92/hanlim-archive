import assert from "node:assert/strict";
import test from "node:test";

import {
  matchAdminUserRoute,
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
  assert.equal(matchSetRoute("/sets/new"), null);
  assert.equal(matchSetRoute("/sets"), null);
});

test("matchMasterRoute and matchAdminUserRoute resolve admin POST routes", () => {
  assert.deepEqual(matchMasterRoute("/categories/3/delete", "categories"), { id: 3, action: "delete" });
  assert.deepEqual(matchMasterRoute("/tags/4/edit", "tags"), { id: 4, action: "edit" });
  assert.deepEqual(matchAdminUserRoute("/admin/users/5/approve"), { id: 5, action: "approve" });
  assert.equal(matchAdminUserRoute("/admin/users/5/delete"), null);
});
