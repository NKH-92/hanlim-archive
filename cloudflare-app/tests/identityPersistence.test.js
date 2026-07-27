import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRoleTemplateToUsers,
  deleteUser,
  disableUser,
  enableUser,
  getAppUsers,
  getRoleTemplates,
  rejectUser,
  resetUserPassword,
  updateRoleTemplate,
  updateUserPermissions
} from "../src/domains/identity/index.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

const actor = {
  userId: 1,
  username: "admin",
  displayName: "관리자",
  role: "Admin"
};

test("역할 템플릿 schema는 3종과 고정 시스템관리 역할을 구성한다", async () => {
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

test("역할 일괄 반영은 승인되지 않은 계정을 대상에서 거부한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = { DB: sqliteD1(database) };
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role, row_version
      ) VALUES ('not-approved', '대기', 'salt', 'hash', 'pending', 'User', 1)
    `).run();
    const pending = database.prepare("SELECT id FROM app_users WHERE username = 'not-approved'").get();
    const result = await applyRoleTemplateToUsers(env, "document_manager", [{
      id: Number(pending.id),
      expectedRowVersion: 1
    }], actor, 1);
    assert.equal(result.ok, false);
    assert.equal(result.stale, true);
    assert.deepEqual({ ...database.prepare(`
      SELECT role_template_key, can_manage_documents, row_version FROM app_users WHERE id = ?
    `).get(pending.id) }, {
      role_template_key: null,
      can_manage_documents: 0,
      row_version: 1
    });
  } finally {
    database.close();
  }
});

test("disableUser는 감사 INSERT를 상태 UPDATE 앞에 같은 batch로 실행한다", async () => {
  const env = userMutationEnv(userRow({ status: "approved" }));
  const result = await disableUser(env, 7, actor);
  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const [audit, update] = env.state.batches[0];
  assert.match(audit.sql, /INSERT INTO system_audit_logs/);
  assert.match(audit.sql, /FROM app_users[\s\S]*status IN \(\?\)/);
  assert.match(update.sql, /SET status = 'disabled'/);
  assert.match(update.sql, /session_epoch = session_epoch \+ 1/);
  assert.match(update.sql, /row_version = row_version \+ 1/);
  assert.deepEqual(audit.args.slice(-2), [7, "approved"]);
  const details = JSON.parse(audit.args[9]);
  assert.equal(details.before.status, "approved");
  assert.equal(details.after.status, "disabled");
});

test("enableUser는 disabled 사용자만 approved로 복구한다", async () => {
  const enabled = userMutationEnv(userRow({ status: "disabled" }));
  assert.equal((await enableUser(enabled, 7, actor)).ok, true);
  assert.match(enabled.state.batches[0][1].sql, /SET status = 'approved'/);
  assert.match(enabled.state.batches[0][1].sql, /session_epoch = session_epoch \+ 1/);
  assert.match(enabled.state.batches[0][1].sql, /row_version = row_version \+ 1/);

  const pending = userMutationEnv(userRow({ status: "pending" }));
  const result = await enableUser(pending, 7, actor);
  assert.equal(result.ok, false);
  assert.equal(pending.state.batches.length, 0);
});

test("rejectUser는 승인된 사용자를 rejected로 재사용하지 않는다", async () => {
  const env = userMutationEnv(userRow({ status: "approved" }));
  const result = await rejectUser(env, 7, actor);
  assert.equal(result.ok, false);
  assert.equal(env.state.batches.length, 0);
});

test("deleteUser는 감사 INSERT와 잠금 해제를 계정 DELETE 앞에 같은 batch로 실행한다", async () => {
  const env = userMutationEnv(userRow({ status: "rejected", row_version: 4 }));
  const result = await deleteUser(env, 7, actor, { confirmedUsername: "viewer" });
  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const [audit, throttle, remove] = env.state.batches[0];
  assert.match(audit.sql, /INSERT INTO system_audit_logs/);
  assert.match(audit.sql, /FROM app_users[\s\S]*row_version = \?/);
  assert.match(throttle.sql, /DELETE FROM login_throttle/);
  assert.match(remove.sql, /DELETE FROM app_users/);
  assert.deepEqual(remove.args, [7, "viewer", 4]);
  const details = JSON.parse(audit.args[9]);
  assert.equal(details.before.username, "viewer");
  assert.equal(details.after, null);
});

test("deleteUser는 아이디 확인 불일치·비 Admin·자기 계정을 거부한다", async () => {
  const mismatched = userMutationEnv(userRow({ status: "rejected" }));
  assert.equal((await deleteUser(mismatched, 7, actor, { confirmedUsername: "other@example.com" })).ok, false);
  assert.equal(mismatched.state.batches.length, 0);

  const regular = userMutationEnv(userRow({ status: "rejected" }));
  const regularResult = await deleteUser(regular, 7, { ...actor, role: "User" }, { confirmedUsername: "viewer" });
  assert.equal(regularResult.ok, false);
  assert.equal(regular.state.batches.length, 0);

  const own = userMutationEnv(userRow({ id: 1, username: "admin", status: "approved" }));
  const ownResult = await deleteUser(own, 1, actor, { confirmedUsername: "admin" });
  assert.equal(ownResult.ok, false);
  assert.equal(own.state.batches.length, 0);
});

test("deleteUser는 남은 Admin이 없으면 Admin 계정을 지우지 않는다", async () => {
  const lastAdmin = userMutationEnv(userRow({ id: 7, username: "other-admin", role: "Admin" }), 1, { total: 0 });
  const blocked = await deleteUser(lastAdmin, 7, actor, { confirmedUsername: "other-admin" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /마지막 시스템 관리자/);
  assert.equal(lastAdmin.state.batches.length, 0);

  const spareAdmin = userMutationEnv(userRow({ id: 7, username: "other-admin", role: "Admin" }), 1, { total: 2 });
  assert.equal((await deleteUser(spareAdmin, 7, actor, { confirmedUsername: "other-admin" })).ok, true);
});

test("updateUserPermissions는 역할 템플릿·권한 플래그와 전후 snapshot을 원자적으로 기록한다", async () => {
  const env = userMutationEnv(userRow({ role_template_key: "viewer", row_version: 3 }));
  const result = await updateUserPermissions(env, 7, {
    roleTemplateKey: "document_manager",
    expectedRowVersion: 3,
    permissions: {
      can_manage_documents: true,
      can_move_documents: true,
      can_manage_sets: true
    }
  }, actor);
  assert.equal(result.ok, true);
  const [audit, update] = env.state.batches[0];
  assert.equal(audit.args[3], "permissions_update");
  assert.match(update.sql, /role_template_key = \?[\s\S]*can_manage_documents = \?[\s\S]*can_apply_document_snapshots = \?[\s\S]*row_version = row_version \+ 1/);
  assert.deepEqual(update.args.slice(0, 9), ["document_manager", 1, 1, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(update.args.slice(-2), [7, 3]);
  const details = JSON.parse(audit.args[9]);
  assert.equal(details.before.roleTemplateKey, "viewer");
  assert.equal(details.after.roleTemplateKey, "document_manager");
  assert.equal(details.after.permissions.can_manage_documents, true);
  assert.equal(details.after.rowVersion, 4);
});

test("resetUserPassword는 감사·잠금 해제·credential 교체를 한 batch로 실행한다", async () => {
  const env = userMutationEnv(userRow({ session_epoch: 4 }));
  const temporaryPassword = "temporary-password-2026";
  const result = await resetUserPassword(env, 7, temporaryPassword, actor);
  assert.equal(result.ok, true);
  const [audit, clearThrottle, update] = env.state.batches[0];
  assert.equal(audit.args[3], "password_reset");
  const details = JSON.parse(audit.args[9]);
  assert.deepEqual(details.after, {
    status: "approved",
    role: "User",
    mustChangePassword: true,
    sessionEpoch: 5
  });
  assert.doesNotMatch(audit.args[9], /temporary-password-2026/);
  assert.match(clearThrottle.sql, /DELETE FROM login_throttle/);
  assert.match(update.sql, /must_change_password = 1/);
  assert.doesNotMatch(update.sql, /row_version = row_version \+ 1/);
  assert.equal(update.args[2], 5);
  assert.doesNotMatch(JSON.stringify(update.args), /temporary-password-2026/);
});

test("resetUserPassword는 비 Admin·자기 계정·보안 검토 계정을 거부한다", async () => {
  const regularActor = { ...actor, role: "User" };
  const regularEnv = userMutationEnv(userRow());
  assert.equal((await resetUserPassword(regularEnv, 7, "temporary-password-2026", regularActor)).ok, false);
  assert.equal(regularEnv.state.batches.length, 0);

  const selfEnv = userMutationEnv(userRow({ id: 1, username: actor.username }));
  assert.equal((await resetUserPassword(selfEnv, 1, "temporary-password-2026", actor)).ok, false);
  assert.equal(selfEnv.state.batches.length, 0);

  const reviewEnv = userMutationEnv(userRow({ security_review_required: 1 }));
  assert.equal((await resetUserPassword(reviewEnv, 7, "temporary-password-2026", actor)).ok, false);
  assert.equal(reviewEnv.state.batches.length, 0);
});

function userRow(overrides = {}) {
  return {
    id: 7,
    username: "viewer",
    display_name: "조회자",
    role: "User",
    status: "approved",
    updated_at: "2026-07-17 10:00:00",
    role_template_key: "viewer",
    row_version: 1,
    session_epoch: 0,
    must_change_password: 0,
    security_review_required: 0,
    can_manage_documents: 0,
    can_move_documents: 0,
    can_manage_disposals: 0,
    can_manage_sets: 0,
    can_manage_masters: 0,
    can_manage_users: 0,
    can_view_audit: 0,
    can_apply_document_snapshots: 0,
    ...overrides
  };
}

function userMutationEnv(user, changes = 1, adminCountRow = { total: 1 }) {
  const state = { batches: [] };
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind(...nextArgs) {
      return statement(sql, nextArgs);
    },
    async first() {
      // Admin 삭제 가드는 같은 env에서 남은 Admin 수를 별도로 읽는다.
      return /COUNT\(\*\) AS total/.test(sql) ? adminCountRow : user;
    }
  });
  return {
    state,
    DB: {
      prepare: (sql) => statement(sql),
      async batch(statements) {
        state.batches.push(statements);
        return statements.map(() => ({ meta: { changes } }));
      }
    }
  };
}
