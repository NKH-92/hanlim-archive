import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import { createSessionCookie } from "../src/auth.js";
import { createDocument } from "../src/domains/documents/index.js";
import { createDocumentImportJob } from "../src/domains/imports/index.js";
import { getViewerSearchPayload } from "../src/domains/search/index.js";
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

const SESSION_SECRET = "projection-search-test-secret-at-least-32-characters";

async function readyProjection(env) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

function csrfFromCookie(cookie) {
  const value = cookie.match(/hanlim_session=([^;]+)/)[1];
  const [payload] = value.split(".", 1);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).csrfToken;
}

test("reference 이름 변경은 전체 재구축 대신 영향 문서만 재색인 대상으로 표시한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    await readyProjection(env);
    database.prepare("DELETE FROM search_projection_dirty").run();
    database.prepare("UPDATE search_index_state SET rebuild_required = 0 WHERE id = 1").run();
    const generationBefore = database.prepare(
      "SELECT generation FROM search_projection_state WHERE id = 1"
    ).get().generation;

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
    assert.equal(
      database.prepare("SELECT rebuild_required FROM search_index_state WHERE id = 1").get().rebuild_required,
      0,
      "이름 변경은 전체 재구축을 요구하지 않는다"
    );
    assert.ok(
      database.prepare("SELECT generation FROM search_projection_state WHERE id = 1").get().generation
        > generationBefore,
      "cursor 무효화를 위한 projection generation은 계속 증가한다"
    );
    assert.equal(
      database.prepare("SELECT generation FROM search_projection_state WHERE id = 1").get().generation,
      database.prepare("SELECT generation FROM search_index_state WHERE id = 1").get().generation,
      "expand 기간에는 rollback Worker용 legacy generation과 dual-write한다"
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

test("Core projection 검색은 정확 일치·퍼지·cursor·열화 판정 계약을 유지한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    // 재색인 완료 전에는 색인 없는 Core 퍼지 응답이므로 열화로 표시한다.
    const beforeReady = await getViewerSearchPayload(env, { q: "2026", limit: 30 });
    assert.equal(beforeReady.fallback, true);

    await readyProjection(env);
    const ready = { DB: sqliteD1(database) };

    const first = await getViewerSearchPayload(ready, { q: "2026", limit: 1 });
    assert.equal(first.ok, true);
    assert.equal(first.items.length, 1);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);
    assert.equal(first.fallback, false);

    const exactName = await getViewerSearchPayload(ready, {
      q: "2026년 1분기 제조기록서",
      limit: 30
    });
    assert.equal(exactName.pagination.totalItems, 1);
    assert.deepEqual(exactName.items.map((item) => item.documentNumber), ["MR-2026-001"]);
    assert.equal(exactName.items[0].matchReason, "문서명 정확히 일치");

    const fuzzy = await getViewerSearchPayload(ready, { q: "밸리데이선", limit: 30 });
    assert.equal(fuzzy.ok, true);
    assert.deepEqual(
      fuzzy.items.map((item) => item.documentNumber),
      ["PV-2026-014"],
      "projection 후보 뒤 Core 퍼지 점수로 무관한 n-gram 후보를 제거한다"
    );

    database.prepare("UPDATE search_projection_state SET generation = generation + 1 WHERE id = 1").run();
    const stale = await getViewerSearchPayload(ready, { q: "2026", limit: 1, cursor: first.nextCursor });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "SEARCH_CURSOR_STALE");
  } finally {
    database.close();
  }
});

test("projection 후검증에서 제외된 후보도 cursor offset은 소비해 중복 페이지를 만들지 않는다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    await readyProjection(env);
    const ids = database.prepare(`
      SELECT document_id
      FROM search_projection_documents
      ORDER BY document_id
      LIMIT 2
    `).all().map((row) => Number(row.document_id));
    assert.equal(ids.length, 2);
    database.prepare(`
      UPDATE search_projection_documents
      SET normalized_text = 'cursorghostterm'
      WHERE document_id IN (?, ?)
    `).run(...ids);
    database.prepare("INSERT INTO search_projection_fts(search_projection_fts) VALUES('rebuild')").run();

    const first = await getViewerSearchPayload(env, { q: "cursorghostterm", limit: 1 });
    assert.deepEqual(first.items, []);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);

    const second = await getViewerSearchPayload(env, {
      q: "cursorghostterm",
      limit: 1,
      cursor: first.nextCursor
    });
    assert.deepEqual(second.items, []);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
  } finally {
    database.close();
  }
});

test("필터 전용 검색은 총건수 미계산 상태에서도 opaque cursor로 다음 30건을 이어간다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    database.exec(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 35
      )
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, document_name,
        rack_slot_id, rack_face, status, sync_state
      )
      SELECT
        'ARC-FILTER-' || printf('%03d', sequence.value),
        source.category_id,
        'FILTER-' || printf('%03d', sequence.value),
        'Rev.0',
        '필터 전용 문서 ' || sequence.value,
        source.rack_slot_id,
        source.rack_face,
        'active',
        'current'
      FROM sequence
      CROSS JOIN (SELECT category_id, rack_slot_id, rack_face FROM documents ORDER BY id LIMIT 1) source;
    `);
    const categoryId = database.prepare("SELECT category_id FROM documents ORDER BY id LIMIT 1").get().category_id;
    const first = await getViewerSearchPayload(env, { category: categoryId, limit: 30 });

    assert.equal(first.items.length, 30);
    assert.equal(first.pagination.totalItems, null);
    assert.equal(first.candidateCount, null);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);

    const second = await getViewerSearchPayload(env, { category: categoryId, limit: 30, cursor: first.nextCursor });
    assert.ok(second.items.length >= 6);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, first.items.length + second.items.length);
  } finally {
    database.close();
  }
});

test("projection 검색은 200건을 넘는 결과의 정확한 페이지·전체 합계·패싯을 반환한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    database.exec(`
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
          WHEN sequence.value = 250 THEN '정확검색 대표 문서'
          ELSE '정확검색 공통 문서 ' || sequence.value
        END,
        source.rack_slot_id,
        source.rack_face,
        'active',
        'current'
      FROM sequence
      CROSS JOIN (SELECT category_id, rack_slot_id, rack_face FROM documents ORDER BY id LIMIT 1) source;
    `);
    await readyProjection(env);
    const ready = { DB: sqliteD1(database) };

    const firstPage = await getViewerSearchPayload(ready, { q: "정확검색", page: 1, pageSize: 30 });
    assert.equal(firstPage.items.length, 30);
    assert.equal(firstPage.pagination.totalItems, 250);

    const payload = await getViewerSearchPayload(ready, { q: "정확검색", page: 3, pageSize: 30 });
    assert.equal(payload.fallback, false);
    assert.equal(payload.items.length, 30);
    assert.equal(payload.pagination.page, 3);
    assert.equal(payload.pagination.totalItems, 250);
    assert.equal(payload.pagination.totalPages, 9);
    assert.equal(payload.facets.categories.reduce((sum, item) => sum + Number(item.count), 0), 250);
    assert.equal(payload.facets.statuses.find((item) => item.value === "active")?.count, 250);
  } finally {
    database.close();
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

    const ready = { DB: sqliteD1(database) };
    const byName = await getViewerSearchPayload(ready, { q: "projection 즉시", limit: 30 });
    assert.ok(byName.items.some((item) => item.documentNumber === "PRJ-2026-001"));
    const byTag = await getViewerSearchPayload({ DB: sqliteD1(database) }, { q: tag.name, limit: 30 });
    assert.ok(byTag.items.some((item) => item.documentNumber === "PRJ-2026-001"));

    const state = await getSearchProjectionState(env);
    assert.equal(state.ready, true);
    assert.equal(state.pendingDirtyCount, 0);
  } finally {
    database.close();
  }
});

test("개별 등록·개정·CSV 생성 경로는 응답 직후 실제 검색 API에 반영된다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), SESSION_SECRET };
  try {
    await readyProjection(env);

    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash,
        status, role, approved_at, approved_by, must_change_password,
        security_review_required, session_epoch, can_manage_documents
      )
      VALUES (?, ?, ?, ?, 'approved', 'User', CURRENT_TIMESTAMP, 'test-fixture', 0, 0, 0, 1)
    `).run("projection-search-admin@example.com", "즉시 검색 관리자", "s".repeat(32), "h".repeat(64));
    const session = {
      username: "projection-search-admin@example.com",
      displayName: "즉시 검색 관리자",
      role: "Admin"
    };
    const cookie = await createSessionCookie(session, env, false);
    const csrfToken = csrfFromCookie(cookie);
    const source = database.prepare(`
      SELECT category_id, rack_slot_id, rack_face
      FROM documents
      WHERE sync_state = 'current'
      ORDER BY id
      LIMIT 1
    `).get();
    const tag = database.prepare("SELECT id, name FROM tags WHERE is_active = 1 ORDER BY id LIMIT 1").get();
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
      headers: { Cookie: cookie, Origin: "https://archive.example.com" },
      body
    }), env);
    assert.equal(created.status, 302);

    const byName = await worker.fetch(new Request(
      "https://archive.example.com/api/viewer/search?q=" + encodeURIComponent("응답 직후 검색"),
      { headers: { Cookie: cookie, Accept: "application/json" } }
    ), env);
    assert.ok((await byName.json()).items.some((item) => item.documentNumber === "IMM-WORKER-2026-001"));

    const byTag = await worker.fetch(new Request(
      "https://archive.example.com/api/viewer/search?q=" + encodeURIComponent(tag.name),
      { headers: { Cookie: cookie, Accept: "application/json" } }
    ), env);
    assert.ok((await byTag.json()).items.some((item) => item.documentNumber === "IMM-WORKER-2026-001"));

    const createdId = Number((created.headers.get("Location") || "").match(/\/documents\/(\d+)/)?.[1] || 0);
    const createdRow = database.prepare("SELECT updated_at, row_version FROM documents WHERE id = ?").get(createdId);
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
      headers: { Cookie: cookie, Origin: "https://archive.example.com" },
      body: revision
    }), env);
    assert.equal(revised.status, 302);
    const revisedSearch = await worker.fetch(new Request(
      "https://archive.example.com/api/viewer/search?q=" + encodeURIComponent("Rev.1 응답 직후 검색 문서"),
      { headers: { Cookie: cookie, Accept: "application/json" } }
    ), env);
    assert.ok((await revisedSearch.json()).items.some((item) => item.revisionNumber === "Rev.1"));

    const admin = database.prepare("SELECT id FROM app_users WHERE username = ?").get(session.username);
    const importJob = await createDocumentImportJob(env, {
      sourceName: "projection-search.csv",
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
    assert.ok((await imported.json()).createdDocumentId > 0);
    const importedSearch = await worker.fetch(new Request(
      "https://archive.example.com/api/viewer/search?q=" + encodeURIComponent("CSV 응답 직후 검색"),
      { headers: { Cookie: cookie, Accept: "application/json" } }
    ), env);
    assert.ok((await importedSearch.json()).items.some((item) => item.documentNumber === "IMM-CSV-2026-001"));
  } finally {
    database.close();
  }
});

test("정보 수정·위치 이동·폐기·복구는 응답 전에 해당 문서 projection을 배출한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), SESSION_SECRET };
  try {
    await readyProjection(env);
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash,
        status, role, approved_at, approved_by, must_change_password,
        security_review_required, session_epoch
      )
      VALUES (?, ?, ?, ?, 'approved', 'Admin', CURRENT_TIMESTAMP, 'test-fixture', 0, 0, 0)
    `).run("projection-mutation-admin@example.com", "검색 동기화 관리자", "s".repeat(32), "h".repeat(64));
    const session = {
      username: "projection-mutation-admin@example.com",
      displayName: "검색 동기화 관리자",
      role: "Admin"
    };
    const cookie = await createSessionCookie(session, env, false);
    const csrfToken = csrfFromCookie(cookie);
    const source = database.prepare(`
      SELECT d.category_id, d.rack_slot_id, d.rack_face, rs.rack_id
      FROM documents d
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      WHERE d.sync_state = 'current'
      ORDER BY d.id
      LIMIT 1
    `).get();
    const target = database.prepare(`
      SELECT rs.id AS rack_slot_id, rs.rack_id, rs.column_number, rs.shelf_number
      FROM rack_slots rs
      JOIN racks r ON r.id = rs.rack_id
      WHERE rs.is_active = 1 AND r.is_active = 1 AND rs.rack_id != ?
      ORDER BY r.zone_number, r.rack_number, rs.column_number, rs.shelf_number
      LIMIT 1
    `).get(source.rack_id);
    assert.ok(target, "이동 검증용 다른 랙 슬롯이 필요합니다.");
    const tag = database.prepare("SELECT id FROM tags WHERE is_active = 1 ORDER BY id LIMIT 1").get();

    const createBody = new URLSearchParams({
      csrf_token: csrfToken,
      categoryId: String(source.category_id),
      documentNumber: "IMM-MUTATION-2026-001",
      revisionNumber: "Rev.0",
      revisionDate: "2026-07-26",
      disposalDueYear: "2031",
      documentName: "변경 전 즉시 검색 문서",
      rackSlotId: String(source.rack_slot_id),
      rackFace: source.rack_face,
      note: ""
    });
    createBody.append("tagIds", String(tag.id));
    const created = await worker.fetch(new Request("https://archive.example.com/documents", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://archive.example.com" },
      body: createBody
    }), env);
    assert.equal(created.status, 302);
    const documentId = Number((created.headers.get("Location") || "").match(/\/documents\/(\d+)/)?.[1] || 0);
    assert.ok(documentId > 0);
    assert.deepEqual(dirtyRows(database), []);

    const beforeUpdate = database.prepare(
      "SELECT updated_at, row_version FROM documents WHERE id = ?"
    ).get(documentId);
    const editBody = new URLSearchParams({
      csrf_token: csrfToken,
      categoryId: String(source.category_id),
      documentNumber: "IMM-MUTATION-2026-001",
      documentName: "정보 수정 즉시 검색 문서",
      disposalDueYear: "2031",
      note: "수정 후 projection 즉시 반영",
      expectedUpdatedAt: beforeUpdate.updated_at,
      expectedRowVersion: String(beforeUpdate.row_version)
    });
    editBody.append("tagIds", String(tag.id));
    const edited = await worker.fetch(new Request(`https://archive.example.com/documents/${documentId}/edit`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://archive.example.com" },
      body: editBody
    }), env);
    assert.equal(edited.status, 302);
    assert.equal(
      database.prepare("SELECT document_name FROM search_projection_documents WHERE document_id = ?").get(documentId).document_name,
      "정보 수정 즉시 검색 문서"
    );
    assert.deepEqual(dirtyRows(database), []);

    const beforeMove = database.prepare(
      "SELECT updated_at, row_version FROM documents WHERE id = ?"
    ).get(documentId);
    const moved = await worker.fetch(new Request(`https://archive.example.com/documents/${documentId}/move`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://archive.example.com" },
      body: new URLSearchParams({
        csrf_token: csrfToken,
        rackSlotId: String(target.rack_slot_id),
        rackFace: "A",
        reason: "즉시 검색 위치 반영 검증",
        expectedUpdatedAt: beforeMove.updated_at,
        expectedRowVersion: String(beforeMove.row_version)
      })
    }), env);
    assert.equal(moved.status, 302);
    const movedProjection = database.prepare(`
      SELECT rack_id, column_number, shelf_number
      FROM search_projection_documents
      WHERE document_id = ?
    `).get(documentId);
    assert.equal(movedProjection.rack_id, target.rack_id);
    assert.equal(movedProjection.column_number, target.column_number);
    assert.equal(movedProjection.shelf_number, target.shelf_number);
    assert.deepEqual(dirtyRows(database), []);

    const disposed = await worker.fetch(new Request(`https://archive.example.com/documents/${documentId}/dispose`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://archive.example.com" },
      body: new URLSearchParams({ csrf_token: csrfToken, reason: "즉시 검색 폐기 반영 검증" })
    }), env);
    assert.equal(disposed.status, 302);
    assert.equal(
      database.prepare("SELECT status FROM search_projection_documents WHERE document_id = ?").get(documentId).status,
      "disposed"
    );
    assert.deepEqual(dirtyRows(database), []);

    const restored = await worker.fetch(new Request(`https://archive.example.com/documents/${documentId}/restore`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://archive.example.com" },
      body: new URLSearchParams({ csrf_token: csrfToken, reason: "즉시 검색 복구 반영 검증" })
    }), env);
    assert.equal(restored.status, 302);
    assert.equal(
      database.prepare("SELECT status FROM search_projection_documents WHERE document_id = ?").get(documentId).status,
      "active"
    );
    assert.deepEqual(dirtyRows(database), []);
  } finally {
    database.close();
  }
});

test("projection 위치순은 rack code가 아니라 실제 rack number와 선반 내림차순을 따른다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    const firstRack = database.prepare(`
      SELECT
        r.id AS rack_id, r.zone_number, r.rack_number,
        rs.id AS rack_slot_id, rs.column_number, rs.shelf_number
      FROM racks r
      JOIN rack_slots rs ON rs.rack_id = r.id
      WHERE r.is_active = 1 AND rs.is_active = 1
      ORDER BY r.zone_number, r.rack_number, rs.column_number, rs.shelf_number
      LIMIT 1
    `).get();
    const secondRack = database.prepare(`
      SELECT r.id AS rack_id, r.zone_number, r.rack_number, rs.id AS rack_slot_id
      FROM racks r
      JOIN rack_slots rs ON rs.rack_id = r.id
      WHERE r.is_active = 1 AND rs.is_active = 1
        AND r.zone_number = ? AND r.rack_number > ?
      ORDER BY r.rack_number, rs.column_number, rs.shelf_number
      LIMIT 1
    `).get(firstRack.zone_number, firstRack.rack_number);
    assert.ok(secondRack, "같은 구역의 두 번째 랙이 필요합니다.");
    const higherShelf = database.prepare(`
      SELECT id AS rack_slot_id, column_number, shelf_number
      FROM rack_slots
      WHERE rack_id = ? AND is_active = 1
        AND column_number = ? AND shelf_number > ?
      ORDER BY shelf_number DESC
      LIMIT 1
    `).get(firstRack.rack_id, firstRack.column_number, firstRack.shelf_number);
    assert.ok(higherShelf, "같은 랙·열의 더 높은 선반이 필요합니다.");

    database.prepare("UPDATE racks SET code = ? WHERE id = ?").run("ZZ-LOCATION-ORDER", firstRack.rack_id);
    database.prepare("UPDATE racks SET code = ? WHERE id = ?").run("AA-LOCATION-ORDER", secondRack.rack_id);
    const category = database.prepare("SELECT id FROM categories WHERE is_active = 1 ORDER BY id LIMIT 1").get();
    const insert = database.prepare(`
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, revision_date,
        disposal_due_year, document_name, rack_slot_id, rack_face, status, sync_state
      ) VALUES (?, ?, ?, 'Rev.0', '2026-07-26', 2031, ?, ?, 'A', 'active', 'current')
    `);
    insert.run("ARC-LOC-ORDER-LOW", category.id, "LOC-ORDER-LOW", "위치정렬검증 낮은선반", firstRack.rack_slot_id);
    insert.run("ARC-LOC-ORDER-HIGH", category.id, "LOC-ORDER-HIGH", "위치정렬검증 높은선반", higherShelf.rack_slot_id);
    insert.run("ARC-LOC-ORDER-2", category.id, "LOC-ORDER-2", "위치정렬검증 두번째랙", secondRack.rack_slot_id);
    await readyProjection(env);

    const result = await getViewerSearchPayload(env, {
      q: "위치정렬검증",
      sort: "location",
      status: "active",
      pageSize: 30
    });
    assert.deepEqual(
      result.items.map((item) => item.documentNumber),
      ["LOC-ORDER-HIGH", "LOC-ORDER-LOW", "LOC-ORDER-2"],
      "rack code가 역순이어도 rack_number를 따르고 같은 열에서는 높은 선반부터 정렬해야 한다"
    );
  } finally {
    database.close();
  }
});

test("Cron 유지보수는 dirty 배출과 재색인을 예산 안에서 ready까지 전진시킨다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    database.prepare("UPDATE documents SET document_name = ? WHERE id = 1").run("cron 대상 문서");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let pending;
      await worker.scheduled({}, env, { waitUntil(promise) { pending = promise; } });
      await pending;
      const state = await getSearchProjectionState(env);
      if (state.ready && state.pendingDirtyCount === 0) break;
    }

    const state = await getSearchProjectionState(env);
    assert.equal(state.ready, true);
    assert.equal(state.pendingDirtyCount, 0);
    assert.equal(
      database.prepare(
        "SELECT document_name FROM search_projection_documents WHERE document_id = 1"
      ).get().document_name,
      "cron 대상 문서"
    );
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
