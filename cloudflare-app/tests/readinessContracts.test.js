import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const ORIGIN = "https://archive.example.com";
const CORE_MIGRATION = "0048_core_search_projection.sql";
const SEARCH_MIGRATION = "0003_rebuild_barriers_and_watermarks.sql";

test("/readyz는 Core D1 schema가 기대 migration에 도달하면 공개 최소 body와 200을 반환한다", async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/readyz`), readyEnv());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.deepEqual(await response.json(), {
    ok: true,
    workerVersion: "ready-worker-v1"
  });
});

test("/readyz HEAD는 준비 판정을 유지하면서 본문을 제거한다", async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/readyz`, { method: "HEAD" }), readyEnv());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), "");
});

test("/readyz는 요구 migration 이후의 additive migration도 rollback 호환 상태로 인정한다", async () => {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/readyz`),
    readyEnv({ coreMigration: "0049_future_additive.sql", searchMigration: "0004_future_additive.sql" })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    workerVersion: "ready-worker-v1"
  });
});

test("/readyz는 Core D1 migration이 뒤처지면 상세 상태 없이 503으로 닫힌다", async () => {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/readyz`),
    readyEnv({ coreMigration: "0040_ten_thousand_operational_transition.sql" })
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    workerVersion: "ready-worker-v1"
  });
});

// 검색 색인은 Core에서 재구축 가능한 파생 데이터다. 동기화 지연을 배포 게이트로 쓰면
// 파생 데이터 지연이 곧 서비스 중단 판정이 되어 격리 목적과 반대로 작동한다.
// 아래 상태들은 /readyz를 닫지 않고 관리자 화면 경고로만 노출한다.
test("/readyz는 파생 검색 색인의 지연·재구축·불일치를 준비 실패로 올리지 않는다", async (context) => {
  for (const options of [
    { rebuildRequired: 1 },
    { rebuildStatus: "building" },
    { pendingOutboxCount: 1 },
    { searchGeneration: 7 },
    { searchIndexedDocumentCount: 1 },
    { searchMigration: "0001_search_index.sql" },
    { projectionReindexStatus: "pending" },
    { projectionDirtyCount: 12 },
    { projectionAvailable: false }
  ]) {
    await context.test(JSON.stringify(options), async () => {
      const response = await worker.fetch(new Request(`${ORIGIN}/readyz`), readyEnv(options));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        workerVersion: "ready-worker-v1"
      });
    });
  }
});

test("/readyz는 일치하는 기존 검색 인덱스를 v2 백그라운드 전환 중에도 준비 상태로 인정한다", async () => {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/readyz`),
    readyEnv({ v2Ready: 0 })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    workerVersion: "ready-worker-v1"
  });
});

test("/readyz는 SEARCH_DB binding이 없어도 Core가 준비되면 200을 유지한다", async () => {
  const env = readyEnv();
  delete env.SEARCH_DB;
  const response = await worker.fetch(new Request(`${ORIGIN}/readyz`), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    workerVersion: "ready-worker-v1"
  });
});

test("/readyz는 Core D1 오류를 노출하지 않고 workerVersion만 포함한 503을 반환한다", async () => {
  const env = readyEnv();
  env.DB = {
    prepare() {
      return { first() { throw new Error("core down"); } };
    }
  };
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
  const projectionState = options.projectionAvailable === false ? null : {
    indexed_document_count: 2,
    reindex_status: options.projectionReindexStatus || "ready",
    reindex_cursor: 0,
    last_reindexed_at: "2026-07-26 00:00:00",
    updated_at: "2026-07-26 00:00:00"
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
      if (/FROM search_projection_state/.test(sql)) return projectionState;
      if (/FROM search_projection_dirty/.test(sql)) return { count: options.projectionDirtyCount ?? 0 };
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
