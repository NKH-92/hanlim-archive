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
  const searchDatabase = new DatabaseSync(":memory:");
  searchDatabase.exec(await readFile(new URL("../search-migrations/0001_search_index.sql", import.meta.url), "utf8"));
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
  const searchDatabase = new DatabaseSync(":memory:");
  searchDatabase.exec(await readFile(new URL("../search-migrations/0001_search_index.sql", import.meta.url), "utf8"));
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
    const deferred = await processSearchOutboxForDocument(env, createdId);
    assert.equal(deferred.skipped, true);
    assert.equal(coreDatabase.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").get().count, 1);
    coreDatabase.prepare("UPDATE search_index_state SET rebuild_required = 0 WHERE id = 1").run();

    const synced = await processSearchOutboxForDocument(env, createdId);
    assert.equal(synced.ok, true);
    assert.equal(synced.processed, 1);
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

test("여러 생성 경로의 outbox는 대상 목록 또는 즉시 pending batch로 한 번에 반영한다", async () => {
  const coreDatabase = await createMigratedDatabase();
  const searchDatabase = new DatabaseSync(":memory:");
  searchDatabase.exec(await readFile(new URL("../search-migrations/0001_search_index.sql", import.meta.url), "utf8"));
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
  const searchDatabase = new DatabaseSync(":memory:");
  searchDatabase.exec(await readFile(new URL("../search-migrations/0001_search_index.sql", import.meta.url), "utf8"));
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
        security_review_required, session_epoch
      )
      VALUES (?, ?, ?, ?, 'approved', 'Admin', CURRENT_TIMESTAMP, 'test-fixture', 0, 0, 0)
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

function csrfFromCookie(cookie) {
  const value = cookie.match(/hanlim_session=([^;]+)/)[1];
  const [payload] = value.split(".", 1);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).csrfToken;
}
