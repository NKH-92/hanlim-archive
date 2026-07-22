import assert from "node:assert/strict";
import test from "node:test";

import {
  getDocumentRevisionHistory,
  permanentlyDeleteDocument,
  restoreDocument,
  reviseDocument
} from "../src/domains/documents/index.js";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

test("동일 바인더 문서 개정은 새 행을 만들고 이전본을 자동 폐기한다", async (context) => {
  const database = await createMigratedDatabase();
  context.after(() => database.close());
  database.prepare(`
    UPDATE documents
    SET revision_date = '2026-01-10', disposal_due_year = 2031
    WHERE id = 1
  `).run();
  const before = database.prepare("SELECT * FROM documents WHERE id = 1").get();
  const beforeTags = database.prepare("SELECT tag_id FROM document_tags WHERE document_id = 1 ORDER BY tag_id").all();
  const env = { DB: sqliteD1(database) };

  const result = await reviseDocument(env, 1, {
    revisionNumber: "Rev.1",
    revisionDate: "2026-07-22",
    confirmReplacement: "1",
    expectedUpdatedAt: before.updated_at,
    expectedRowVersion: before.row_version
  }, actorFixture());

  assert.equal(result.ok, true);
  assert.ok(result.newDocumentId > 1);
  const previous = database.prepare("SELECT * FROM documents WHERE id = 1").get();
  const replacement = database.prepare("SELECT * FROM documents WHERE id = ?").get(result.newDocumentId);
  assert.equal(previous.status, "disposed");
  assert.equal(replacement.status, "active");
  assert.equal(replacement.document_number, before.document_number);
  assert.equal(replacement.document_name, before.document_name);
  assert.equal(replacement.category_id, before.category_id);
  assert.equal(replacement.disposal_due_year, before.disposal_due_year);
  assert.equal(replacement.note, before.note);
  assert.equal(replacement.rack_slot_id, before.rack_slot_id);
  assert.equal(replacement.rack_face, before.rack_face);
  assert.equal(replacement.revision_number, "Rev.1");
  assert.equal(replacement.revision_date, "2026-07-22");
  assert.match(replacement.storage_code, /^ARC-\d{6}$/);
  assert.match(replacement.excel_row_key, /^HLM-\d{12}$/);

  assert.deepEqual(
    database.prepare("SELECT tag_id FROM document_tags WHERE document_id = ? ORDER BY tag_id").all(result.newDocumentId),
    beforeTags
  );
  assert.deepEqual({ ...database.prepare(`
    SELECT previous_document_id, new_document_id, previous_revision_number, new_revision_number
    FROM document_revision_links
  `).get() }, {
    previous_document_id: 1,
    new_document_id: result.newDocumentId,
    previous_revision_number: before.revision_number,
    new_revision_number: "Rev.1"
  });
  assert.equal(
    database.prepare("SELECT reason FROM disposal_logs WHERE document_id = 1 ORDER BY id DESC").get().reason,
    "개정 Rev.1로 대체"
  );
  assert.deepEqual(
    database.prepare("SELECT action FROM document_audit_logs WHERE document_id IN (1, ?) AND action LIKE 'revision_%' ORDER BY id").all(result.newDocumentId).map((row) => row.action),
    ["revision_superseded", "revision_created"]
  );

  const history = await getDocumentRevisionHistory(env, result.newDocumentId);
  assert.deepEqual(history.map((item) => item.revision_number), ["Rev.1", before.revision_number]);
  assert.equal(Number(history[1].replacement_document_id), result.newDocumentId);

  const restore = await restoreDocument(env, 1, actorFixture(), "잘못 폐기됨");
  assert.equal(restore.ok, false);
  assert.match(restore.message, /개정으로 대체된 이전본/);
  const deletion = await permanentlyDeleteDocument(env, 1, actorFixture());
  assert.equal(deletion.ok, false);
  assert.match(deletion.message, /개정 이력에 연결된 문서/);
});

test("문서 개정의 중복 번호와 낙관적 잠금 실패는 원본을 변경하지 않는다", async (context) => {
  const database = await createMigratedDatabase();
  context.after(() => database.close());
  const source = database.prepare("SELECT * FROM documents WHERE id = 1").get();
  const env = { DB: sqliteD1(database) };

  const sameRevision = await reviseDocument(env, 1, {
    revisionNumber: source.revision_number,
    revisionDate: "2026-07-22",
    confirmReplacement: "1",
    expectedUpdatedAt: source.updated_at,
    expectedRowVersion: source.row_version
  }, actorFixture());
  assert.equal(sameRevision.ok, false);
  assert.match(sameRevision.validation.fieldErrors.revisionNumber, /현재 개정번호/);

  const stale = await reviseDocument(env, 1, {
    revisionNumber: "Rev.9",
    revisionDate: "2026-07-22",
    confirmReplacement: "1",
    expectedUpdatedAt: source.updated_at,
    expectedRowVersion: Number(source.row_version) + 1
  }, actorFixture());
  assert.equal(stale.ok, false);
  assert.equal(database.prepare("SELECT status FROM documents WHERE id = 1").get().status, "active");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_revision_links").get().count, 0);
});

test("신규 schema는 이전 Worker로 rollback해도 개정 이전본 복원·identity 변경·삭제를 차단한다", async (context) => {
  const database = await createMigratedDatabase();
  context.after(() => database.close());
  database.prepare(`
    UPDATE documents
    SET revision_date = '2026-01-10', disposal_due_year = 2031
    WHERE id = 1
  `).run();
  const source = database.prepare("SELECT * FROM documents WHERE id = 1").get();
  const result = await reviseDocument({ DB: sqliteD1(database) }, 1, {
    revisionNumber: "Rev.77",
    revisionDate: "2026-07-22",
    confirmReplacement: "1",
    expectedUpdatedAt: source.updated_at,
    expectedRowVersion: source.row_version
  }, actorFixture());
  assert.equal(result.ok, true);

  assert.throws(
    () => database.prepare("UPDATE documents SET status = 'active' WHERE id = 1").run(),
    /대체된 이전본은 복원/
  );
  assert.throws(
    () => database.prepare("UPDATE documents SET document_number = 'ROLLBACK-PREVIOUS' WHERE id = 1").run(),
    /identity는 변경/
  );
  assert.throws(
    () => database.prepare("UPDATE documents SET revision_number = 'Rev.78' WHERE id = 1").run(),
    /identity는 변경/
  );
  assert.throws(
    () => database.prepare("UPDATE documents SET document_number = 'ROLLBACK-EDIT' WHERE id = ?").run(result.newDocumentId),
    /identity는 변경/
  );
  assert.throws(
    () => database.prepare("UPDATE documents SET revision_number = 'Rev.79' WHERE id = ?").run(result.newDocumentId),
    /identity는 변경/
  );
  assert.throws(
    () => database.prepare("DELETE FROM documents WHERE id = 1").run(),
    /개정 이력에 연결된 문서는 삭제/
  );
  assert.throws(
    () => database.prepare("DELETE FROM documents WHERE id = ?").run(result.newDocumentId),
    /개정 이력에 연결된 문서는 삭제/
  );
  assert.equal(database.prepare("SELECT status FROM documents WHERE id = 1").get().status, "disposed");
  assert.equal(database.prepare("SELECT document_number FROM documents WHERE id = ?").get(result.newDocumentId).document_number, source.document_number);
});
