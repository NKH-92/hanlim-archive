import assert from "node:assert/strict";
import test from "node:test";

import { prepareDocumentImportRows } from "../src/documentCsv.js";
import { loadDocumentFormOptions } from "../src/domains/documents/index.js";
import {
  applyDocumentSnapshot,
  createDocumentSnapshot,
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
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();

  try {
    const firstRows = buildRows(300);
    const first = await createAndPrepare(env, actor, firstRows, { sourceHash: "a".repeat(64), hasRowKeys: false });
    assert.equal(first.snapshot.status, "ready");
    assert.equal(Number(first.snapshot.create_count), 300);
    assert.equal(Number(first.snapshot.update_count), 0);
    assert.equal(Number(first.snapshot.unchanged_count), 0);
    assert.equal(Number(first.snapshot.exclude_count), 2, "초기 시드 문서는 삭제하지 않고 제외한다");

    const applied = await applyDocumentSnapshot(env, first.snapshot.id, actor);
    assert.equal(applied.ok, true);
    assert.equal(applied.statementCount <= FREE_TIER_BUDGET.maxD1StatementsPerRequest, true);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 300);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'excluded'").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE status = 'disposed' AND sync_state = 'current'").get().count, 30);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_tags dt JOIN documents d ON d.id = dt.document_id WHERE d.sync_state = 'current'").get().count, 600);

    const exported = await getDocumentSnapshotExport(env);
    assert.equal(exported.documents.length, 300);
    assert.equal(exported.documents.every((document) => document.rowKey), true);
    assert.equal(exported.baseVersion, 2);

    const nextRows = exported.documents.slice(0, -1).map((document, index) => ({
      rowNumber: index + 2,
      rowKey: document.rowKey,
      source: {
        ...document,
        documentName: index === 0 ? `${document.documentName} 변경` : document.documentName
      }
    }));
    const second = await createAndPrepare(env, actor, nextRows, {
      sourceHash: "b".repeat(64), hasRowKeys: true, baseVersion: exported.baseVersion
    });
    assert.equal(Number(second.snapshot.create_count), 0);
    assert.equal(Number(second.snapshot.update_count), 1);
    assert.equal(Number(second.snapshot.unchanged_count), 298);
    assert.equal(Number(second.snapshot.exclude_count), 1);

    const secondApplied = await applyDocumentSnapshot(env, second.snapshot.id, actor);
    assert.equal(secondApplied.ok, true);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count, 299);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'excluded'").get().count, 3);
    assert.match(database.prepare("SELECT document_name FROM documents WHERE sync_state = 'current' ORDER BY id LIMIT 1").get().document_name, /변경$/);

    const state = await getDocumentSyncState(env);
    assert.equal(state.currentVersion, 3);
    const stale = await createDocumentSnapshot(env, {
      sourceName: "오래된 관리대장.xlsx", sourceHash: "c".repeat(64), totalCount: 1, baseVersion: 2, hasRowKeys: true
    }, actor);
    assert.equal(stale.ok, false);
    assert.equal(stale.stale, true);
  } finally {
    database.close();
  }
});

test("엑셀 동기화는 오류 행이 있으면 ready 상태가 되지 않고 현재 문서를 바꾸지 않는다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  try {
    const rows = buildRows(2);
    rows[1].source.category = "존재하지 않는 문서종류";
    const created = await createDocumentSnapshot(env, {
      sourceName: "오류.xlsx", sourceHash: "d".repeat(64), totalCount: rows.length, hasRowKeys: false
    }, actor);
    assert.equal(created.ok, true);
    assert.equal((await stageDocumentSnapshotRows(env, created.id, rows)).ok, true);
    const options = await loadDocumentFormOptions(env, { activeOnly: true });
    const prepared = await prepareDocumentSnapshot(env, created.id, options, prepareDocumentImportRows, actor);
    assert.equal(prepared.ok, false);
    assert.match(prepared.message, /존재하지 않는 대분류/);
    assert.equal(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(created.id).status, "failed");
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
    baseVersion: options.baseVersion || "",
    hasRowKeys: options.hasRowKeys
  }, actor);
  assert.equal(created.ok, true);
  for (let index = 0; index < rows.length; index += FREE_TIER_BUDGET.excelSnapshotStageChunkSize) {
    const staged = await stageDocumentSnapshotRows(env, created.id, rows.slice(index, index + FREE_TIER_BUDGET.excelSnapshotStageChunkSize));
    assert.equal(staged.ok, true);
  }
  const formOptions = await loadDocumentFormOptions(env, { activeOnly: true });
  const prepared = await prepareDocumentSnapshot(env, created.id, formOptions, prepareDocumentImportRows, actor);
  assert.equal(prepared.ok, true, prepared.message);
  return prepared;
}

function buildRows(count) {
  const categories = ["제조기록서", "제품사양서", "PV", "CV", "IQ", "OQ"];
  const positions = [{ rack: 1, face: "단면" }];
  for (let rack = 2; rack <= 13; rack += 1) positions.push({ rack, face: "1면" }, { rack, face: "2면" });
  return Array.from({ length: count }, (_, index) => {
    const position = positions[index % positions.length];
    return {
      rowNumber: index + 2,
      rowKey: `ROW-${String(index + 1).padStart(8, "0")}`,
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
