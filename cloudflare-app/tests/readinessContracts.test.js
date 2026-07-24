import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const ORIGIN = "https://archive.example.com";
const CORE_MIGRATION = "0043_release_identity_and_search_leases.sql";
const SEARCH_MIGRATION = "0003_rebuild_barriers_and_watermarks.sql";

test("/readyz는 Core·Search migration과 검색 운영 상태가 모두 준비되면 버전 포함 200을 반환한다", async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/readyz`), readyEnv());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.deepEqual(await response.json(), {
    ok: true,
    workerVersion: "ready-worker-v1",
    checks: {
      coreDatabase: true,
      searchDatabase: true,
      searchOperational: true
    },
    search: {
      generation: 8,
      activeGeneration: 4,
      indexedDocumentCount: 2,
      pendingOutboxCount: 0
    }
  });
});

test("/readyz HEAD는 준비 판정을 유지하면서 본문을 제거한다", async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/readyz`, { method: "HEAD" }), readyEnv());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), "");
});

test("/readyz는 어느 D1 migration이 뒤처져도 503으로 닫힌다", async (context) => {
  for (const options of [
    { coreMigration: "0040_ten_thousand_operational_transition.sql" },
    { searchMigration: "0001_search_index.sql" }
  ]) {
    await context.test(JSON.stringify(options), async () => {
      const response = await worker.fetch(new Request(`${ORIGIN}/readyz`), readyEnv(options));
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.ok, false);
      assert.equal(Object.values(body.checks).every(Boolean), false);
    });
  }
});

test("/readyz는 검색 재구축·outbox·세대 불일치 상태를 503으로 판정한다", async (context) => {
  for (const options of [
    { rebuildRequired: 1 },
    { rebuildStatus: "building" },
    { pendingOutboxCount: 1 },
    { searchGeneration: 7 },
    { searchIndexedDocumentCount: 1 },
    { v2Ready: 0 }
  ]) {
    await context.test(JSON.stringify(options), async () => {
      const response = await worker.fetch(new Request(`${ORIGIN}/readyz`), readyEnv(options));
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.checks.coreDatabase, true);
      assert.equal(body.checks.searchDatabase, true);
      assert.equal(body.checks.searchOperational, false);
    });
  }
});

test("/readyz는 binding 오류를 노출하지 않고 workerVersion만 포함한 503을 반환한다", async () => {
  const env = readyEnv();
  delete env.SEARCH_DB;
  const response = await worker.fetch(new Request(`${ORIGIN}/readyz`), env);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    workerVersion: "ready-worker-v1"
  });
});

function readyEnv(options = {}) {
  const coreMigration = options.coreMigration || CORE_MIGRATION;
  const searchMigration = options.searchMigration || SEARCH_MIGRATION;
  const coreState = {
    generation: 8,
    rebuild_required: options.rebuildRequired ?? 0,
    indexed_document_count: 2,
    last_rebuilt_at: "2026-07-24 00:00:00",
    updated_at: "2026-07-24 00:00:00"
  };
  const searchState = {
    generation: options.searchGeneration ?? 8,
    indexed_document_count: options.searchIndexedDocumentCount ?? 2,
    rebuild_status: options.rebuildStatus || "ready",
    updated_at: "2026-07-24 00:00:00",
    active_generation: 4,
    building_generation: null,
    building_last_document_id: 0,
    v2_ready: options.v2Ready ?? 1,
    previous_active_generation: 3,
    building_source_generation: null,
    rebuild_token: null,
    cutover_generation: null
  };

  return {
    CF_VERSION_METADATA: { id: "ready-worker-v1" },
    DB: fakeDatabase((sql) => {
      if (/FROM d1_migrations/.test(sql)) return { name: coreMigration };
      if (/FROM search_index_state/.test(sql)) return coreState;
      if (/FROM search_index_outbox/.test(sql)) return { count: options.pendingOutboxCount ?? 0 };
      throw new Error(`unexpected Core query: ${sql}`);
    }),
    SEARCH_DB: fakeDatabase((sql) => {
      if (/FROM d1_migrations/.test(sql)) return { name: searchMigration };
      if (/FROM search_runtime_state/.test(sql)) return searchState;
      throw new Error(`unexpected Search query: ${sql}`);
    })
  };
}

function fakeDatabase(first) {
  return {
    prepare(sql) {
      return { first: () => first(sql) };
    }
  };
}
