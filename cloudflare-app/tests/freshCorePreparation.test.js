import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildIdentityCopyBatch } from "../../.github/scripts/prepare-fresh-core.mjs";

test("fresh Core identity copy는 credential을 SQL에 넣지 않고 4문장 원자 bulk plan을 만든다", () => {
  const users = [
    { id: 5, username: "admin@example.com", password_hash: "secret-verifier", must_change_password: 0 },
    { id: 51, username: "reader@example.com", password_hash: "reader-verifier", must_change_password: 1 }
  ];
  const templates = [
    { key: "reader", label: "조회", can_manage_documents: 0 },
    { key: "manager", label: "관리", can_manage_documents: 1 }
  ];
  const plan = buildIdentityCopyBatch({
    sourceUsers: users,
    userColumns: ["id", "username", "password_hash", "must_change_password"],
    roleTemplates: templates,
    templateColumns: ["key", "label", "can_manage_documents"]
  });

  assert.equal(plan.length, 4);
  assert.match(plan[1].sql, /FROM json_each\(\?\)/);
  assert.doesNotMatch(plan[1].sql, /secret-verifier|admin@example\.com/);
  assert.equal(plan[1].params.length, 1);

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
    INSERT INTO user_role_templates VALUES ('seed', '시드', 0);
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
    [...templates].sort((a, b) => a.key.localeCompare(b.key))
  );
});
