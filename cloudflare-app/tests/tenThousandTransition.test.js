import assert from "node:assert/strict";
import test from "node:test";

import { loadDocumentFormOptions } from "../src/domains/documents/index.js";
import {
  createDocumentSnapshotExport,
  createDocumentSnapshot,
  finalizeDocumentSnapshotExport,
  getDocumentSnapshotExportPage,
  prepareDocumentSnapshot,
  stageDocumentSnapshotMembership
} from "../src/domains/snapshots/index.js";
import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

test("10,000건 운영 정책은 11,000 경고와 12,000 하드 상한을 고정한다", () => {
  assert.equal(FREE_TIER_BUDGET.documentCapacityWarningCount, 11000);
  assert.equal(FREE_TIER_BUDGET.documentCapacityHardCount, 12000);
  assert.equal(FREE_TIER_BUDGET.excelSnapshotMaxItems, 12000);
  assert.equal(FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems, 1000);
  assert.equal(FREE_TIER_BUDGET.searchCandidateMaxItems, 200);
  assert.equal(FREE_TIER_BUDGET.searchResponseMaxItems, 30);
});

test("용량 trigger는 하드 상한의 다음 current 문서를 원자 차단한다", async () => {
  const database = await createMigratedDatabase();
  try {
    database.prepare(`
      UPDATE capacity_policy
      SET warning_document_count = 2, hard_document_count = 3
      WHERE id = 1
    `).run();
    database.exec(`
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, document_name,
        rack_slot_id, rack_face, status, sync_state
      )
      SELECT
        'ARC-CAP-3', category_id, 'CAP-3', 'Rev.0', '용량 경계 문서',
        rack_slot_id, rack_face, 'active', 'current'
      FROM documents
      ORDER BY id
      LIMIT 1;
    `);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 3);
    assert.throws(() => database.exec(`
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, document_name,
        rack_slot_id, rack_face, status, sync_state
      )
      SELECT
        'ARC-CAP-4', category_id, 'CAP-4', 'Rev.0', '상한 초과 문서',
        rack_slot_id, rack_face, 'active', 'current'
      FROM documents
      ORDER BY id
      LIMIT 1;
    `), /DOCUMENT_CAPACITY_EXCEEDED/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 3);
  } finally {
    database.close();
  }
});

test("schema v2 membership은 무변경 12,000행 경로에서 source JSON 재전송을 요구하지 않는다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" };
  const actor = actorFixture();
  try {
    database.prepare(`
      UPDATE documents
      SET revision_date = COALESCE(revision_date, '2026-01-01'),
          disposal_due_year = COALESCE(disposal_due_year, 2031),
          rack_slot_id = (
            SELECT slot.id
            FROM rack_slots slot
            JOIN racks rack ON rack.id = slot.rack_id
            WHERE slot.is_active = 1 AND rack.is_active = 1
            ORDER BY rack.rack_number, slot.column_number, slot.shelf_number
            LIMIT 1
          )
    `).run();
    const exportManifest = await createDocumentSnapshotExport(env, actor);
    assert.equal(exportManifest.schemaVersion, 2);
    assert.equal("documents" in exportManifest, false, "manifest 생성은 문서 전량을 메모리에 적재하지 않는다");
    const exportPage = await getDocumentSnapshotExportPage(env, exportManifest.exportManifestId, 1);
    assert.equal(exportPage.ok, true, exportPage.message);
    assert.equal(exportPage.documents.length, exportManifest.documentCount);
    const finalized = await finalizeDocumentSnapshotExport(env, exportManifest.exportManifestId);
    assert.equal(finalized.ok, true, finalized.message);
    assert.equal(finalized.documentCount, exportManifest.documentCount);
    assert.match(finalized.canonicalExportHash, /^[a-f0-9]{64}$/);
    const exported = {
      ...exportManifest,
      documents: exportPage.documents,
      canonicalExportHash: finalized.canonicalExportHash
    };
    const created = await createDocumentSnapshot(env, {
      sourceName: "membership-v2.xlsx",
      sourceHash: "a".repeat(64),
      sourceSize: 4096,
      syncReason: "schema v2 membership 무변경 검증",
      totalCount: exported.documents.length,
      schemaVersion: 2,
      mode: "managed",
      baseVersion: exported.baseVersion,
      currentSnapshotId: exported.currentSnapshotId || "",
      exportManifestId: exported.exportManifestId,
      canonicalExportHash: exported.canonicalExportHash,
      hasRowKeys: true
    }, actor);
    assert.equal(created.ok, true, created.message);
    const membership = exported.documents.map((document, index) => ({
      rowNumber: index + 2,
      rowKey: document.rowKey,
      baseRowVersion: document.baseRowVersion,
      baseHash: ""
    }));
    const stagedMembership = await stageDocumentSnapshotMembership(env, created.id, membership);
    assert.equal(stagedMembership.ok, true, stagedMembership.message);
    const prepared = await prepareDocumentSnapshot(
      env,
      created.id,
      await loadDocumentFormOptions(env, { activeOnly: true }),
      null,
      actor
    );
    assert.equal(prepared.ok, true, prepared.message);
    assert.equal(Number(prepared.snapshot.staged_count), 0);
    assert.equal(Number(prepared.snapshot.unchanged_count), exported.documents.length);
    assert.equal(Number(prepared.snapshot.update_count), 0);
  } finally {
    database.close();
  }
});
