import assert from "node:assert/strict";
import test from "node:test";

import { getAppUsers } from "../src/data/usersData.js";
import {
  applyRoleTemplateToUsers,
  getRoleTemplates,
  updateRoleTemplate
} from "../src/data/roleTemplatesData.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

const actor = {
  userId: 1,
  username: "admin",
  displayName: "관리자",
  role: "Admin"
};

test("0045는 역할 템플릿 3종과 고정 시스템관리 역할을 구성한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = { DB: sqliteD1(database) };
    const templates = await getRoleTemplates(env);
    assert.deepEqual(templates.map(({ key }) => key), ["viewer", "document_manager", "system_admin"]);
    assert.equal(templates.find(({ key }) => key === "system_admin").fixed, true);
    assert.throws(() => database.prepare(`
      UPDATE user_role_templates SET label = '변조' WHERE key = 'system_admin'
    `).run(), /수정할 수 없습니다/);
  } finally {
    database.close();
  }
});

test("역할 템플릿 편집은 감사 INSERT와 row_version OCC를 한 batch로 적용한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = { DB: sqliteD1(database) };
    const result = await updateRoleTemplate(env, "viewer", {
      label: "열람",
      expectedRowVersion: 1,
      permissions: { can_view_audit: true }
    }, actor);
    assert.equal(result.ok, true);

    const template = database.prepare(`
      SELECT label, can_view_audit, row_version, updated_by
      FROM user_role_templates WHERE key = 'viewer'
    `).get();
    assert.deepEqual({ ...template }, {
      label: "열람",
      can_view_audit: 1,
      row_version: 2,
      updated_by: "admin"
    });
    const audit = database.prepare(`
      SELECT action, details_json FROM system_audit_logs
      WHERE entity_type = 'user_role_template' AND entity_id = 'viewer'
      ORDER BY id DESC LIMIT 1
    `).get();
    assert.equal(audit.action, "role_template_update");
    assert.equal(JSON.parse(audit.details_json).after.rowVersion, 2);

    const stale = await updateRoleTemplate(env, "viewer", {
      label: "오래된 변경",
      expectedRowVersion: 1,
      permissions: {}
    }, actor);
    assert.equal(stale.ok, false);
    assert.equal(stale.stale, true);
  } finally {
    database.close();
  }
});

test("명시적 역할 일괄 반영은 사용자별 감사와 N명 OCC를 원자적으로 적용한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const insert = database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role,
        role_template_key, row_version
      ) VALUES (?, ?, 'salt', 'hash', 'approved', 'User', 'viewer', 1)
    `);
    insert.run("bulk-one", "일괄 1");
    insert.run("bulk-two", "일괄 2");
    const users = database.prepare(`
      SELECT id, row_version FROM app_users WHERE username IN ('bulk-one', 'bulk-two') ORDER BY id
    `).all();
    const env = { DB: sqliteD1(database) };
    const result = await applyRoleTemplateToUsers(env, "document_manager", users.map((user) => ({
      id: Number(user.id),
      expectedRowVersion: Number(user.row_version)
    })), actor, 1);
    assert.deepEqual(result, { ok: true, appliedCount: 2 });

    const applied = database.prepare(`
      SELECT role_template_key, can_manage_documents, can_move_documents,
        can_manage_disposals, can_manage_sets, row_version
      FROM app_users WHERE username IN ('bulk-one', 'bulk-two') ORDER BY username
    `).all();
    assert.equal(applied.length, 2);
    assert.equal(applied.every((user) => (
      user.role_template_key === "document_manager"
      && user.can_manage_documents === 1
      && user.can_move_documents === 1
      && user.can_manage_disposals === 1
      && user.can_manage_sets === 1
      && user.row_version === 2
    )), true);
    const auditCount = database.prepare(`
      SELECT COUNT(*) AS count FROM system_audit_logs
      WHERE action = 'role_template_apply'
        AND entity_id IN (${users.map(() => "?").join(", ")})
    `).get(...users.map(({ id }) => String(id))).count;
    assert.equal(auditCount, 2);

    const stale = await applyRoleTemplateToUsers(env, "viewer", [{
      id: Number(users[0].id),
      expectedRowVersion: 1
    }], actor, 1);
    assert.equal(stale.ok, false);
    assert.equal(stale.stale, true);
    assert.equal(database.prepare("SELECT role_template_key FROM app_users WHERE id = ?").get(users[0].id).role_template_key, "document_manager");

    database.prepare(`
      UPDATE user_role_templates
      SET label = '변경된 조회', row_version = row_version + 1
      WHERE key = 'viewer'
    `).run();
    const templateStale = await applyRoleTemplateToUsers(env, "viewer", [{
      id: Number(users[0].id),
      expectedRowVersion: 2
    }], actor, 1);
    assert.equal(templateStale.ok, false);
    assert.equal(templateStale.stale, true);
    assert.equal(database.prepare("SELECT role_template_key FROM app_users WHERE id = ?").get(users[0].id).role_template_key, "document_manager");

    database.prepare(`
      UPDATE user_role_templates
      SET can_manage_sets = 0, row_version = row_version + 1
      WHERE key = 'document_manager'
    `).run();
    const displayedUser = (await getAppUsers(env)).find(({ id }) => Number(id) === Number(users[0].id));
    assert.equal(displayedUser.role_template_key, "document_manager");
    assert.equal(displayedUser.role_template_label, null);
  } finally {
    database.close();
  }
});
