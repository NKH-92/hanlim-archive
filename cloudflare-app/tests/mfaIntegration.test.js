import assert from "node:assert/strict";
import test from "node:test";

import {
  createPasswordRecord,
  createSessionCookie,
  loginThrottleContext,
  recordLoginFailure,
  validateUser
} from "../src/auth.js";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  verifyMfaLogin
} from "../src/auth/mfa.js";
import { decryptMfaSecret } from "../src/auth/mfaCrypto.js";
import { totpAtCounter } from "../src/auth/totp.js";
import { handleMfaLogin } from "../src/handlers/mfaHandlers.js";
import { handleLogin } from "../src/handlers/sessionHandlers.js";
import { bytesToBase64Url } from "../src/platform/crypto/encoding.js";
import worker from "../src/index.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

test("MFA enrollment, TOTP replay 방지, recovery 1회 소비, disable epoch 회전을 통합 검증한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const password = "mfa-integration-password";
    const record = await createPasswordRecord(password);
    const inserted = database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash,
        status, approved_at, approved_by, role, session_epoch
      )
      VALUES (?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP, 'test', 'User', 0)
    `).run("mfa-user@hanlim.com", "MFA 사용자", record.salt, record.hash);
    const userId = Number(inserted.lastInsertRowid);
    const env = {
      DB: sqliteD1(database),
      SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
      AUTH_HMAC_SECRET: "test-auth-hmac-secret-with-at-least-32-characters",
      MFA_ENCRYPTION_KEY_V1: bytesToBase64Url(new Uint8Array(32).fill(11))
    };
    const session = {
      userId,
      username: "mfa-user@hanlim.com",
      displayName: "MFA 사용자",
      role: "User",
      sessionEpoch: 0
    };

    const enrollment = await beginMfaEnrollment(env, session, { currentPassword: password });
    assert.equal(enrollment.ok, true);
    const stored = database.prepare("SELECT encrypted_secret FROM user_mfa WHERE user_id = ?").get(userId);
    assert.equal(await decryptMfaSecret(env, userId, stored.encrypted_secret), enrollment.secret);

    const currentCounter = Math.floor(Date.now() / 1000 / 30);
    const enrollmentCode = await totpAtCounter(enrollment.secret, currentCounter - 1);
    const confirmed = await confirmMfaEnrollment(env, session, {
      currentPassword: password,
      code: enrollmentCode
    });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.recoveryCodes.length, 10);
    assert.equal(confirmed.sessionEpoch, 1);
    assert.equal((await validateUser(env, session.username, password)).mfaEnabled, true);

    const loginRequest = new Request("https://archive.example.com/login", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.77" },
      body: new URLSearchParams({ username: session.username, password, returnUrl: "/app" })
    });
    const throttle = loginThrottleContext(loginRequest, session.username);
    await recordLoginFailure(env, throttle);
    const passwordAccepted = await handleLogin(loginRequest, env);
    assert.equal(passwordAccepted.headers.get("Location"), "/login/mfa");
    assert.equal(
      database.prepare("SELECT fail_count FROM login_throttle_v2 WHERE scope = 'pair'").get().fail_count,
      1,
      "MFA 완료 전에는 password 성공만으로 throttle을 지우지 않는다"
    );
    const challengeCookie = passwordAccepted.headers.get("Set-Cookie").split(";", 1)[0];
    const wrongMfa = await handleMfaLogin(new Request("https://archive.example.com/login/mfa", {
      method: "POST",
      headers: {
        Cookie: challengeCookie,
        "CF-Connecting-IP": "203.0.113.77"
      },
      body: new URLSearchParams({ code: "INVALID" })
    }), env);
    assert.equal(database.prepare("SELECT fail_count FROM login_throttle_v2 WHERE scope = 'pair'").get().fail_count, 2);
    const retryCookie = wrongMfa.headers.get("Set-Cookie").split(";", 1)[0];
    const mfaAccepted = await handleMfaLogin(new Request("https://archive.example.com/login/mfa", {
      method: "POST",
      headers: {
        Cookie: retryCookie,
        "CF-Connecting-IP": "203.0.113.77"
      },
      body: new URLSearchParams({ code: confirmed.recoveryCodes[0] })
    }), env);
    assert.equal(mfaAccepted.headers.get("Location"), "/app");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM login_throttle_v2 WHERE scope IN ('pair', 'account')").get().count, 0);

    const challenge = {
      userId,
      username: session.username,
      sessionEpoch: 1
    };
    const currentCode = await totpAtCounter(enrollment.secret, currentCounter);
    assert.equal((await verifyMfaLogin(env, challenge, currentCode)).username, session.username);
    assert.equal(await verifyMfaLogin(env, challenge, currentCode), null, "같은 TOTP는 재사용할 수 없다");

    assert.equal(
      (await verifyMfaLogin(env, challenge, confirmed.recoveryCodes[1])).username,
      session.username
    );
    assert.equal(
      await verifyMfaLogin(env, challenge, confirmed.recoveryCodes[1]),
      null,
      "복구 코드는 한 번만 사용할 수 있다"
    );

    const disabled = await disableMfa(env, { ...session, sessionEpoch: 1 }, {
      currentPassword: password,
      code: confirmed.recoveryCodes[2]
    });
    assert.equal(disabled.ok, true);
    assert.equal(disabled.sessionEpoch, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM user_mfa WHERE user_id = ?").get(userId).count, 0);
    assert.equal(database.prepare("SELECT session_epoch FROM app_users WHERE id = ?").get(userId).session_epoch, 2);
  } finally {
    database.close();
  }
});

test("Admin은 MFA 등록 화면을 제외한 업무 경로에 MFA 없이 진입할 수 없다", async () => {
  const database = await createMigratedDatabase();
  try {
    const record = await createPasswordRecord("admin-mfa-password");
    const inserted = database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash,
        status, approved_at, approved_by, role, session_epoch
      )
      VALUES (?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP, 'test', 'Admin', 0)
    `).run("admin-mfa@hanlim.com", "MFA 관리자", record.salt, record.hash);
    const env = {
      DB: sqliteD1(database),
      SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
      AUTH_HMAC_SECRET: "test-auth-hmac-secret-with-at-least-32-characters",
      MFA_ENCRYPTION_KEY_V1: bytesToBase64Url(new Uint8Array(32).fill(13))
    };
    const cookie = await createSessionCookie({
      userId: Number(inserted.lastInsertRowid),
      username: "admin-mfa@hanlim.com",
      displayName: "MFA 관리자",
      role: "Admin",
      sessionEpoch: 0
    }, env);

    const blocked = await worker.fetch(new Request("https://archive.example.com/app", {
      headers: { Cookie: cookie.split(";", 1)[0] }
    }), env);
    assert.equal(blocked.status, 302);
    assert.equal(blocked.headers.get("Location"), "/account/mfa?required=1");

    const enrollment = await worker.fetch(new Request("https://archive.example.com/account/mfa", {
      headers: { Cookie: cookie.split(";", 1)[0] }
    }), env);
    assert.equal(enrollment.status, 200);
    assert.match(await enrollment.text(), /2단계 인증/);
  } finally {
    database.close();
  }
});
