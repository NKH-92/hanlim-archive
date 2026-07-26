import assert from "node:assert/strict";
import test from "node:test";

import { loadAdminDashboardReadModel } from "../src/readModels/adminDashboard.js";
import { adminDashboardPage } from "../src/views/adminViews.js";

test("관리자 dashboard read model은 권한 없는 query를 실행하지 않는다", async () => {
  let calls = 0;
  const env = { DB: { prepare() { calls += 1; throw new Error("unexpected query"); } } };

  const result = await loadAdminDashboardReadModel(env, { role: "User" });

  assert.deepEqual(result, { pendingCount: 0, quality: null, searchIndex: null });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(calls, 0);
});

test("사용자 관리 권한은 pending 계정 수만 조회한다", async () => {
  const sql = [];
  const env = {
    DB: {
      prepare(statement) {
        sql.push(statement);
        return {
          async all() {
            return { results: [{ status: "pending" }, { status: "approved" }, { status: "pending" }] };
          }
        };
      }
    }
  };

  const result = await loadAdminDashboardReadModel(env, { role: "User", can_manage_users: true });

  assert.equal(result.pendingCount, 2);
  assert.equal(result.quality, null);
  assert.equal(result.searchIndex, null);
  assert.equal("readiness" in result, false);
  assert.equal(sql.length, 1);
  assert.match(sql[0], /FROM app_users/);
});

test("감사조회 권한은 readiness 상세 상태를 관리자 read model과 실제 화면에 노출한다", async () => {
  const coreSql = [];
  const env = {
    DB: fakeDatabase(coreSql, (statement) => {
      if (/FROM d1_migrations/.test(statement)) return { name: "0043_application_mfa.sql" };
      if (/FROM search_projection_state/.test(statement)) {
        return {
          indexed_document_count: 2,
          reindex_status: "ready",
          reindex_cursor: 0,
          last_reindexed_at: "2026-07-26 00:00:00",
          updated_at: "2026-07-26 00:00:00"
        };
      }
      if (/FROM search_projection_dirty/.test(statement)) return { count: 0 };
      throw new Error(`unexpected Core query: ${statement}`);
    }),
  };
  const session = {
    role: "User",
    username: "auditor@example.com",
    displayName: "감사 담당자",
    csrfToken: "admin-read-model-csrf-token-123456",
    can_view_audit: true
  };

  const result = await loadAdminDashboardReadModel(env, session);

  // 필수 판정은 Core schema뿐이고 파생 색인 상태는 warnings로만 노출한다.
  assert.deepEqual(result.readiness.checks, { coreDatabase: false });
  assert.deepEqual(result.readiness.warnings, { searchProjectionSynced: true });
  assert.equal(result.readiness.ok, false);
  assert.equal(result.readiness.degraded, false);
  assert.deepEqual(result.readiness.projection, {
    available: true,
    reindexStatus: "ready",
    indexedDocumentCount: 2,
    pendingDirtyCount: 0,
    lastReindexedAt: "2026-07-26 00:00:00"
  });
  assert.deepEqual(result.readiness.migrations.core, {
    current: "0043_application_mfa.sql",
    expected: "0048_core_search_projection.sql",
    ready: false
  });
  assert.equal("search" in result.readiness, false, "legacy Search D1 상태는 더 이상 노출하지 않는다");
  assert.equal(result.searchIndex.readiness, result.readiness);
  assert.equal(result.searchIndex.level, "warning");
  assert.equal(coreSql.length, 3);
  assert.equal(coreSql.some((statement) => /FROM documents\b/.test(statement)), false, "검색 상태 패널이 문서 전체 scan을 추가하면 안 된다");

  const html = await adminDashboardPage({ session, ...result }).text();
  assert.match(html, /검색 운영 확인 필요/);
  assert.match(html, /Core migration 미충족/);
  assert.match(html, /projection ready · 색인 2건 · dirty 0건/);
  assert.doesNotMatch(html, /outbox/);
});

function fakeDatabase(sql, first) {
  return {
    prepare(statement) {
      sql.push(statement);
      return { first: async () => first(statement) };
    }
  };
}
