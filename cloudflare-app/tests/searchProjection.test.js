import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createDocument } from "../src/domains/documents/index.js";
import {
  getViewerSearchPayload,
  rebuildSearchIndexChunk,
  resolveSearchReadMode
} from "../src/domains/search/index.js";
import {
  drainSearchProjectionDirty,
  drainSearchProjectionDirtyForDocuments,
  getSearchProjectionState,
  reindexSearchProjectionChunk
} from "../src/domains/search/infrastructure/projection.js";
import { evaluateConsolidationGates } from "../scripts/measure-search-consolidation.mjs";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

async function createSearchDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0001_search_index.sql",
    "0002_shadow_generations_and_facets.sql",
    "0003_rebuild_barriers_and_watermarks.sql"
  ]) {
    database.exec(await readFile(new URL(`../search-migrations/${name}`, import.meta.url), "utf8"));
  }
  return database;
}

async function readyProjection(env) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await reindexSearchProjectionChunk(env);
    if (result.completed) return result;
  }
  throw new Error("projection reindex가 완료되지 않았습니다.");
}

function dirtyRows(database) {
  return database.prepare(`
    SELECT document_id, reason, event_version
    FROM search_projection_dirty
    ORDER BY document_id
  `).all();
}

test("검색 읽기 모드는 core가 기본이고 알 수 없는 값도 core로 닫는다", () => {
  assert.equal(resolveSearchReadMode({}), "core");
  assert.equal(resolveSearchReadMode({ SEARCH_READ_MODE: "compare" }), "compare");
  assert.equal(resolveSearchReadMode({ SEARCH_READ_MODE: "search-db" }), "search-db");
  assert.equal(resolveSearchReadMode({ SEARCH_READ_MODE: "nonsense" }), "core");
});

test("reference 이름 변경은 전체 재구축 대신 영향 문서만 재색인 대상으로 표시한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    await readyProjection(env);
    database.prepare("DELETE FROM search_projection_dirty").run();
    database.prepare("DELETE FROM search_index_outbox").run();
    database.prepare("UPDATE search_index_state SET rebuild_required = 0 WHERE id = 1").run();
    const generationBefore = database.prepare(
      "SELECT generation FROM search_index_state WHERE id = 1"
    ).get().generation;

    // 문서 1건만 가진 대분류 이름 변경
    const category = database.prepare(`
      SELECT c.id, COUNT(d.id) AS documents
      FROM categories c
      JOIN documents d ON d.category_id = c.id AND d.sync_state = 'current'
      GROUP BY c.id
      ORDER BY c.id
      LIMIT 1
    `).get();
    database.prepare("UPDATE categories SET name = ? WHERE id = ?")
      .run("제조기록서(개정 명칭)", category.id);

    const affected = database.prepare(
      "SELECT id FROM documents WHERE category_id = ? AND sync_state = 'current' ORDER BY id"
    ).all(category.id).map(({ id }) => id);
    assert.ok(affected.length > 0);
    assert.deepEqual(dirtyRows(database).map((row) => row.document_id), affected);
    assert.deepEqual(
      database.prepare("SELECT document_id FROM search_index_outbox ORDER BY document_id")
        .all().map(({ document_id }) => document_id),
      affected
    );
    assert.equal(
      database.prepare("SELECT rebuild_required FROM search_index_state WHERE id = 1").get().rebuild_required,
      0,
      "이름 변경은 전체 재구축을 요구하지 않는다"
    );
    assert.ok(
      database.prepare("SELECT generation FROM search_index_state WHERE id = 1").get().generation
        > generationBefore,
      "cursor 무효화를 위한 generation은 계속 증가한다"
    );

    // 색인에 들어가지 않는 컬럼 변경은 아무 파생 작업도 만들지 않는다.
    database.prepare("DELETE FROM search_projection_dirty").run();
    database.prepare("UPDATE categories SET description = ? WHERE id = ?").run("설명만 변경", category.id);
    assert.deepEqual(dirtyRows(database), []);

    // 신규 reference 행은 참조 문서가 없으므로 파생 작업이 없다.
    database.prepare("INSERT INTO tags (name) VALUES ('신규 태그')").run();
    database.prepare("INSERT INTO categories (name) VALUES ('신규 대분류')").run();
    assert.deepEqual(dirtyRows(database), []);
  } finally {
    database.close();
  }
});

test("랙·슬롯 위치 변경은 해당 위치의 문서만 재색인 대상으로 표시한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    await readyProjection(env);
    database.prepare("DELETE FROM search_projection_dirty").run();

    const document = database.prepare(`
      SELECT d.id, rs.id AS slot_id, rs.rack_id
      FROM documents d
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      WHERE d.sync_state = 'current'
      ORDER BY d.id
      LIMIT 1
    `).get();

    database.prepare("UPDATE racks SET code = ? WHERE id = ?").run("1-99", document.rack_id);
    assert.ok(dirtyRows(database).some((row) => row.document_id === document.id));

    database.prepare("DELETE FROM search_projection_dirty").run();
    database.prepare("UPDATE rack_slots SET slot_code = ? WHERE id = ?").run("9", document.slot_id);
    assert.deepEqual(
      dirtyRows(database).map((row) => row.document_id),
      [document.id]
    );

    // 다른 랙의 이름 변경은 이 문서를 건드리지 않는다.
    database.prepare("DELETE FROM search_projection_dirty").run();
    const otherRack = database.prepare(
      "SELECT id FROM racks WHERE id != ? ORDER BY id LIMIT 1"
    ).get(document.rack_id);
    database.prepare("UPDATE racks SET code = ? WHERE id = ?").run("3-98", otherRack.id);
    assert.equal(
      dirtyRows(database).some((row) => row.document_id === document.id),
      false
    );
  } finally {
    database.close();
  }
});

test("projection 전체 재색인은 in-place upsert로 진행하고 current가 아닌 문서를 정리한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    const first = await reindexSearchProjectionChunk(env, { limit: 1 });
    assert.equal(first.ok, true);
    assert.equal(first.completed, false);
    assert.equal(first.processed, 1);
    assert.equal(
      database.prepare("SELECT reindex_status FROM search_projection_state WHERE id = 1").get().reindex_status,
      "building"
    );
    // 재색인 중에도 이미 색인된 문서는 남아 있다(세대 교체가 없으므로 색인이 비지 않는다).
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM search_projection_documents").get().count,
      1
    );

    const completed = await readyProjection(env);
    assert.equal(completed.completed, true);
    const expected = database.prepare(
      "SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'"
    ).get().count;
    assert.equal(completed.indexedDocumentCount, expected);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM search_projection_documents").get().count,
      expected
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM search_projection_fts").get().count,
      expected
    );

    const idle = await reindexSearchProjectionChunk(env);
    assert.equal(idle.completed, true);
    assert.equal(idle.processed, 0);

    // 문서를 제외 처리하면 다음 재색인 sweep에서 색인에서 제거된다.
    const removed = database.prepare(
      "SELECT id FROM documents WHERE sync_state = 'current' ORDER BY id LIMIT 1"
    ).get().id;
    database.prepare("UPDATE documents SET sync_state = 'excluded' WHERE id = ?").run(removed);
    database.prepare(`
      UPDATE search_projection_state
      SET reindex_status = 'pending', reindex_cursor = 0
      WHERE id = 1
    `).run();
    await readyProjection(env);
    assert.equal(
      database.prepare(
        "SELECT COUNT(*) AS count FROM search_projection_documents WHERE document_id = ?"
      ).get(removed).count,
      0
    );
    assert.equal(
      database.prepare(
        "SELECT COUNT(*) AS count FROM search_projection_fts WHERE rowid = ?"
      ).get(removed).count,
      0
    );
  } finally {
    database.close();
  }
});

test("dirty 배출은 projection 쓰기와 큐 삭제를 한 batch로 원자 처리한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    await readyProjection(env);
    const target = database.prepare(
      "SELECT id FROM documents WHERE sync_state = 'current' ORDER BY id LIMIT 1"
    ).get().id;

    database.prepare("UPDATE documents SET document_name = ? WHERE id = ?")
      .run("배출 검증용 문서명", target);
    database.prepare("UPDATE documents SET note = ? WHERE id = ?").run("후속 변경", target);
    const queued = dirtyRows(database);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].event_version, 2, "같은 문서의 연속 변경은 event_version만 올린다");

    const drained = await drainSearchProjectionDirty(env);
    assert.equal(drained.ok, true);
    assert.equal(drained.processed, 1);
    assert.deepEqual(dirtyRows(database), []);
    assert.equal(
      database.prepare(
        "SELECT document_name FROM search_projection_documents WHERE document_id = ?"
      ).get(target).document_name,
      "배출 검증용 문서명"
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM search_projection_fts").get().count,
      database.prepare("SELECT COUNT(*) AS count FROM search_projection_documents").get().count,
      "FTS 행 수는 projection 행 수와 같다"
    );

    // 하드 삭제된 문서는 projection과 FTS에서 함께 제거된다.
    database.prepare("UPDATE documents SET status = 'disposed' WHERE id = ?").run(target);
    database.prepare("DELETE FROM documents WHERE id = ?").run(target);
    assert.equal(dirtyRows(database).length, 1);
    const removal = await drainSearchProjectionDirty(env);
    assert.equal(removal.processed, 1);
    assert.equal(
      database.prepare(
        "SELECT COUNT(*) AS count FROM search_projection_documents WHERE document_id = ?"
      ).get(target).count,
      0
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM search_projection_fts WHERE rowid = ?").get(target).count,
      0
    );
  } finally {
    database.close();
  }
});

test("배출 도중 새 변경이 생기면 오래된 내용이 최신 projection을 덮어쓰지 않는다", async () => {
  const database = await createMigratedDatabase();
  const core = sqliteD1(database);
  try {
    await readyProjection({ DB: core });
    const target = database.prepare(
      "SELECT id FROM documents WHERE sync_state = 'current' ORDER BY id LIMIT 1"
    ).get().id;
    database.prepare("UPDATE documents SET document_name = ? WHERE id = ?").run("이전 내용", target);

    // 문서 조회 뒤 batch 직전에 같은 문서가 다시 변경되어 event_version이 올라간 상황을 만든다.
    let injected = false;
    const racing = {
      prepare(sql) { return core.prepare(sql); },
      async batch(statements) {
        if (!injected && statements.some(({ sql }) => /INSERT INTO search_projection_documents/.test(sql))) {
          injected = true;
          database.prepare("UPDATE documents SET document_name = ? WHERE id = ?").run("최신 내용", target);
        }
        return core.batch(statements);
      }
    };

    const result = await drainSearchProjectionDirty({ DB: racing });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
    assert.equal(result.reason, "SEARCH_PROJECTION_DIRTY_CHANGED");
    assert.equal(dirtyRows(database).length, 1, "경합한 dirty 행은 큐에 남는다");

    const retried = await drainSearchProjectionDirty({ DB: core });
    assert.equal(retried.processed, 1);
    assert.equal(
      database.prepare(
        "SELECT document_name FROM search_projection_documents WHERE document_id = ?"
      ).get(target).document_name,
      "최신 내용"
    );
  } finally {
    database.close();
  }
});

test("Core projection 검색은 Search D1 경로와 같은 결과·건수·패싯을 만든다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    await readyProjection(env);

    for (const query of ["2026", "제조기록서", "밸리데이선", "MR-2026-001"]) {
      const legacy = await getViewerSearchPayload(
        { ...env, SEARCH_READ_MODE: "search-db" },
        { q: query, limit: 30 }
      );
      const projection = await getViewerSearchPayload(
        { ...env, SEARCH_READ_MODE: "core" },
        { q: query, limit: 30 }
      );
      assert.equal(projection.ok, legacy.ok, query);
      assert.equal(projection.fallback, false, query);
      assert.deepEqual(
        projection.items.map((item) => item.documentNumber),
        legacy.items.map((item) => item.documentNumber),
        `${query} 결과 목록이 일치해야 한다`
      );
      assert.equal(projection.pagination.totalItems, legacy.pagination.totalItems, `${query} 전체 건수`);
      assert.deepEqual(
        projection.facets.statuses.map((facet) => [facet.value, facet.count]),
        legacy.facets.statuses.map((facet) => [facet.value, facet.count]),
        `${query} 상태 패싯`
      );
    }
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("SEARCH_DB가 없어도 Core projection만으로 검색이 정상 응답한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    await readyProjection(env);
    const payload = await getViewerSearchPayload(env, { q: "제조기록서", limit: 30 });

    assert.equal(payload.ok, true);
    assert.equal(payload.fallback, false, "projection이 읽히면 열화 응답이 아니다");
    assert.deepEqual(payload.items.map((item) => item.documentNumber), ["MR-2026-001"]);
  } finally {
    database.close();
  }
});

test("projection이 준비되지 않으면 기존 Search D1 경로로 강등한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    assert.equal(
      coreDatabase.prepare("SELECT reindex_status FROM search_projection_state WHERE id = 1").get().reindex_status,
      "pending"
    );

    const payload = await getViewerSearchPayload(env, { q: "2026", limit: 30 });
    assert.equal(payload.ok, true);
    assert.equal(payload.fallback, false);
    assert.ok(payload.items.length > 0);
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("신규 등록 문서는 요청 직후 대상 문서만 projection에 반영된다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    await readyProjection(env);
    const source = database.prepare(`
      SELECT category_id, rack_slot_id, rack_face
      FROM documents
      WHERE sync_state = 'current'
      ORDER BY id
      LIMIT 1
    `).get();
    const tag = database.prepare("SELECT id, name FROM tags WHERE is_active = 1 ORDER BY id LIMIT 1").get();

    const createdId = await createDocument(env, {
      categoryId: source.category_id,
      documentNumber: "PRJ-2026-001",
      revisionNumber: "Rev.0",
      revisionDate: "2026-07-26",
      disposalDueYear: "2031",
      documentName: "projection 즉시 반영 문서",
      note: "",
      rackSlotId: source.rack_slot_id,
      rackFace: source.rack_face,
      tagIds: [tag.id]
    }, actorFixture());

    assert.equal(dirtyRows(database).length, 1);
    const synced = await drainSearchProjectionDirtyForDocuments(env, [createdId]);
    assert.equal(synced.processed, 1);
    assert.deepEqual(dirtyRows(database), []);

    const byName = await getViewerSearchPayload(env, { q: "projection 즉시", limit: 30 });
    assert.ok(byName.items.some((item) => item.documentNumber === "PRJ-2026-001"));
    const byTag = await getViewerSearchPayload(env, { q: tag.name, limit: 30 });
    assert.ok(byTag.items.some((item) => item.documentNumber === "PRJ-2026-001"));

    const state = await getSearchProjectionState(env);
    assert.equal(state.ready, true);
    assert.equal(state.pendingDirtyCount, 0);
  } finally {
    database.close();
  }
});

test("통합 게이트 판정은 측정값이 하나라도 상한을 넘으면 실패로 닫는다", () => {
  const measurement = {
    measuredAt: "2026-07-26",
    documents: { current: 402, planned: 10000 },
    sizes: { coreBytes: 1_724_416, searchBytes: 1_634_304 },
    dailyRows: { read: 120_000, written: 4_200 },
    statements: { maxPerRequest: 9, maxPerMutationBatch: 40 },
    contention: {
      bulkApplyP95BaselineMs: 1200,
      bulkApplyP95UnderSearchLoadMs: 1250,
      overloadCount: 0
    },
    goldenSearch: { comparedQueries: 40, criticalMismatches: 0 },
    reindexDrill: { documents: 12000, completed: true }
  };

  const passing = evaluateConsolidationGates(measurement);
  assert.equal(passing.ok, true, JSON.stringify(passing.gates));
  assert.deepEqual(
    passing.gates.map((gate) => gate.id),
    [
      "merged-database-size",
      "statements-per-request",
      "statements-per-mutation-batch",
      "daily-rows",
      "bulk-contention",
      "golden-search-parity",
      "reindex-drill"
    ]
  );

  const oversized = evaluateConsolidationGates({
    ...measurement,
    documents: { current: 402, planned: 400_000 }
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.gates.find((gate) => gate.id === "merged-database-size").ok, false);

  const mismatch = evaluateConsolidationGates({
    ...measurement,
    goldenSearch: { comparedQueries: 40, criticalMismatches: 1 }
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.gates.find((gate) => gate.id === "golden-search-parity").ok, false);

  assert.equal(evaluateConsolidationGates({}).ok, false);
});
