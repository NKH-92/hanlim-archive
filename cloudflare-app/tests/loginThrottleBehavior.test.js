import assert from "node:assert/strict";
import test from "node:test";

import { clearLoginFailures, isLoginLocked, LOGIN_THROTTLE_POLICY, recordLoginFailure } from "../src/auth/throttle.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";

function sqliteEnv(database) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            const statement = database.prepare(sql);
            return {
              async first() {
                return statement.get(...args) ?? null;
              },
              async run() {
                const result = statement.run(...args);
                return { meta: { changes: Number(result.changes) } };
              }
            };
          }
        };
      }
    }
  };
}

test("login throttle은 주입 clock으로 4/5/6·window·lock·reset 계약을 지킨다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = sqliteEnv(database);
    const user = "throttle@hanlim.com";
    const t0 = "2026-07-21 10:00:00";

    for (let i = 1; i <= 4; i += 1) {
      await recordLoginFailure(env, user, { nowIso: t0 });
      assert.equal(await isLoginLocked(env, user, { nowIso: t0 }), false);
    }

    await recordLoginFailure(env, user, { nowIso: t0 });
    assert.equal(await isLoginLocked(env, user, { nowIso: t0 }), true);

    await recordLoginFailure(env, user, { nowIso: t0 });
    assert.equal(await isLoginLocked(env, user, { nowIso: t0 }), true);

    const row = database.prepare("SELECT fail_count, locked_until FROM login_throttle WHERE username = ?").get(user);
    assert.equal(row.fail_count, 6);
    assert.ok(row.locked_until);

    // 정확히 10분 경계: locked_until 직전에는 잠금, 도달 시 해제
    assert.equal(await isLoginLocked(env, user, { nowIso: "2026-07-21 10:09:59" }), true);
    assert.equal(await isLoginLocked(env, user, { nowIso: "2026-07-21 10:10:00" }), false);

    const afterWindow = "2026-07-21 10:20:01";
    await recordLoginFailure(env, user, { nowIso: afterWindow });
    const reset = database.prepare("SELECT fail_count, locked_until FROM login_throttle WHERE username = ?").get(user);
    assert.equal(reset.fail_count, 1);
    assert.equal(reset.locked_until, null);

    await clearLoginFailures(env, user);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM login_throttle WHERE username = ?").get(user).n, 0);
    assert.equal(LOGIN_THROTTLE_POLICY.failLimit, 5);
  } finally {
    database.close();
  }
});

test("login throttle 성공 로그인은 실패 카운터를 제거하고 다른 키와 격리한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = sqliteEnv(database);
    const t0 = "2026-07-21 11:00:00";
    await recordLoginFailure(env, "a@hanlim.com", { nowIso: t0 });
    await recordLoginFailure(env, "b@hanlim.com", { nowIso: t0 });
    await clearLoginFailures(env, "a@hanlim.com");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM login_throttle WHERE username = ?").get("a@hanlim.com").n, 0);
    assert.equal(database.prepare("SELECT fail_count FROM login_throttle WHERE username = ?").get("b@hanlim.com").fail_count, 1);
  } finally {
    database.close();
  }
});
