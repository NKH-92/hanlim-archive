import assert from "node:assert/strict";
import test from "node:test";

import { createPasswordRecord, validateUser } from "../src/auth.js";
import { resetUserPassword } from "../src/domains/identity/index.js";
import worker from "../src/index.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

const ORIGIN = "https://archive.example.com";
const SESSION_SECRET = "test-session-secret-with-at-least-32-characters";

test("관리자 초기화 뒤 임시 비밀번호 로그인은 변경 완료 전 업무 접근을 차단한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const originalPassword = "original-password-2026";
    const temporaryPassword = "temporary-password-2026";
    const finalPassword = "final-password-2026";
    const originalRecord = await createPasswordRecord(originalPassword);
    const inserted = database.prepare(`
      INSERT INTO app_users (
        username,
        display_name,
        password_salt,
        password_hash,
        status,
        approved_at,
        approved_by,
        role,
        must_change_password,
        security_review_required,
        session_epoch
      )
      VALUES (?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP, 'test-admin', 'User', 0, 0, 3)
    `).run(
      "reset-target@hanlim.com",
      "초기화 대상",
      originalRecord.salt,
      originalRecord.hash
    );
    const userId = Number(inserted.lastInsertRowid);
    database.prepare(`
      INSERT INTO login_throttle (username, fail_count, window_started_at, locked_until)
      VALUES (?, 5, CURRENT_TIMESTAMP, datetime('now', '+10 minutes'))
    `).run("reset-target@hanlim.com|203.0.113.10");

    const env = { SESSION_SECRET, DB: sqliteD1(database) };
    const actor = {
      userId: 900,
      username: "independent-admin@hanlim.com",
      displayName: "독립 관리자",
      role: "Admin"
    };
    const result = await resetUserPassword(env, userId, temporaryPassword, actor);
    assert.equal(result.ok, true);

    const account = database.prepare(`
      SELECT must_change_password, session_epoch
      FROM app_users
      WHERE id = ?
    `).get(userId);
    assert.deepEqual({ ...account }, { must_change_password: 1, session_epoch: 4 });
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM login_throttle WHERE username LIKE 'reset-target@hanlim.com|%'").get().count,
      0
    );
    assert.equal(await validateUser(env, "reset-target@hanlim.com", originalPassword), null);
    assert.equal((await validateUser(env, "reset-target@hanlim.com", temporaryPassword)).mustChangePassword, true);

    const audit = database.prepare(`
      SELECT details_json
      FROM system_audit_logs
      WHERE action = 'password_reset' AND entity_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(String(userId));
    assert.ok(audit);
    assert.doesNotMatch(audit.details_json, /original-password|temporary-password|password_salt|password_hash/);

    const login = await worker.fetch(loginRequest("reset-target@hanlim.com", temporaryPassword, "/admin"), env);
    assert.equal(login.status, 302);
    assert.equal(login.headers.get("Location"), "/account/password?required=1");
    const forcedCookie = login.headers.get("Set-Cookie");
    assert.ok(forcedCookie);

    const blocked = await worker.fetch(authenticatedRequest("/app", forcedCookie), env);
    assert.equal(blocked.status, 302);
    assert.equal(blocked.headers.get("Location"), "/account/password?required=1");

    const changed = await worker.fetch(
      passwordChangeRequest(forcedCookie, temporaryPassword, finalPassword),
      env
    );
    assert.equal(changed.status, 302);
    assert.equal(changed.headers.get("Location"), "/app?toast=password-changed");
    assert.equal(await validateUser(env, "reset-target@hanlim.com", temporaryPassword), null);
    assert.equal((await validateUser(env, "reset-target@hanlim.com", finalPassword)).mustChangePassword, false);
  } finally {
    database.close();
  }
});

function loginRequest(username, password, returnUrl) {
  return new Request(`${ORIGIN}/login`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "CF-Connecting-IP": "203.0.113.10"
    },
    body: new URLSearchParams({ username, password, returnUrl })
  });
}

function authenticatedRequest(path, cookie) {
  return new Request(`${ORIGIN}${path}`, {
    headers: { Cookie: cookie.split(";", 1)[0] }
  });
}

function passwordChangeRequest(cookie, currentPassword, newPassword) {
  return new Request(`${ORIGIN}/account/password`, {
    method: "POST",
    headers: {
      Cookie: cookie.split(";", 1)[0],
      Origin: ORIGIN
    },
    body: new URLSearchParams({
      csrf_token: csrfToken(cookie),
      currentPassword,
      newPassword,
      confirmPassword: newPassword
    })
  });
}

function csrfToken(cookie) {
  const value = cookie.match(/hanlim_session=([^;]+)/)?.[1];
  const payload = value?.split(".", 1)[0];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).csrfToken;
}
