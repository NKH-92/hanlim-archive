import assert from "node:assert/strict";
import test from "node:test";

import { loadAdminDashboardReadModel } from "../src/readModels/adminDashboard.js";

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
  assert.equal(sql.length, 1);
  assert.match(sql[0], /FROM app_users/);
});
