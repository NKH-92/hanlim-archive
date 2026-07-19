import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("0021 migration은 disabled, 7개 권한, 전역 감사와 안정적 행위자 컬럼을 추가한다", async () => {
  const sql = await readFile(new URL("../migrations/0021_permissions_and_system_audit.sql", import.meta.url), "utf8");
  const permissionColumns = [
    "can_manage_documents",
    "can_move_documents",
    "can_manage_disposals",
    "can_manage_sets",
    "can_manage_masters",
    "can_manage_users",
    "can_view_audit"
  ];

  assert.match(sql, /status IN \('pending', 'approved', 'rejected', 'disabled'\)/);
  for (const column of permissionColumns) {
    assert.match(sql, new RegExp(`${column} INTEGER NOT NULL DEFAULT 0`));
  }
  assert.match(sql, /CASE WHEN role = 'Admin' THEN 1 ELSE 0 END/);
  assert.match(sql, /CREATE TABLE system_audit_logs/);
  assert.match(sql, /CREATE INDEX idx_system_audit_entity/);
  assert.match(sql, /CREATE TRIGGER trg_system_audit_logs_no_update/);
  assert.match(sql, /CREATE TRIGGER trg_system_audit_logs_no_delete/);
  assert.match(sql, /ALTER TABLE document_audit_logs ADD COLUMN actor_user_id INTEGER/);
  assert.match(sql, /ALTER TABLE document_audit_logs ADD COLUMN actor_username TEXT/);
  assert.doesNotMatch(sql, /actor_user_id[^;]*REFERENCES app_users/is);
});

test("0021 migration은 기존 Admin을 보존하고 disabled 사용자를 저장할 수 있다", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of [
    "0001_initial.sql",
    "0002_app_users.sql",
    "0003_document_audit_logs.sql",
    "0006_app_user_roles_and_admin.sql"
  ]) {
    db.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  db.prepare(`
    INSERT INTO app_users (username, display_name, password_salt, password_hash, status, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("admin", "관리자", "salt", "hash", "approved", "Admin");

  db.exec(await readFile(new URL("../migrations/0021_permissions_and_system_audit.sql", import.meta.url), "utf8"));
  db.prepare(`
    INSERT INTO app_users (username, display_name, password_salt, password_hash, status, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("disabled-user", "중지 사용자", "salt", "hash", "disabled", "User");

  const admin = db.prepare(`
    SELECT can_manage_documents, can_move_documents, can_manage_disposals,
           can_manage_sets, can_manage_masters, can_manage_users, can_view_audit
    FROM app_users WHERE username = 'admin'
  `).get();
  assert.deepEqual(Object.values(admin), [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(db.prepare("SELECT status FROM app_users WHERE username = 'disabled-user'").get().status, "disabled");
  assert.ok(db.prepare("PRAGMA table_info(document_audit_logs)").all().some((column) => column.name === "actor_user_id"));
  db.close();
});
