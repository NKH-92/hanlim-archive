import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const ORIGIN = "https://archive.example.com";
const CORE_MIGRATION = "0048_core_search_projection.sql";

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
    readyEnv({ coreMigration: "0049_future_additive.sql" })
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

// 검색 projection은 Core 권위 데이터에서 재구축 가능한 파생 색인이다. 동기화 지연을 배포 게이트로 쓰면
// 파생 데이터 지연이 곧 서비스 중단 판정이 되어 격리 목적과 반대로 작동한다.
// 아래 상태들은 /readyz를 닫지 않고 관리자 화면 경고로만 노출한다.
test("/readyz는 파생 검색 색인의 지연·재색인·부재를 준비 실패로 올리지 않는다", async (context) => {
  for (const options of [
    { projectionReindexStatus: "pending" },
    { projectionReindexStatus: "running" },
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

test("/readyz는 Core D1 하나만 조회하고 검색 전용 binding을 요구하지 않는다", async () => {
  const queries = [];
  const env = readyEnv();
  const core = env.DB;
  env.DB = {
    prepare(sql) {
      queries.push(sql);
      return core.prepare(sql);
    }
  };

  const response = await worker.fetch(new Request(`${ORIGIN}/readyz`), env);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(env).filter((key) => /^SEARCH/.test(key)), []);
  assert.equal(queries.length, 3);
  assert.ok(queries.some((sql) => /FROM d1_migrations/.test(sql)));
  assert.ok(queries.some((sql) => /FROM search_projection_state/.test(sql)));
  assert.ok(queries.some((sql) => /FROM search_projection_dirty/.test(sql)));
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
  const projectionState = options.projectionAvailable === false ? null : {
    indexed_document_count: 2,
    reindex_status: options.projectionReindexStatus || "ready",
    reindex_cursor: 0,
    last_reindexed_at: "2026-07-26 00:00:00",
    updated_at: "2026-07-26 00:00:00"
  };

  return {
    CF_VERSION_METADATA: { id: "ready-worker-v1" },
    DB: fakeDatabase((sql) => {
      if (/FROM d1_migrations/.test(sql)) return { name: coreMigration };
      if (/FROM search_projection_state/.test(sql)) return projectionState;
      if (/FROM search_projection_dirty/.test(sql)) return { count: options.projectionDirtyCount ?? 0 };
      throw new Error(`unexpected Core query: ${sql}`);
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
