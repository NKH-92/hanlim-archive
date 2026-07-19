import assert from "node:assert/strict";
import test from "node:test";

import {
  createSystemAuditStatement,
  getSystemAuditPage,
  normalizeAuditFilters
} from "../src/domains/audit/index.js";
import { auditPage } from "../src/domains/audit/index.js";

test("createSystemAuditStatement는 행위자·권한 snapshot과 pre-state guard를 함께 바인딩한다", () => {
  const env = statementEnv();
  const statement = createSystemAuditStatement(env, {
    entityType: "user",
    entityId: 7,
    entityReference: "viewer",
    action: "disable",
    actor: {
      userId: 1,
      username: "admin",
      displayName: "관리자",
      role: "Admin"
    },
    summary: "사용자 사용중지",
    details: { before: { status: "approved" }, after: { status: "disabled" } }
  }, {
    guardSql: "FROM app_users WHERE id = ? AND status = ?",
    guardBinds: [7, "approved"]
  });

  assert.match(statement.sql, /INSERT INTO system_audit_logs/);
  assert.match(statement.sql, /FROM app_users WHERE id = \? AND status = \?/);
  assert.deepEqual(statement.args.slice(0, 7), ["user", "7", "viewer", "disable", 1, "admin", "관리자"]);
  assert.deepEqual(statement.args.slice(-2), [7, "approved"]);
  assert.match(statement.args[7], /can_manage_documents/);
  assert.match(statement.args[9], /"status":"disabled"/);
});

test("getSystemAuditPage는 모든 필터에 COUNT와 LIMIT/OFFSET을 적용한다", async () => {
  const env = statementEnv({
    batchResults: [
      { results: [{ total: 31 }] },
      { results: [{ id: 31, entity_type: "user", action: "disable" }] }
    ]
  });
  const result = await getSystemAuditPage(env, {
    from: "2026-07-01",
    to: "2026-07-17",
    actor: "admin",
    entityType: "user",
    action: "disable",
    reference: "viewer"
  }, 2, 30);

  assert.equal(env.state.batches.length, 1);
  const [count, rows] = env.state.batches[0];
  assert.match(count.sql, /COUNT\(\*\)/);
  assert.match(count.sql, /actor_username_snapshot LIKE/);
  assert.match(rows.sql, /ORDER BY created_at DESC, id DESC[\s\S]*LIMIT \? OFFSET \?/);
  assert.deepEqual(rows.args.slice(-2), [30, 30]);
  assert.equal(result.pagination.totalItems, 31);
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.items.length, 1);
});

test("normalizeAuditFilters는 URLSearchParams 별칭을 보존한다", () => {
  const filters = normalizeAuditFilters(new URLSearchParams("entity_type=rack&q=1-03&actor=%EA%B4%80%EB%A6%AC%EC%9E%90"));
  assert.deepEqual(filters, {
    from: "",
    to: "",
    actor: "관리자",
    entityType: "rack",
    action: "",
    reference: "1-03"
  });
});

test("auditPage는 변경 전후를 표로 표시하고 사용자 값을 escape한다", async () => {
  const response = auditPage({
    session: { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf".repeat(8) },
    items: [{
      id: 1,
      entity_type: "user",
      entity_id: "7",
      entity_reference: "viewer<script>",
      action: "permissions_update",
      actor_username_snapshot: "admin",
      actor_display_name_snapshot: "관리자",
      summary: "사용자 권한 변경",
      details_json: JSON.stringify({
        before: { status: "approved", permissions: { can_view_audit: false } },
        after: { status: "approved", permissions: { can_view_audit: true } }
      }),
      created_at: "2026-07-17 10:00:00"
    }],
    filters: {},
    pagination: { page: 1, pageSize: 30, totalItems: 1, totalPages: 1 }
  });
  const html = await response.text();

  assert.match(html, /전역 감사로그/);
  assert.match(html, /변경 전후/);
  assert.match(html, /권한/);
  assert.doesNotMatch(html, /viewer<script>/);
  assert.match(html, /viewer&lt;script&gt;/);
});

function statementEnv({ batchResults = [] } = {}) {
  const state = { batches: [] };
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind(...nextArgs) {
      return statement(sql, nextArgs);
    }
  });
  return {
    state,
    DB: {
      prepare: (sql) => statement(sql),
      async batch(statements) {
        state.batches.push(statements);
        return batchResults;
      }
    }
  };
}
