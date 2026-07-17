import assert from "node:assert/strict";
import test from "node:test";

import {
  disableUser,
  enableUser,
  rejectUser,
  updateUserPermissions
} from "../src/data/usersData.js";

const actor = {
  userId: 1,
  username: "admin",
  displayName: "관리자",
  role: "Admin"
};

test("disableUser는 감사 INSERT를 상태 UPDATE 앞에 같은 batch로 실행한다", async () => {
  const env = userMutationEnv(userRow({ status: "approved" }));
  const result = await disableUser(env, 7, actor);

  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const [audit, update] = env.state.batches[0];
  assert.match(audit.sql, /INSERT INTO system_audit_logs/);
  assert.match(audit.sql, /FROM app_users[\s\S]*status IN \(\?\)/);
  assert.match(update.sql, /SET status = 'disabled'/);
  assert.deepEqual(audit.args.slice(-2), [7, "approved"]);
  const details = JSON.parse(audit.args[9]);
  assert.equal(details.before.status, "approved");
  assert.equal(details.after.status, "disabled");
});

test("enableUser는 disabled 사용자만 approved로 복구한다", async () => {
  const enabled = userMutationEnv(userRow({ status: "disabled" }));
  assert.equal((await enableUser(enabled, 7, actor)).ok, true);
  assert.match(enabled.state.batches[0][1].sql, /SET status = 'approved'/);

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

test("updateUserPermissions는 7개 플래그와 전후 snapshot을 원자적으로 기록한다", async () => {
  const env = userMutationEnv(userRow());
  const result = await updateUserPermissions(env, 7, {
    can_manage_documents: true,
    can_move_documents: true,
    can_manage_sets: true
  }, actor);

  assert.equal(result.ok, true);
  const [audit, update] = env.state.batches[0];
  assert.match(audit.sql, /action/);
  assert.equal(audit.args[3], "permissions_update");
  assert.match(update.sql, /can_manage_documents = \?[\s\S]*can_view_audit = \?/);
  assert.deepEqual(update.args.slice(0, 7), [1, 1, 0, 1, 0, 0, 0]);
  const details = JSON.parse(audit.args[9]);
  assert.equal(details.before.permissions.can_manage_documents, false);
  assert.equal(details.after.permissions.can_manage_documents, true);
});

function userRow(overrides = {}) {
  return {
    id: 7,
    username: "viewer",
    display_name: "조회자",
    role: "User",
    status: "approved",
    updated_at: "2026-07-17 10:00:00",
    can_manage_documents: 0,
    can_move_documents: 0,
    can_manage_disposals: 0,
    can_manage_sets: 0,
    can_manage_masters: 0,
    can_manage_users: 0,
    can_view_audit: 0,
    ...overrides
  };
}

function userMutationEnv(user, changes = 1) {
  const state = { batches: [] };
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind(...nextArgs) {
      return statement(sql, nextArgs);
    },
    async first() {
      return user;
    }
  });
  return {
    state,
    DB: {
      prepare: (sql) => statement(sql),
      async batch(statements) {
        state.batches.push(statements);
        return [{ meta: { changes } }, { meta: { changes } }];
      }
    }
  };
}
