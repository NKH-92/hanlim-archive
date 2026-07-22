import assert from "node:assert/strict";
import test from "node:test";

import {
  createDocument,
  disposeDocument,
  loadDocumentFormOptions,
  reviseDocument
} from "../src/domains/documents/index.js";
import {
  createDocumentSnapshot,
  getDocumentSnapshotExport,
  prepareDocumentSnapshot,
  stageDocumentSnapshotRows,
  validateRevisionHistorySnapshotChanges
} from "../src/domains/snapshots/index.js";
import { buildApplyStatements } from "../src/domains/snapshots/infrastructure/applyPlan.js";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

test("시스템에서 추가 후 폐기한 문서는 다음 현재 대장 엑셀 추출에 폐기 상태로 포함된다", async (context) => {
  const database = await createMigratedDatabase();
  context.after(() => database.close());
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  const location = database.prepare(`
    SELECT c.id AS category_id, rs.id AS rack_slot_id, r.is_single_sided
    FROM categories c
    CROSS JOIN rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE c.is_active = 1 AND rs.is_active = 1 AND r.is_active = 1
    ORDER BY c.id, rs.id
    LIMIT 1
  `).get();

  const documentId = await createDocument(env, {
    categoryId: location.category_id,
    documentNumber: "WEB-LEDGER-001",
    revisionNumber: "Rev.0",
    revisionDate: "2026-07-22",
    disposalDueYear: "2031",
    documentName: "웹 개별 등록 문서",
    note: "정기 지류 대장 반영 검증",
    rackSlotId: location.rack_slot_id,
    rackFace: "A",
    tagIds: []
  }, actor);
  const disposed = await disposeDocument(env, documentId, actor, "보존기간 종료");
  assert.equal(disposed.ok, true);

  const exported = await getDocumentSnapshotExport(env, actor);
  const row = exported.documents.find((document) => document.documentNumber === "WEB-LEDGER-001");
  assert.ok(row, "시스템 개별 등록 문서가 현재 대장 export에 있어야 한다");
  assert.match(row.rowKey, /^HLM-\d{12}$/);
  assert.equal(row.status, "폐기");
  assert.equal(row.documentName, "웹 개별 등록 문서");
  assert.equal(row.note, "정기 지류 대장 반영 검증");
  assert.equal(exported.documents.length, database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count);
});

test("개정 이력 정책은 연결 문서의 식별정보 변경과 이전본 폐기 해제를 차단한다", () => {
  const result = validateRevisionHistorySnapshotChanges([{
    rowNumber: 7,
    matchedDocumentId: 10,
    changedFields: ["documentNumber", "status"],
    before: { values: { status: "disposed" } },
    after: { values: { status: "active" } }
  }, {
    rowNumber: 8,
    matchedDocumentId: 11,
    changedFields: ["documentName"],
    before: { values: { status: "active" } },
    after: { values: { status: "active" } }
  }], [{ previous_document_id: 10, new_document_id: 11 }]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.field), ["documentNumber/revisionNumber", "status"]);
  assert.ok(result.errors.every((error) => error.code === "SNAPSHOT_REVISION_HISTORY_CONFLICT"));
});

test("엑셀 준비 단계는 개정 연결 문서의 식별정보 변경과 자동 폐기 이전본 복원을 함께 거부한다", async (context) => {
  const database = await createMigratedDatabase();
  context.after(() => database.close());
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  database.prepare(`
    UPDATE documents
    SET revision_date = COALESCE(revision_date, '2026-01-10'),
        disposal_due_year = COALESCE(disposal_due_year, 2031)
  `).run();
  const source = database.prepare("SELECT * FROM documents WHERE id = 1").get();
  const revised = await reviseDocument(env, 1, {
    revisionNumber: "Rev.77",
    revisionDate: "2026-07-22",
    confirmReplacement: "1",
    expectedUpdatedAt: source.updated_at,
    expectedRowVersion: source.row_version
  }, actor);
  assert.equal(revised.ok, true);

  const exported = await getDocumentSnapshotExport(env, actor);
  const rows = exported.documents.map((document, index) => ({
    rowNumber: index + 2,
    sourceRowKey: document.rowKey,
    source: {
      ...document,
      ...(document.status === "폐기" ? { status: "보관중" } : {}),
      ...(document.revisionNumber === "Rev.77" ? { revisionNumber: "Rev.78" } : {})
    }
  }));
  const created = await createDocumentSnapshot(env, {
    sourceName: "개정이력_충돌.xlsx",
    sourceHash: "9".repeat(64),
    sourceSize: 4096,
    totalCount: rows.length,
    schemaVersion: 1,
    mode: "managed",
    baseVersion: exported.baseVersion,
    currentSnapshotId: exported.currentSnapshotId,
    exportManifestId: exported.exportManifestId,
    canonicalExportHash: exported.canonicalExportHash,
    hasRowKeys: true
  }, actor);
  assert.equal(created.ok, true, created.message);
  assert.equal((await stageDocumentSnapshotRows(env, created.id, rows)).ok, true);

  const prepared = await prepareDocumentSnapshot(
    env,
    created.id,
    await loadDocumentFormOptions(env, { activeOnly: true }),
    null,
    actor
  );
  assert.equal(prepared.ok, false);
  assert.equal(prepared.code, "SNAPSHOT_REVISION_HISTORY_CONFLICT", prepared.message);
  const storedErrors = JSON.parse(database.prepare(`
    SELECT validation_errors_json
    FROM document_snapshots
    WHERE id = ?
  `).get(created.id).validation_errors_json);
  assert.deepEqual(storedErrors.map((error) => error.field).sort(), ["documentNumber/revisionNumber", "status"]);
  assert.equal(database.prepare("SELECT status FROM documents WHERE id = 1").get().status, "disposed");
  assert.equal(database.prepare("SELECT revision_number FROM documents WHERE id = ?").get(revised.newDocumentId).revision_number, "Rev.77");
});

test("엑셀 최종 반영 SQL도 준비 결과와 별개로 개정 이력 충돌을 차단한다", () => {
  const env = {
    DB: {
      prepare(sql) {
        return {
          sql,
          args: [],
          bind(...args) { return { sql, args }; }
        };
      }
    }
  };
  const statements = buildApplyStatements(env, {
    snapshotId: 12,
    snapshot: {},
    actorSnapshot: { userId: 17, username: "archive.admin", displayName: "문서고 관리자", permissions: {} },
    role: "Admin",
    applyReason: "계약 검증용 반영",
    approvalReference: "TEST-12",
    applyDetails: {}
  });
  const documentUpdate = statements.find((statement) => /UPDATE documents AS d/.test(statement.sql));
  assert.ok(documentUpdate);
  assert.match(documentUpdate.sql, /FROM document_revision_links link/);
  assert.match(documentUpdate.sql, /link\.previous_document_id = d\.id OR link\.new_document_id = d\.id/);
  assert.match(documentUpdate.sql, /d\.document_number IS NOT json_extract/);
  assert.match(documentUpdate.sql, /d\.revision_number IS NOT json_extract/);
  assert.match(documentUpdate.sql, /link\.previous_document_id = d\.id[\s\S]*d\.status = 'disposed'[\s\S]*'active'/);
});
