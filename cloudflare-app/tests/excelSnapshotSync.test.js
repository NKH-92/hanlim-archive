import assert from "node:assert/strict";
import test from "node:test";

import { loadDocumentFormOptions } from "../src/domains/documents/index.js";
import {
  applyDocumentSnapshot,
  createDocumentSnapshot as createDocumentSnapshotRaw,
  getDocumentSnapshotExport,
  getDocumentSyncState,
  prepareDocumentSnapshot,
  stageDocumentSnapshotRows
} from "../src/domains/snapshots/index.js";
import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";

test("300건 엑셀 한 파일을 현재 대장으로 반영하고 다음 파일에서 변경·제외만 적용한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" };
  const actor = actorFixture();

  try {
    const firstRows = buildRows(300);
    const first = await createAndPrepare(env, actor, firstRows, {
      sourceHash: "a".repeat(64),
      mode: "bootstrap",
      hasRowKeys: false
    });
    assert.equal(first.snapshot.status, "ready");
    assert.equal(Number(first.snapshot.create_count), 300);
    assert.equal(Number(first.snapshot.update_count), 0);
    assert.equal(Number(first.snapshot.unchanged_count), 0);
    assert.equal(Number(first.snapshot.exclude_count), 0, "정확히 일치하는 초기 시드는 bootstrap 반영 전에 제거한다");

    const applied = await applyDocumentSnapshot(env, first.snapshot.id, actor, {
      applyReason: "최초 bootstrap 문서고 대장 반영",
      approvalReference: "BOOTSTRAP-001",
      confirmedExcludeCount: 0,
      confirmExclude: true,
      ...reviewConfirmation(first.snapshot)
    });
    assert.equal(applied.ok, true, applied.message);
    assert.equal(applied.statementCount <= FREE_TIER_BUDGET.maxD1StatementsPerRequest, true);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 300);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'excluded'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE status = 'disposed' AND sync_state = 'current'").get().count, 30);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_tags dt JOIN documents d ON d.id = dt.document_id WHERE d.sync_state = 'current'").get().count, 600);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_snapshot_exclusions WHERE snapshot_id = ?").get(first.snapshot.id).count, 0);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM document_audit_logs
      WHERE action = 'excel_sync_exclude' AND json_extract(details, '$.snapshotCode') = ?
    `).get(first.snapshot.snapshot_code).count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE note = 'Cloudflare 테스트 기본 문서'").get().count, 0);
    assert.equal(database.prepare("SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1").get().suppress_derived_triggers, 0);
    assert.equal(database.prepare("SELECT rebuild_required FROM search_index_state WHERE id = 1").get().rebuild_required, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 0);

    const exported = await getDocumentSnapshotExport(env);
    assert.equal(exported.documents.length, 300);
    assert.equal(exported.documents.every((document) => document.rowKey), true);
    assert.ok(exported.baseVersion > 1);
    assert.ok(exported.exportManifestId);
    assert.match(exported.canonicalExportHash, /^[a-f0-9]{64}$/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_snapshot_export_manifests WHERE manifest_id = ?").get(exported.exportManifestId).count, 1);

    const hashMismatch = await createDocumentSnapshot(env, {
      sourceName: "변조된_관리대장.xlsx",
      sourceHash: "f".repeat(64),
      totalCount: exported.documents.length,
      schemaVersion: exported.schemaVersion,
      mode: "managed",
      baseVersion: exported.baseVersion,
      currentSnapshotId: exported.currentSnapshotId,
      exportManifestId: exported.exportManifestId,
      canonicalExportHash: "0".repeat(64),
      hasRowKeys: true
    }, actor);
    assert.equal(hashMismatch.ok, false);
    assert.match(hashMismatch.message, /export 출처/);

    const nextRows = exported.documents.slice(0, -1).map((document, index) => ({
      rowNumber: index + 2,
      sourceRowKey: document.rowKey,
      source: {
        ...document,
        documentName: index === 0 ? `${document.documentName} 변경` : document.documentName
      }
    }));
    const second = await createAndPrepare(env, actor, nextRows, {
      sourceHash: "b".repeat(64),
      mode: "managed",
      hasRowKeys: true,
      baseVersion: exported.baseVersion,
      currentSnapshotId: exported.currentSnapshotId,
      exportManifestId: exported.exportManifestId,
      canonicalExportHash: exported.canonicalExportHash
    });
    assert.equal(Number(second.snapshot.create_count), 0);
    assert.equal(Number(second.snapshot.update_count), 1);
    assert.equal(Number(second.snapshot.unchanged_count), 298);
    assert.equal(Number(second.snapshot.exclude_count), 1);
    assert.equal(Number(second.snapshot.metadata_count), 1);

    const missingCheckbox = await applyDocumentSnapshot(env, second.snapshot.id, actor, {
      applyReason: "정기 대장 현행화 반영 작업",
      approvalReference: "CC-2026-0001",
      confirmedExcludeCount: 1
    });
    assert.equal(missingCheckbox.ok, false);
    assert.match(missingCheckbox.message, /검토하고/);
    const secondApplied = await applyDocumentSnapshot(env, second.snapshot.id, actor, {
      applyReason: "정기 대장 현행화 반영 작업",
      approvalReference: "CC-2026-0001",
      confirmedExcludeCount: 1,
      confirmExclude: true,
      ...reviewConfirmation(second.snapshot)
    });
    assert.equal(secondApplied.ok, true, secondApplied.message);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 299);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'excluded'").get().count, 1);
    assert.match(database.prepare("SELECT document_name FROM documents WHERE sync_state = 'current' ORDER BY id LIMIT 1").get().document_name, /변경$/);

    const state = await getDocumentSyncState(env);
    assert.ok(state.currentVersion > exported.baseVersion);
    const stale = await createDocumentSnapshot(env, {
      sourceName: "오래된 관리대장.xlsx",
      sourceHash: "c".repeat(64),
      totalCount: 1,
      schemaVersion: 1,
      mode: "managed",
      baseVersion: exported.baseVersion,
      currentSnapshotId: exported.currentSnapshotId || 1,
      hasRowKeys: true
    }, actor);
    assert.equal(stale.ok, false);
    assert.equal(stale.stale, true);
  } finally {
    database.close();
  }
});

test("1,000건 엑셀 반영은 단일 batch와 statement 예산 안에서 원자 처리된다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" };
  const actor = actorFixture();

  try {
    const rows = buildRows(1000);
    const prepared = await createAndPrepare(env, actor, rows, {
      sourceHash: "e".repeat(64),
      mode: "bootstrap",
      hasRowKeys: false
    });
    assert.equal(Number(prepared.snapshot.create_count), 1000);
    assert.equal(Number(prepared.snapshot.exclude_count), 0);

    const applied = await applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
      applyReason: "1,000건 규모 원자 반영 검증",
      approvalReference: "SCALE-1000",
      confirmedExcludeCount: 0,
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    });
    assert.equal(applied.ok, true, applied.message);
    assert.ok(applied.statementCount <= FREE_TIER_BUDGET.maxD1StatementsPerRequest);
    assert.equal(applied.statementCount, 27);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 1000);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'excluded'").get().count, 0);
    assert.equal(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(prepared.snapshot.id).status, "completed");
  } finally {
    database.close();
  }
});

test("bootstrap 대상이 정확한 초기 시드 2건이 아니면 전체 반영을 rollback한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" };
  const actor = actorFixture();

  try {
    database.prepare("UPDATE documents SET note = '사용자 보존 문서' WHERE storage_code = 'ARC-000002'").run();
    const prepared = await createAndPrepare(env, actor, buildRows(3), {
      sourceHash: "f".repeat(64),
      mode: "bootstrap",
      hasRowKeys: false
    });
    assert.equal(prepared.ok, true, prepared.message);

    const applied = await applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
      applyReason: "초기 시드 사전조건 rollback 검증",
      approvalReference: "BOOTSTRAP-GUARD",
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.stale, true);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE last_snapshot_id = ?").get(prepared.snapshot.id).count, 0);
    assert.equal(database.prepare("SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1").get().suppress_derived_triggers, 0);
  } finally {
    database.close();
  }
});

test("엑셀 동기화는 오류 행이 있으면 ready 상태가 되지 않고 현재 문서를 바꾸지 않는다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" };
  const actor = actorFixture();
  try {
    const rows = buildRows(2);
    rows[1].source.category = "존재하지 않는 문서종류";
    const created = await createDocumentSnapshot(env, {
      sourceName: "오류.xlsx",
      sourceHash: "d".repeat(64),
      totalCount: rows.length,
      schemaVersion: 1,
      mode: "bootstrap",
      hasRowKeys: false
    }, actor);
    assert.equal(created.ok, true, created.message);
    assert.equal((await stageDocumentSnapshotRows(env, created.id, rows)).ok, true);
    const options = await loadDocumentFormOptions(env, { activeOnly: true });
    const prepared = await prepareDocumentSnapshot(env, created.id, options, null, actor);
    assert.equal(prepared.ok, false);
    assert.match(prepared.message, /존재하지 않는 문서종류|문서종류/);
    assert.equal(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(created.id).status, "failed");
    const storedErrors = JSON.parse(database.prepare("SELECT validation_errors_json FROM document_snapshots WHERE id = ?").get(created.id).validation_errors_json);
    assert.ok(storedErrors.some((error) => error.rowNumber === 3 && error.field === "category"));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents").get().count, 2);
  } finally {
    database.close();
  }
});

async function createAndPrepare(env, actor, rows, options) {
  const created = await createDocumentSnapshot(env, {
    sourceName: "한림_문서고_관리대장.xlsx",
    sourceHash: options.sourceHash,
    totalCount: rows.length,
    schemaVersion: options.schemaVersion || (options.exportManifestId ? 2 : 1),
    mode: options.mode || "managed",
    baseVersion: options.baseVersion || "",
    currentSnapshotId: options.currentSnapshotId || "",
    exportManifestId: options.exportManifestId || "",
    canonicalExportHash: options.canonicalExportHash || "",
    hasRowKeys: options.hasRowKeys
  }, actor);
  assert.equal(created.ok, true, created.message);
  for (let index = 0; index < rows.length; index += FREE_TIER_BUDGET.excelSnapshotStageChunkSize) {
    const chunk = rows.slice(index, index + FREE_TIER_BUDGET.excelSnapshotStageChunkSize).map((row) => ({
      rowNumber: row.rowNumber,
      sourceRowKey: row.sourceRowKey || row.rowKey || "",
      source: row.source
    }));
    const staged = await stageDocumentSnapshotRows(env, created.id, chunk);
    assert.equal(staged.ok, true, staged.message);
  }
  const formOptions = await loadDocumentFormOptions(env, { activeOnly: true });
  const prepared = await prepareDocumentSnapshot(env, created.id, formOptions, null, actor);
  assert.equal(prepared.ok, true, prepared.message);
  return prepared;
}

test("엑셀 export는 조회 중 sync version이 바뀌면 혼합 결과를 폐기하고 다시 읽는다", async () => {
  const database = await createMigratedDatabase();
  const baseDb = sqliteD1(database);
  let documentReads = 0;
  const env = {
    DB: {
      ...baseDb,
      prepare(sql) {
        const prepared = baseDb.prepare(sql);
        if (!/FROM documents d[\s\S]*WHERE d\.sync_state = 'current'/.test(sql)) return prepared;
        return {
          ...prepared,
          async all() {
            const result = await prepared.all();
            documentReads += 1;
            if (documentReads === 1) {
              database.prepare("UPDATE document_sync_state SET current_version = current_version + 1 WHERE id = 1").run();
            }
            return result;
          }
        };
      }
    }
  };
  try {
    const exported = await getDocumentSnapshotExport(env, actorFixture());
    assert.equal(documentReads, 2);
    assert.equal(exported.baseVersion, database.prepare("SELECT current_version FROM document_sync_state WHERE id = 1").get().current_version);
  } finally {
    database.close();
  }
});

function reviewConfirmation(snapshot) {
  return {
    confirmReview: true,
    confirmedReviewCount: Number(snapshot.create_count || 0) + Number(snapshot.update_count || 0) + Number(snapshot.exclude_count || 0)
  };
}

function buildRows(count) {
  const categories = ["제조기록서", "제품사양서", "PV", "CV", "IQ", "OQ"];
  const positions = [{ rack: 1, face: "단면" }];
  for (let rack = 2; rack <= 13; rack += 1) positions.push({ rack, face: "1면" }, { rack, face: "2면" });
  return Array.from({ length: count }, (_, index) => {
    const position = positions[index % positions.length];
    return {
      rowNumber: index + 2,
      sourceRowKey: "",
      source: {
        documentNumber: `DOC-${String(index + 1).padStart(4, "0")}`,
        revisionNumber: `Rev.${index % 4}`,
        revisionDate: `2026-${String(index % 12 + 1).padStart(2, "0")}-01`,
        disposalDueYear: String(2028 + index % 5),
        documentName: `문서고 관리문서 ${index + 1}`,
        category: categories[index % categories.length],
        rackNumber: String(position.rack),
        rackColumn: String(index % 7 + 1),
        shelfNumber: String(index % 6 + 1),
        rackFace: position.face,
        tags: "중요문서;원본보관",
        note: `엑셀 전체 동기화 예시 ${index + 1}`,
        status: (index + 1) % 10 === 0 ? "폐기" : "보관중"
      }
    };
  });
}

function createDocumentSnapshot(env, input, actor) {
  return createDocumentSnapshotRaw(env, {
    sourceSize: 4096,
    syncReason: "통합 테스트 문서고 대장 동기화",
    bootstrapConfirmation: input?.mode === "bootstrap" ? "BOOTSTRAP" : "",
    backupConfirmed: input?.mode === "bootstrap",
    ...input
  }, actor);
}

function sqliteD1(database) {
  function statement(sql, args = []) {
    return {
      sql,
      args,
      bind(...nextArgs) { return statement(sql, nextArgs); },
      async first() { return database.prepare(sql).get(...args) ?? null; },
      async all() { return { results: database.prepare(sql).all(...args) }; },
      async run() {
        const result = database.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
      }
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(({ sql, args }) => {
          if (/\bRETURNING\b/i.test(sql)) {
            const rows = database.prepare(sql).all(...args);
            return {
              results: rows,
              meta: {
                changes: Number(database.prepare("SELECT changes() AS count").get().count || 0),
                last_row_id: Number(database.prepare("SELECT last_insert_rowid() AS id").get().id || 0)
              }
            };
          }
          const result = database.prepare(sql).run(...args);
          return { results: [], meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
