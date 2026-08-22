import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildIdentityCopyBatch } from "../../.github/scripts/prepare-fresh-core.mjs";

test("fresh Core identity copy는 보호된 역할 템플릿을 건드리지 않고 2문장 원자 bulk plan을 만든다", () => {
  const users = [
    { id: 5, username: "admin@example.com", password_hash: "secret-verifier", must_change_password: 0 },
    { id: 51, username: "reader@example.com", password_hash: "reader-verifier", must_change_password: 1 }
  ];
  const plan = buildIdentityCopyBatch({
    sourceUsers: users,
    userColumns: ["id", "username", "password_hash", "must_change_password"]
  });

  assert.equal(plan.length, 2);
  assert.match(plan[1].sql, /FROM json_each\(\?\)/);
  assert.doesNotMatch(plan[1].sql, /secret-verifier|admin@example\.com/);
  assert.equal(plan[1].params.length, 1);
  assert.equal(plan.some((statement) => /user_role_templates/.test(statement.sql)), false);

  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE app_users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL
    );
    CREATE TABLE user_role_templates (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      can_manage_documents INTEGER NOT NULL
    );
    INSERT INTO app_users VALUES (1, 'seed@example.com', 'seed', 1);
    INSERT INTO user_role_templates VALUES ('system_admin', '시스템관리', 1);
    CREATE TRIGGER trg_system_role_template_no_delete
    BEFORE DELETE ON user_role_templates
    WHEN OLD.key = 'system_admin'
    BEGIN
      SELECT RAISE(ABORT, '시스템관리 역할 템플릿은 삭제할 수 없습니다.');
    END;
  `);
  db.exec("BEGIN");
  try {
    for (const statement of plan) db.prepare(statement.sql).run(...statement.params);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  assert.deepEqual(
    db.prepare("SELECT id, username, password_hash, must_change_password FROM app_users ORDER BY id").all().map((row) => ({ ...row })),
    users
  );
  assert.deepEqual(
    db.prepare("SELECT key, label, can_manage_documents FROM user_role_templates ORDER BY key").all().map((row) => ({ ...row })),
    [{ key: "system_admin", label: "시스템관리", can_manage_documents: 1 }]
  );
});
