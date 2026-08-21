import assert from "node:assert/strict";
import test from "node:test";

import {
  getDocumentPageWindow,
  getFastDocumentCount
} from "../src/domains/documents/index.js";
import { getDisposalHistoryPage } from "../src/domains/disposal/index.js";
import {
  createDocumentSnapshotExport,
  getDocumentSnapshotExportPage,
  runDocumentSnapshotMaintenance,
  runScheduledBootstrapApplication
} from "../src/domains/snapshots/index.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

test("최초 5,001건은 사용자의 묶음 선택 없이 5,000건씩 재개되어 최종 공개된다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const autoCategoryName = "대량 자동 문서종류";
  try {
    const reference = database.prepare(`
      SELECT d.category_id, d.rack_slot_id
      FROM documents d
      ORDER BY d.id
      LIMIT 1
    `).get();
    const sync = database.prepare("SELECT current_version FROM document_sync_state WHERE id = 1").get();
    const snapshot = database.prepare(`
      INSERT INTO document_snapshots (
        snapshot_code, source_name, source_hash, schema_version, base_version,
        status, mode, total_count, staged_count, create_count,
        created_by_name, bootstrap_next_run_at, bootstrap_apply_actor_json,
        bootstrap_apply_details_json, bootstrap_apply_role, bootstrap_apply_started_at
      ) VALUES (
        'SNP-TEST-30000', 'initial.xlsx', ?, 1, ?,
        'applying', 'bootstrap', 5001, 5001, 5001,
        '관리자', datetime(CURRENT_TIMESTAMP, '+1 day'), ?, '{}', 'Admin', CURRENT_TIMESTAMP
      )
      RETURNING id
    `).get(
      "a".repeat(64),
      sync.current_version,
      JSON.stringify({ userId: 1, username: "admin", displayName: "관리자", permissions: [] })
    );
    database.prepare(`
      WITH RECURSIVE sequence(n) AS (
        SELECT 1
        UNION ALL
        SELECT n + 1 FROM sequence WHERE n < 5001
      )
      INSERT INTO document_snapshot_rows (
        snapshot_id, row_number, row_key, source_json, normalized_json, action
      )
      SELECT
        ?, n + 1, 'HLM-AUTO-' || printf('%06d', n), '{}',
        json_object(
          'schemaVersion', 1,
          'rowKey', 'HLM-AUTO-' || printf('%06d', n),
          'values', json_object(
            'categoryId', 0,
            'categoryName', ?,
            'documentNumber', 'AUTO-' || printf('%06d', n),
            'revisionNumber', 'Rev.0',
            'revisionDate', '2026-07-29',
            'disposalDueYear', 2031,
            'documentName', '자동 분할 문서 ' || n,
            'note', '',
            'rackSlotId', ?,
            'rackFace', 'A',
            'status', CASE WHEN n % 10 = 0 THEN 'disposed' ELSE 'active' END,
            'tagIds', json_array()
          )
        ),
        'create'
      FROM sequence
    `).run(snapshot.id, autoCategoryName, reference.rack_slot_id);

    const first = await runScheduledBootstrapApplication(env, { force: true });
    assert.equal(first.ok, true);
    assert.equal(first.completed, false);
    assert.equal(first.progressCount, 5000);
    const autoCategory = database.prepare("SELECT id FROM categories WHERE name = ?").get(autoCategoryName);
    assert.ok(autoCategory?.id);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM documents WHERE category_id = ?").get(autoCategory.id).count,
      5000
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents").get().count, 5000);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 0);
    assert.throws(() => database.prepare(`
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, document_name,
        rack_slot_id, rack_face, status, sync_state
      ) VALUES ('ARC-LOCKED', ?, 'LOCKED', 'Rev.0', '잠금 확인', ?, 'A', 'active', 'current')
    `).run(reference.category_id, reference.rack_slot_id), /BOOTSTRAP_APPLY_IN_PROGRESS/);

    const lastInsert = await runScheduledBootstrapApplication(env, { force: true });
    assert.equal(lastInsert.ok, true);
    assert.equal(lastInsert.completed, false);
    assert.equal(lastInsert.progressCount, 5001);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 0);

    const final = await runScheduledBootstrapApplication(env, { force: true });
    assert.equal(final.ok, true);
    assert.equal(final.completed, true);
    assert.equal(final.progressCount, 5001);
    assert.equal(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(snapshot.id).status, "completed");

    const capacity = database.prepare("SELECT * FROM document_capacity_state WHERE id = 1").get();
    assert.equal(capacity.current_document_count, 5001);
    assert.equal(capacity.active_document_count, 4501);
    assert.equal(capacity.disposed_document_count, 500);

    const activeFilters = { status: "active", sort: "updated" };
    const activePage = await getDocumentPageWindow(env, activeFilters, 1, 30);
    assert.equal(activePage.items.length, 30);
    assert.equal(activePage.items.every((document) => document.status === "active"), true);
    assert.equal(activePage.items.every((document) => !Object.hasOwn(document, "tag_names")), true);
    assert.equal(await getFastDocumentCount(env, activeFilters), 4501);

    const exportManifest = await createDocumentSnapshotExport(env, {
      userId: 1, username: "admin", displayName: "관리자", permissions: []
    });
    const exportPage1 = await getDocumentSnapshotExportPage(env, exportManifest.exportManifestId, 1);
    const exportPage2 = await getDocumentSnapshotExportPage(env, exportManifest.exportManifestId, 2);
    assert.equal(exportPage1.documents.length, 250);
    assert.equal(exportPage2.documents.length, 250);
    assert.equal(
      new Set([...exportPage1.documents, ...exportPage2.documents].map((document) => document.rowKey)).size,
      500,
      "keyset cursor 페이지는 중복 문서를 만들지 않는다"
    );

    const disposed = await getDisposalHistoryPage(env, { page: 1, pageSize: 30 });
    assert.equal(disposed.pagination.totalItems, 500);
    assert.equal(disposed.items.length, 30);
    assert.equal(disposed.items.every((document) => document.status === "disposed"), true);
  } finally {
    database.close();
  }
});

test("완료 snapshot membership은 최신 3개만 유지하고 감사 header는 보존한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    const version = database.prepare("SELECT current_version FROM document_sync_state WHERE id = 1").get().current_version;
    for (let index = 1; index <= 4; index += 1) {
      const snapshot = database.prepare(`
        INSERT INTO document_snapshots (
          snapshot_code, source_name, source_hash, schema_version, base_version,
          status, mode, total_count, staged_count, created_by_name, applied_at
        ) VALUES (?, ?, ?, 2, ?, 'completed', 'managed', 1, 0, '관리자', datetime(CURRENT_TIMESTAMP, ?))
        RETURNING id
      `).get(`SNP-RET-${index}`, `ret-${index}.xlsx`, String(index).repeat(64), version, `-${5 - index} days`);
      database.prepare(`
        INSERT INTO document_snapshot_membership (snapshot_id, row_number, row_key)
        VALUES (?, 2, ?)
      `).run(snapshot.id, `HLM-RET-${index}`);
    }

    const cleanup = await runDocumentSnapshotMaintenance(env);
    assert.equal(cleanup.deleted, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_snapshots").get().count, 4);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_snapshot_membership").get().count, 3);
  } finally {
    database.close();
  }
});
