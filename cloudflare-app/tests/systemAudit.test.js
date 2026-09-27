import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

  assert.match(html, /<h1>감사 이력<\/h1>/);
  // 대상·동작 조건은 영문 저장값을 직접 입력하지 않고 한국어 목록에서 고른다.
  assert.match(html, /<select name="entityType"><option value="">전체<\/option>[\s\S]*<option value="user">사용자<\/option>/);
  assert.match(html, /<select name="action"><option value="">전체<\/option>[\s\S]*<option value="permissions_update">권한 변경<\/option>/);
  assert.doesNotMatch(html, /placeholder="user, rack|placeholder="approve, update/);
  assert.match(html, /변경 전후/);
  assert.match(html, /권한/);
  assert.doesNotMatch(html, /viewer<script>/);
  assert.match(html, /viewer&lt;script&gt;/);
});

test("감사 이력 필터는 코드와 migration이 기록하는 모든 대상·동작을 한국어 선택지로 제공한다", async () => {
  const emitted = emittedAuditValues();
  // 수집이 비면 대조가 무의미하므로 삼항·지역 변수·SQL 리터럴·migration으로 기록하는 값을 찾는지 먼저 확인한다.
  for (const action of ["clone", "lock", "unlock", "exclude", "include", "prepare", "validation_failed", "stale", "profile_update"]) {
    assert.ok(emitted.actions.has(action), `${action} 동작을 수집해야 한다`);
  }
  for (const entityType of ["user", "category", "tag", "document_set", "document_snapshot"]) {
    assert.ok(emitted.entities.has(entityType), `${entityType} 대상을 수집해야 한다`);
  }

  const html = await auditPage({
    session: { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "csrf".repeat(8) },
    items: [],
    filters: {},
    pagination: { page: 1, pageSize: 30, totalItems: 0, totalPages: 1 }
  }).text();
  const options = (name) => {
    const select = new RegExp(`<select name="${name}">([\\s\\S]*?)</select>`).exec(html)?.[1] ?? "";
    return new Map([...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((match) => [match[1], match[2]]));
  };
  for (const [name, values] of [["action", emitted.actions], ["entityType", emitted.entities]]) {
    const choices = options(name);
    for (const value of values) {
      assert.ok(choices.has(value), `${name} 선택지에 ${value}가 있어야 한다`);
      assert.notEqual(choices.get(value), value, `${name} ${value}는 한국어 이름으로 보여야 한다`);
    }
  }
});

// system_audit_logs에 기록하는 대상·동작 값을 도메인 소스와 migration에서 모은다.
function emittedAuditValues() {
  const actions = new Set();
  const entities = new Set();
  const domainsDirectory = new URL("../src/domains/", import.meta.url);
  const migrationsDirectory = new URL("../migrations/", import.meta.url);
  const sources = [
    ...readdirSync(domainsDirectory, { recursive: true })
      .map((name) => String(name).replaceAll("\\", "/"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(new URL(name, domainsDirectory), "utf8")),
    ...readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(new URL(name, migrationsDirectory), "utf8"))
  ];
  for (const source of sources) {
    // 대상 이름은 masters처럼 domain 정책 객체에 둘 수 있어 모든 도메인 파일에서 찾는다.
    for (const match of source.matchAll(/\bentityType:\s*"([a-z_]+)"/g)) entities.add(match[1]);
    if (!/system_audit_logs|createSystemAuditStatement|systemSnapshotAuditStatement/.test(source)) continue;
    for (const match of source.matchAll(/\b(?:action|auditAction):\s*"([a-z_]+)"/g)) actions.add(match[1]);
    for (const match of source.matchAll(/\baction:\s*[^,\n]*?\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)) actions.add(match[1]).add(match[2]);
    for (const match of source.matchAll(/\bconst action = ([^;]+);/g)) {
      for (const value of match[1].matchAll(/"([a-z_]+)"/g)) actions.add(value[1]);
    }
    for (const match of source.matchAll(/function auditAction\([^)]*\)\s*\{([^}]*)\}/g)) {
      for (const value of match[1].matchAll(/"([a-z_]+)"/g)) actions.add(value[1]);
    }
    for (const match of source.matchAll(/systemSnapshotAuditStatement\(env,\s*\w+,\s*"([a-z_]+)"/g)) actions.add(match[1]);
    for (const match of source.matchAll(/INSERT INTO system_audit_logs\s*\(([^)]*)\)\s*SELECT\s+([\s\S]*?)\bFROM\b/g)) {
      const columns = match[1].split(",").map((column) => column.trim());
      const values = splitSelectList(match[2]);
      const literal = (column) => /^'([a-z_]+)'$/.exec(values[columns.indexOf(column)] ?? "")?.[1];
      if (literal("action")) actions.add(literal("action"));
      if (literal("entity_type")) entities.add(literal("entity_type"));
    }
  }
  return { actions, entities };
}

// SELECT 목록을 괄호·문자열 밖의 쉼표로만 나눈다('DSP-' || printf('%04d', id) 같은 식을 한 값으로 둔다).
function splitSelectList(list) {
  const items = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of list) {
    if (char === "'") quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

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
