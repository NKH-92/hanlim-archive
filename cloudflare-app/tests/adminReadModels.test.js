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
  const searchSql = [];
  const env = {
    DB: fakeDatabase(coreSql, (statement) => {
      if (/FROM d1_migrations/.test(statement)) return { name: "0043_application_mfa.sql" };
      if (/COUNT\(\*\) AS document_count/.test(statement)) {
        return { document_count: 2, estimated_json_bytes: 4096 };
      }
      if (/FROM search_index_state/.test(statement)) {
        return {
          generation: 8,
          rebuild_required: 0,
          indexed_document_count: 2,
          last_rebuilt_at: "2026-07-24 00:00:00",
          updated_at: "2026-07-24 00:00:00",
          source_version: 9
        };
      }
      if (/FROM search_index_outbox/.test(statement)) return { count: 3 };
      throw new Error(`unexpected Core query: ${statement}`);
    }),
    SEARCH_DB: fakeDatabase(searchSql, (statement) => {
      if (/FROM d1_migrations/.test(statement)) {
        return { name: "0003_rebuild_barriers_and_watermarks.sql" };
      }
      if (/FROM search_runtime_state/.test(statement)) {
        return {
          generation: 7,
          indexed_document_count: 1,
          rebuild_status: "building",
          updated_at: "2026-07-24 00:00:00",
          active_generation: 4,
          building_generation: 5,
          v2_ready: 1,
          previous_active_generation: 3
        };
      }
      throw new Error(`unexpected Search query: ${statement}`);
    })
  };
  const session = {
    role: "User",
    username: "auditor@example.com",
    displayName: "감사 담당자",
    csrfToken: "admin-read-model-csrf-token-123456",
    can_view_audit: true
  };

  const result = await loadAdminDashboardReadModel(env, session);

  assert.deepEqual(result.readiness.checks, {
    coreDatabase: false,
    searchDatabase: true,
    searchOperational: false
  });
  assert.equal(result.readiness.ok, false);
  assert.deepEqual(result.readiness.migrations.core, {
    current: "0043_application_mfa.sql",
    expected: "0046_app_user_team.sql",
    ready: false
  });
  assert.deepEqual(result.readiness.search, {
    generation: 8,
    searchGeneration: 7,
    activeGeneration: 4,
    indexedDocumentCount: 2,
    searchIndexedDocumentCount: 1,
    pendingOutboxCount: 3,
    searchAvailable: true,
    rebuildRequired: false,
    rebuildStatus: "building",
    v2Ready: true
  });
  assert.equal(result.searchIndex.readiness, result.readiness);
  assert.equal(result.searchIndex.level, "warning");
  assert.equal(coreSql.length, 4);
  assert.equal(searchSql.length, 2);

  const html = await adminDashboardPage({ session, ...result }).text();
  assert.match(html, /검색 운영 확인 필요/);
  assert.match(html, /Core migration 미충족 · Search migration 충족/);
  assert.match(html, /generation 8\/7 · active 4/);
  assert.match(html, /indexed 2\/1 · outbox 3건 · rebuild building/);
});

function fakeDatabase(sql, first) {
  return {
    prepare(statement) {
      sql.push(statement);
      return { first: async () => first(statement) };
    }
  };
}
