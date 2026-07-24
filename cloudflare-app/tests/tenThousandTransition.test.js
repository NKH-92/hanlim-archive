import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../src/index.js";
import { createSessionCookie } from "../src/auth.js";
import { createDocument, loadDocumentFormOptions } from "../src/domains/documents/index.js";
import { createDocumentImportJob } from "../src/domains/imports/index.js";
import {
  createDocumentSnapshotExport,
  createDocumentSnapshot,
  finalizeDocumentSnapshotExport,
  getDocumentSnapshotExportPage,
  prepareDocumentSnapshot,
  stageDocumentSnapshotMembership
} from "../src/domains/snapshots/index.js";
import {
  cleanupRetiredSearchGenerations,
  getViewerSearchPayload,
  processPendingSearchOutboxImmediately,
  processSearchOutbox,
  processSearchOutboxForDocument,
  processSearchOutboxForDocuments,
  rebuildSearchIndexChunk
} from "../src/domains/search/index.js";
import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

const SESSION_SECRET = "immediate-search-test-secret-at-least-32-characters";

async function createSearchDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile(new URL("../search-migrations/0001_search_index.sql", import.meta.url), "utf8"));
  database.exec(await readFile(new URL("../search-migrations/0002_shadow_generations_and_facets.sql", import.meta.url), "utf8"));
  database.exec(await readFile(new URL("../search-migrations/0003_rebuild_barriers_and_watermarks.sql", import.meta.url), "utf8"));
  return database;
}

function createAsyncBarrier() {
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  return {
    entered: enteredPromise,
    signalEntered() { entered(); },
    release() { release(); },
    waitForRelease() { return releasePromise; }
  };
}

function withBatchBarrier(database, predicate, barrier) {
  let blocked = false;
  return {
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      if (!blocked && predicate(statements)) {
        blocked = true;
        barrier.signalEntered();
        await barrier.waitForRelease();
      }
      return database.batch(statements);
    }
  };
}

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

test("Search D1 rebuild, 30건 cursor 계약, stale generation, outbox 동기화를 유지한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    const firstRebuild = await rebuildSearchIndexChunk(env);
    assert.equal(firstRebuild.ok, true);
    assert.equal(firstRebuild.processed, 2);
    const completed = await rebuildSearchIndexChunk(env);
    assert.equal(completed.completed, true);
    assert.equal(completed.indexedCount, 2);

    const first = await getViewerSearchPayload(env, { q: "2026", limit: 1 });
    assert.equal(first.ok, true);
    assert.equal(first.items.length, 1);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);
    assert.equal(first.fallback, false);

    const fuzzy = await getViewerSearchPayload(env, { q: "밸리데이선", limit: 30 });
    assert.equal(fuzzy.ok, true);
    assert.ok(fuzzy.items.some((item) => item.documentNumber === "PV-2026-014"), "Search D1 후보 뒤 Core 퍼지 점수를 유지한다");

    const activeBeforeShadow = searchDatabase.prepare(
      "SELECT active_generation FROM search_runtime_state WHERE id = 1"
    ).get().active_generation;
    coreDatabase.prepare("UPDATE search_index_state SET rebuild_required = 1 WHERE id = 1").run();
    const shadowChunk = await rebuildSearchIndexChunk(env, { limit: 1 });
    assert.equal(shadowChunk.completed, false);
    assert.equal(shadowChunk.activeGeneration, activeBeforeShadow);
    assert.notEqual(shadowChunk.buildingGeneration, activeBeforeShadow);
    const duringShadow = await getViewerSearchPayload(env, { q: "2026", limit: 30 });
    assert.equal(duringShadow.fallback, false);
    assert.equal(duringShadow.activeIndexGeneration, activeBeforeShadow);
    await rebuildSearchIndexChunk(env, { limit: 30 });
    const shadowComplete = await rebuildSearchIndexChunk(env, { limit: 30 });
    assert.equal(shadowComplete.completed, true);
    assert.notEqual(shadowComplete.activeGeneration, activeBeforeShadow);
    assert.equal(
      searchDatabase.prepare(
        "SELECT COUNT(*) AS count FROM search_documents_v2 WHERE generation = ?"
      ).get(activeBeforeShadow).count,
      2,
      "전환 직후 이전 세대 하나를 롤백용으로 유지한다"
    );
    assert.equal(
      searchDatabase.prepare(
        "SELECT previous_active_generation FROM search_runtime_state WHERE id = 1"
      ).get().previous_active_generation,
      activeBeforeShadow,
      "cleanup은 수치상 active-1이 아니라 명시적으로 기록한 직전 active generation을 보존한다"
    );
    const idleRebuild = await rebuildSearchIndexChunk(env);
    assert.equal(idleRebuild.processed, 0);
    assert.equal(
      searchDatabase.prepare("SELECT building_generation FROM search_runtime_state WHERE id = 1").get().building_generation,
      null,
      "변경이 없으면 새 shadow 세대를 반복 생성하지 않는다"
    );

    coreDatabase.prepare("UPDATE search_index_state SET generation = generation + 1 WHERE id = 1").run();
    const stale = await getViewerSearchPayload(env, { q: "2026", limit: 1, cursor: first.nextCursor });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "SEARCH_CURSOR_STALE");

    coreDatabase.prepare("UPDATE documents SET document_name = '검색 outbox 반영 문서' WHERE id = 1").run();
    coreDatabase.prepare("UPDATE documents SET note = '동일 문서 후속 변경' WHERE id = 1").run();
    assert.equal(coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 1);
    assert.equal(coreDatabase.prepare("SELECT event_version FROM search_index_outbox WHERE document_id = 1").get().event_version, 2);
    const processed = await processSearchOutbox(env);
    assert.equal(processed.ok, true);
    assert.equal(processed.processed, 1);
    assert.equal(processed.indexedCount, 2, "기존 문서 갱신은 Search D1 총 건수를 증가시키지 않는다");
    assert.equal(coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 0);
    assert.equal(coreDatabase.prepare("SELECT indexed_document_count FROM search_index_state WHERE id = 1").get().indexed_document_count, 2);
    assert.equal(searchDatabase.prepare("SELECT document_name FROM search_documents WHERE document_id = 1").get().document_name, "검색 outbox 반영 문서");
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("개별 문서 outbox는 등록 직후 대상 문서만 Search D1에 반영한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);

    const source = coreDatabase.prepare(`
      SELECT category_id, rack_slot_id, rack_face
      FROM documents
      ORDER BY id
      LIMIT 1
    `).get();
    const tag = coreDatabase.prepare("SELECT id, name FROM tags WHERE is_active = 1 ORDER BY id LIMIT 1").get();
    const createdId = await createDocument(env, {
      categoryId: source.category_id,
      documentNumber: "IMM-2026-001",
      revisionNumber: "Rev.0",
      revisionDate: "2026-07-24",
      disposalDueYear: "2031",
      documentName: "즉시 검색 신규 문서",
      note: "",
      rackSlotId: source.rack_slot_id,
      rackFace: source.rack_face,
      tagIds: [tag.id]
    }, actorFixture());

    assert.equal(coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 1);
    coreDatabase.prepare("UPDATE search_index_state SET rebuild_required = 1 WHERE id = 1").run();
    const duringShadowRebuild = await processSearchOutboxForDocument(env, createdId);
    assert.equal(duringShadowRebuild.ok, true);
    assert.equal(duringShadowRebuild.processed, 1);
    assert.equal(coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 0);
    coreDatabase.prepare("UPDATE search_index_state SET rebuild_required = 0 WHERE id = 1").run();

    const synced = await processSearchOutboxForDocument(env, createdId);
    assert.equal(synced.ok, true);
    assert.equal(synced.processed, 0);
    assert.equal(coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 0);

    const search = await getViewerSearchPayload(env, { q: "즉시 검색", limit: 30 });
    assert.ok(search.items.some((item) => item.documentNumber === "IMM-2026-001"));
    const tagSearch = await getViewerSearchPayload(env, { q: tag.name, limit: 30 });
    assert.ok(tagSearch.items.some((item) => item.documentNumber === "IMM-2026-001"));
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("Search D1 v2는 200건을 넘는 결과의 정확한 페이지·전체 합계·패싯을 반환한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    coreDatabase.exec(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 250
      )
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, document_name,
        rack_slot_id, rack_face, status, sync_state
      )
      SELECT
        'ARC-EXACT-' || printf('%03d', sequence.value),
        source.category_id,
        'EXACT-' || printf('%03d', sequence.value),
        'Rev.0',
        CASE
          WHEN sequence.value = 250 THEN '정확검색'
          ELSE '정확검색 공통 문서 ' || sequence.value
        END,
        source.rack_slot_id,
        source.rack_face,
        'active',
        'current'
      FROM sequence
      CROSS JOIN (SELECT category_id, rack_slot_id, rack_face FROM documents ORDER BY id LIMIT 1) source;
    `);
    const synced = await processPendingSearchOutboxImmediately(env, { limit: 1000 });
    assert.equal(synced.processed, 250);

    const firstPage = await getViewerSearchPayload(env, {
      q: "정확검색",
      page: 1,
      pageSize: 30
    });
    assert.equal(firstPage.items[0].documentNumber, "EXACT-250");

    const payload = await getViewerSearchPayload(env, {
      q: "정확검색",
      page: 3,
      pageSize: 30
    });
    assert.equal(payload.fallback, false);
    assert.equal(payload.items.length, 30);
    assert.equal(payload.pagination.page, 3);
    assert.equal(payload.pagination.totalItems, 250);
    assert.equal(payload.pagination.totalPages, 9);
    assert.equal(payload.facets.categories.reduce((sum, item) => sum + Number(item.count), 0), 250);
    assert.equal(payload.facets.statuses.find((item) => item.value === "active")?.count, 250);
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("여러 생성 경로의 outbox는 대상 목록 또는 즉시 pending batch로 한 번에 반영한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);

    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1").run("대상 목록 즉시 반영");
    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 2").run("pending batch 즉시 반영");
    const first = await processSearchOutboxForDocuments(env, [1, 1, 999999]);
    assert.equal(first.processed, 1);
    assert.equal(coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 1);
    assert.equal(searchDatabase.prepare("SELECT document_name FROM search_documents WHERE document_id = 1").get().document_name, "대상 목록 즉시 반영");

    const remaining = await processPendingSearchOutboxImmediately(env);
    assert.equal(remaining.processed, 1);
    assert.equal(coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 0);
    assert.equal(searchDatabase.prepare("SELECT document_name FROM search_documents WHERE document_id = 2").get().document_name, "pending batch 즉시 반영");
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("개별 등록·개정·CSV 생성 경로는 응답 직후 실제 검색 API에 반영된다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = {
    DB: sqliteD1(coreDatabase),
    SEARCH_DB: sqliteD1(searchDatabase),
    SESSION_SECRET
  };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);

    coreDatabase.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash,
        status, role, approved_at, approved_by, must_change_password,
        security_review_required, session_epoch, can_manage_documents
      )
      VALUES (?, ?, ?, ?, 'approved', 'User', CURRENT_TIMESTAMP, 'test-fixture', 0, 0, 0, 1)
    `).run("immediate-search-admin@example.com", "즉시 검색 관리자", "s".repeat(32), "h".repeat(64));
    const session = {
      username: "immediate-search-admin@example.com",
      displayName: "즉시 검색 관리자",
      role: "Admin"
    };
    const cookie = await createSessionCookie(session, env, false);
    const csrfToken = csrfFromCookie(cookie);
    const source = coreDatabase.prepare(`
      SELECT category_id, rack_slot_id, rack_face
      FROM documents
      ORDER BY id
      LIMIT 1
    `).get();
    const tag = coreDatabase.prepare("SELECT id, name FROM tags WHERE is_active = 1 ORDER BY id LIMIT 1").get();
    const body = new URLSearchParams({
      csrf_token: csrfToken,
      categoryId: String(source.category_id),
      documentNumber: "IMM-WORKER-2026-001",
      revisionNumber: "Rev.0",
      revisionDate: "2026-07-24",
      disposalDueYear: "2031",
      documentName: "응답 직후 검색 문서",
      rackSlotId: String(source.rack_slot_id),
      rackFace: source.rack_face,
      note: ""
    });
    body.append("tagIds", String(tag.id));

    const created = await worker.fetch(new Request("https://archive.example.com/documents", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://archive.example.com"
      },
      body
    }), env);
    assert.equal(created.status, 302);

    const byName = await worker.fetch(new Request(
      "https://archive.example.com/api/viewer/search?q=" + encodeURIComponent("응답 직후 검색"),
      { headers: { Cookie: cookie, Accept: "application/json" } }
    ), env);
    const namePayload = await byName.json();
    assert.ok(namePayload.items.some((item) => item.documentNumber === "IMM-WORKER-2026-001"));

    const byTag = await worker.fetch(new Request(
      "https://archive.example.com/api/viewer/search?q=" + encodeURIComponent(tag.name),
      { headers: { Cookie: cookie, Accept: "application/json" } }
    ), env);
    const tagPayload = await byTag.json();
    assert.ok(tagPayload.items.some((item) => item.documentNumber === "IMM-WORKER-2026-001"));

    const createdId = Number((created.headers.get("Location") || "").match(/\/documents\/(\d+)/)?.[1] || 0);
    const createdRow = coreDatabase.prepare("SELECT updated_at, row_version FROM documents WHERE id = ?").get(createdId);
    const revision = new URLSearchParams({
      csrf_token: csrfToken,
      revisionNumber: "Rev.1",
      revisionDate: "2026-07-24",
      confirmReplacement: "1",
      expectedUpdatedAt: createdRow.updated_at,
      expectedRowVersion: String(createdRow.row_version)
    });
    const revised = await worker.fetch(new Request(`https://archive.example.com/documents/${createdId}/revise`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://archive.example.com"
      },
      body: revision
    }), env);
    assert.equal(revised.status, 302);
    const revisedSearch = await worker.fetch(new Request(
      "https://archive.example.com/api/viewer/search?q=" + encodeURIComponent("Rev.1 응답 직후 검색 문서"),
      { headers: { Cookie: cookie, Accept: "application/json" } }
    ), env);
    assert.ok((await revisedSearch.json()).items.some((item) => item.revisionNumber === "Rev.1"));

    const admin = coreDatabase.prepare("SELECT id FROM app_users WHERE username = ?").get(session.username);
    const importJob = await createDocumentImportJob(env, {
      sourceName: "immediate-search.csv",
      items: [{
        values: {
          categoryId: source.category_id,
          documentNumber: "IMM-CSV-2026-001",
          revisionNumber: "Rev.0",
          revisionDate: "2026-07-24",
          disposalDueYear: "2031",
          documentName: "CSV 응답 직후 검색 문서",
          note: "",
          rackSlotId: source.rack_slot_id,
          rackFace: source.rack_face,
          tagIds: [tag.id]
        },
        status: "active"
      }]
    }, { ...session, id: admin.id, userId: admin.id });
    const imported = await worker.fetch(new Request(
      `https://archive.example.com/document-import-jobs/${importJob.id}/process`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://archive.example.com",
          Accept: "application/json"
        },
        body: new URLSearchParams({ csrf_token: csrfToken })
      }
    ), env);
    assert.equal(imported.status, 200);
    const importedPayload = await imported.json();
    assert.ok(importedPayload.createdDocumentId > 0);
    const importedSearch = await worker.fetch(new Request(
      "https://archive.example.com/api/viewer/search?q=" + encodeURIComponent("CSV 응답 직후 검색"),
      { headers: { Cookie: cookie, Accept: "application/json" } }
    ), env);
    assert.ok((await importedSearch.json()).items.some((item) => item.documentNumber === "IMM-CSV-2026-001"));
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("shadow rebuild의 stale snapshot은 최신 outbox upsert와 tombstone을 덮어쓰지 않는다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const coreD1 = sqliteD1(coreDatabase);
  const searchD1 = sqliteD1(searchDatabase);
  const env = { DB: coreD1, SEARCH_DB: searchD1 };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    coreDatabase.prepare("UPDATE search_index_state SET rebuild_required = 1 WHERE id = 1").run();

    const barrier = createAsyncBarrier();
    const blockedSearchD1 = withBatchBarrier(
      searchD1,
      (statements) => statements.some((statement) =>
        /INSERT INTO search_document_watermarks/.test(statement.sql)
        && String(statement.args?.[0] || "").includes('"documentId":2')
      ),
      barrier
    );
    const staleRebuild = rebuildSearchIndexChunk(
      { DB: coreD1, SEARCH_DB: blockedSearchD1 },
      { limit: 30 }
    );
    await barrier.entered;

    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1")
      .run("latest outbox document");
    coreDatabase.prepare("UPDATE documents SET sync_state = 'excluded' WHERE id = 2").run();
    const latestSourceVersion = coreDatabase.prepare(
      "SELECT current_version FROM search_event_clock WHERE id = 1"
    ).get().current_version;
    const outbox = await processPendingSearchOutboxImmediately(env, { limit: 30 });
    assert.equal(outbox.processed, 2);

    barrier.release();
    const staleResult = await staleRebuild;
    assert.equal(staleResult.processed, 2);
    const buildingGeneration = Number(staleResult.buildingGeneration);
    assert.equal(
      searchDatabase.prepare(`
        SELECT document_name
        FROM search_documents_v2
        WHERE generation = ? AND document_id = 1
      `).get(buildingGeneration).document_name,
      "latest outbox document"
    );
    assert.equal(
      searchDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM search_documents_v2
        WHERE generation = ? AND document_id = 2
      `).get(buildingGeneration).count,
      0
    );
    assert.deepEqual(
      { ...searchDatabase.prepare(`
        SELECT source_event_version, is_deleted
        FROM search_document_watermarks
        WHERE physical_generation = ? AND document_id = 2
      `).get(buildingGeneration) },
      { source_event_version: latestSourceVersion, is_deleted: 1 }
    );

    const completed = await rebuildSearchIndexChunk(env, { limit: 30 });
    assert.equal(completed.completed, true);
    assert.equal(completed.indexedCount, 1);
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("동시 rebuild claim은 하나의 token과 physical generation만 획득한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    const results = await Promise.all([
      rebuildSearchIndexChunk(env, { limit: 1 }),
      rebuildSearchIndexChunk(env, { limit: 1 })
    ]);
    assert.equal(results.filter((result) => result.processed === 1).length, 1);
    assert.equal(results.filter((result) => result.leaseHeld === true).length, 1);
    const runtime = searchDatabase.prepare(`
      SELECT building_generation, rebuild_token, building_last_document_id
      FROM search_runtime_state
      WHERE id = 1
    `).get();
    assert.equal(runtime.building_generation, 2);
    assert.match(runtime.rebuild_token, /^[0-9a-f-]{36}$/);
    assert.equal(runtime.building_last_document_id, 1);
    assert.equal(
      searchDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM search_documents_v2
        WHERE generation = 2
      `).get().count,
      1
    );
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("Core ready generation fence 충돌은 Search active generation을 유지하고 rebuild를 재시도 상태로 둔다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const coreD1 = sqliteD1(coreDatabase);
  const searchD1 = sqliteD1(searchDatabase);
  const env = { DB: coreD1, SEARCH_DB: searchD1 };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    const activeGeneration = searchDatabase.prepare(
      "SELECT active_generation FROM search_runtime_state WHERE id = 1"
    ).get().active_generation;
    coreDatabase.prepare("UPDATE search_index_state SET rebuild_required = 1 WHERE id = 1").run();
    await rebuildSearchIndexChunk(env, { limit: 30 });

    let injected = false;
    const faultCoreD1 = {
      prepare(sql) {
        return coreD1.prepare(sql);
      },
      async batch(statements) {
        if (!injected && statements.some((statement) =>
          /SET rebuild_required = 0/.test(statement.sql)
        )) {
          injected = true;
          coreDatabase.prepare(`
            UPDATE search_index_state
            SET generation = generation + 1, rebuild_required = 1
            WHERE id = 1
          `).run();
        }
        return coreD1.batch(statements);
      }
    };
    const conflicted = await rebuildSearchIndexChunk({
      DB: faultCoreD1,
      SEARCH_DB: searchD1
    }, { limit: 30 });
    assert.equal(conflicted.ok, false);
    assert.equal(conflicted.reason, "CORE_READY_FENCE_CONFLICT");
    const runtime = searchDatabase.prepare(`
      SELECT active_generation, building_generation, rebuild_status, cutover_generation
      FROM search_runtime_state
      WHERE id = 1
    `).get();
    assert.equal(runtime.active_generation, activeGeneration);
    assert.equal(runtime.building_generation, null);
    assert.equal(runtime.cutover_generation, null);
    assert.equal(runtime.rebuild_status, "failed");
    assert.equal(
      coreDatabase.prepare("SELECT rebuild_required FROM search_index_state WHERE id = 1").get().rebuild_required,
      1
    );
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("Search runtime transient 오류는 legacy fallback으로 숨기지 않고 outbox를 보존한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const coreD1 = sqliteD1(coreDatabase);
  const searchD1 = sqliteD1(searchDatabase);
  try {
    const env = { DB: coreD1, SEARCH_DB: searchD1 };
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1")
      .run("transient search failure");

    const transientSearchD1 = {
      prepare(sql) {
        if (
          /FROM search_runtime_state/.test(sql)
          && /building_source_generation/.test(sql)
        ) {
          return {
            first: async () => {
              throw new Error("D1 transient timeout");
            }
          };
        }
        return searchD1.prepare(sql);
      },
      batch(statements) {
        return searchD1.batch(statements);
      }
    };
    await assert.rejects(
      processSearchOutbox({ DB: coreD1, SEARCH_DB: transientSearchD1 }),
      /D1 transient timeout/
    );
    assert.deepEqual(
      { ...coreDatabase.prepare(`
        SELECT COUNT(*) AS count, MAX(attempt_count) AS attempts
        FROM search_index_outbox
      `).get() },
      { count: 1, attempts: 0 }
    );
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("stale outbox writer는 최신 delete tombstone을 되돌리거나 legacy 문서를 부활시키지 않는다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const coreD1 = sqliteD1(coreDatabase);
  const searchD1 = sqliteD1(searchDatabase);
  const env = { DB: coreD1, SEARCH_DB: searchD1 };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1")
      .run("stale outbox payload");
    const staleEvent = coreDatabase.prepare(`
      SELECT event_version, source_version
      FROM search_index_outbox
      WHERE document_id = 1
    `).get();

    const barrier = createAsyncBarrier();
    const staleWriter = processSearchOutbox({
      DB: coreD1,
      SEARCH_DB: withBatchBarrier(
        searchD1,
        (statements) => statements.some((statement) =>
          /INSERT INTO search_document_watermarks/.test(statement.sql)
          && String(statement.args?.[0] || "").includes('"documentId":1')
        ),
        barrier
      )
    });
    await barrier.entered;

    coreDatabase.prepare("UPDATE documents SET sync_state = 'excluded' WHERE id = 1").run();
    const deleteEvent = coreDatabase.prepare(`
      SELECT event_version, source_version
      FROM search_index_outbox
      WHERE document_id = 1
    `).get();
    assert.ok(deleteEvent.source_version > staleEvent.source_version);
    assert.ok(deleteEvent.event_version > staleEvent.event_version);
    const latest = await processSearchOutbox(env);
    assert.equal(latest.processed, 1);

    barrier.release();
    assert.deepEqual(await staleWriter, {
      ok: false,
      retryable: true,
      processed: 0,
      reason: "SEARCH_OUTBOX_GENERATION_CHANGED"
    });
    const activeGeneration = searchDatabase.prepare(
      "SELECT active_generation FROM search_runtime_state WHERE id = 1"
    ).get().active_generation;
    assert.equal(
      searchDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM search_documents_v2
        WHERE generation = ? AND document_id = 1
      `).get(activeGeneration).count,
      0
    );
    assert.deepEqual(
      { ...searchDatabase.prepare(`
        SELECT source_event_version, source_outbox_version, is_deleted
        FROM search_document_watermarks
        WHERE physical_generation = ? AND document_id = 1
      `).get(activeGeneration) },
      {
        source_event_version: deleteEvent.source_version,
        source_outbox_version: deleteEvent.event_version,
        is_deleted: 1
      }
    );
    assert.equal(
      searchDatabase.prepare(
        "SELECT COUNT(*) AS count FROM search_documents WHERE document_id = 1"
      ).get().count,
      0
    );
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("outbox row 재생성으로 event_version이 1로 돌아가도 persistent source_version은 증가한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1").run("first event");
    const first = coreDatabase.prepare(`
      SELECT event_version, source_version
      FROM search_index_outbox
      WHERE document_id = 1
    `).get();
    assert.equal(first.event_version, 1);
    await processSearchOutbox(env);

    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1").run("second event");
    const second = coreDatabase.prepare(`
      SELECT event_version, source_version
      FROM search_index_outbox
      WHERE document_id = 1
    `).get();
    assert.equal(second.event_version, 1);
    assert.ok(second.source_version > first.source_version);
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("delayed finalize는 outbox가 전진시킨 최신 generation을 회귀시키지 않고 최신 fence로 cutover한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const coreD1 = sqliteD1(coreDatabase);
  const searchD1 = sqliteD1(searchDatabase);
  const env = { DB: coreD1, SEARCH_DB: searchD1 };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    coreDatabase.prepare("UPDATE search_index_state SET rebuild_required = 1 WHERE id = 1").run();
    await rebuildSearchIndexChunk(env, { limit: 30 });

    const barrier = createAsyncBarrier();
    const delayedFinalize = rebuildSearchIndexChunk({
      DB: coreD1,
      SEARCH_DB: withBatchBarrier(
        searchD1,
        (statements) => statements.some((statement) =>
          /SET active_generation = building_generation/.test(statement.sql)
        ),
        barrier
      )
    }, { limit: 30 });
    await barrier.entered;

    const generationAtCutover = coreDatabase.prepare(
      "SELECT generation FROM search_index_state WHERE id = 1"
    ).get().generation;
    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1")
      .run("post-core-ready outbox");
    const advanced = await processSearchOutbox(env);
    assert.ok(advanced.generation > generationAtCutover);

    barrier.release();
    const finalized = await delayedFinalize;
    assert.equal(finalized.completed, true);
    const coreState = coreDatabase.prepare(`
      SELECT generation FROM search_index_state WHERE id = 1
    `).get();
    const searchState = searchDatabase.prepare(`
      SELECT generation, active_generation, building_generation, rebuild_status
      FROM search_runtime_state
      WHERE id = 1
    `).get();
    assert.equal(searchState.generation, coreState.generation);
    assert.equal(searchState.generation, advanced.generation);
    assert.equal(searchState.building_generation, null);
    assert.equal(searchState.rebuild_status, "ready");
    assert.equal(
      searchDatabase.prepare(`
        SELECT document_name
        FROM search_documents_v2
        WHERE generation = ? AND document_id = 1
      `).get(searchState.active_generation).document_name,
      "post-core-ready outbox"
    );

    coreDatabase.prepare("UPDATE search_index_state SET rebuild_required = 1 WHERE id = 1").run();
    await rebuildSearchIndexChunk(env, { limit: 30 });
    const subsequent = await rebuildSearchIndexChunk(env, { limit: 30 });
    assert.equal(subsequent.completed, true);
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("scheduled maintenance는 rebuild가 기다리는 delayed outbox를 먼저 배출하고 ready까지 전진한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const env = { DB: sqliteD1(coreDatabase), SEARCH_DB: sqliteD1(searchDatabase) };
  try {
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1")
      .run("scheduled delayed outbox");
    coreDatabase.prepare(`
      UPDATE search_index_outbox
      SET available_at = datetime('now', '+1 hour')
      WHERE document_id = 1
    `).run();
    coreDatabase.prepare(`
      UPDATE search_index_state
      SET rebuild_required = 1
      WHERE id = 1
    `).run();

    await runScheduledMaintenance(env);
    assert.equal(
      coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count,
      1
    );
    coreDatabase.prepare(`
      UPDATE search_index_outbox
      SET available_at = CURRENT_TIMESTAMP
      WHERE document_id = 1
    `).run();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await runScheduledMaintenance(env);
    }

    assert.equal(
      coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count,
      0
    );
    assert.equal(
      coreDatabase.prepare("SELECT rebuild_required FROM search_index_state WHERE id = 1").get().rebuild_required,
      0
    );
    assert.equal(
      searchDatabase.prepare("SELECT rebuild_status FROM search_runtime_state WHERE id = 1").get().rebuild_status,
      "ready"
    );
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("동시 outbox worker는 processor lease로 직렬화되고 backoff 없이 모두 배출된다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = await createSearchDatabase();
  const coreD1 = sqliteD1(coreDatabase);
  const searchD1 = sqliteD1(searchDatabase);
  try {
    const env = { DB: coreD1, SEARCH_DB: searchD1 };
    await rebuildSearchIndexChunk(env);
    await rebuildSearchIndexChunk(env);
    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 1").run("lease first");
    coreDatabase.prepare("UPDATE documents SET document_name = ? WHERE id = 2").run("lease second");

    const barrier = createAsyncBarrier();
    const first = processSearchOutbox({
      DB: coreD1,
      SEARCH_DB: withBatchBarrier(
        searchD1,
        (statements) => statements.some((statement) =>
          /INSERT INTO search_document_watermarks/.test(statement.sql)
        ),
        barrier
      )
    }, { limit: 1 });
    await barrier.entered;
    const concurrent = await processSearchOutbox(env, { limit: 1 });
    assert.equal(concurrent.skipped, true);
    assert.equal(concurrent.reason, "SEARCH_OUTBOX_PROCESSOR_BUSY");
    barrier.release();
    assert.equal((await first).processed, 1);
    assert.equal((await processSearchOutbox(env, { limit: 1 })).processed, 1);
    assert.deepEqual(
      { ...coreDatabase.prepare(`
        SELECT COUNT(*) AS count, COALESCE(MAX(attempt_count), 0) AS attempts
        FROM search_index_outbox
      `).get() },
      { count: 0, attempts: 0 }
    );
  } finally {
    coreDatabase.close();
    searchDatabase.close();
  }
});

test("generation cleanup은 stale snapshot 대신 live building generation을 보존한다", async () => {
  const searchDatabase = await createSearchDatabase();
  try {
    searchDatabase.prepare(`
      UPDATE search_runtime_state
      SET active_generation = 2,
          previous_active_generation = 1,
          building_generation = 3,
          rebuild_status = 'building'
      WHERE id = 1
    `).run();
    for (const generation of [1, 2, 3, 4]) {
      searchDatabase.prepare(`
        INSERT INTO search_document_watermarks (
          physical_generation, document_id, source_event_version
        ) VALUES (?, ?, 1)
      `).run(generation, generation);
    }
    const result = await cleanupRetiredSearchGenerations(
      sqliteD1(searchDatabase),
      { active_generation: 2, previous_active_generation: 1, building_generation: null }
    );
    assert.deepEqual(result.retainedGenerations, [2, 1, 3]);
    assert.deepEqual(
      searchDatabase.prepare(`
        SELECT physical_generation
        FROM search_document_watermarks
        ORDER BY physical_generation
      `).all().map(({ physical_generation }) => physical_generation),
      [1, 2, 3]
    );
  } finally {
    searchDatabase.close();
  }
});

async function runScheduledMaintenance(env) {
  let pending;
  await worker.scheduled({}, env, {
    waitUntil(promise) {
      pending = promise;
    }
  });
  await pending;
}

function csrfFromCookie(cookie) {
  const value = cookie.match(/hanlim_session=([^;]+)/)[1];
  const [payload] = value.split(".", 1);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).csrfToken;
}
