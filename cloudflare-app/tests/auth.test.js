import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupExpiredReleaseSmokePrincipals,
  createPasswordRecord,
  createSessionCookie,
  readSession,
  validateUser
} from "../src/auth.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

const SESSION_SECRET = "0123456789abcdef0123456789abcdef";

test("readSession revalidates approved users against the database", async () => {
  const cookie = await createSessionCookie({
    username: "user@example.com",
    displayName: "사용자",
    role: "User"
  }, envWithUser({ status: "approved" }), true);
  const request = requestWithCookie(cookie);
  const session = await readSession(request, envWithUser({ status: "approved" }));

  assert.equal(session.username, "user@example.com");
  assert.equal(session.role, "User");
});

test("readSession rejects revoked users before cookie expiry", async () => {
  const cookie = await createSessionCookie({
    username: "user@example.com",
    displayName: "사용자",
    role: "User"
  }, envWithUser({ status: "approved" }), true);
  const request = requestWithCookie(cookie);

  assert.equal(await readSession(request, envWithUser({ status: "rejected" })), null);
  assert.equal(await readSession(request, envWithUser({ status: "disabled" })), null);
});

test("readSession rejects a copied cookie after the user's session epoch changes", async () => {
  const cookie = await createSessionCookie({
    username: "user@example.com",
    displayName: "사용자",
    role: "User",
    sessionEpoch: 4
  }, envWithUser({ sessionEpoch: 4 }), true);
  const request = requestWithCookie(cookie);

  assert.equal((await readSession(request, envWithUser({ sessionEpoch: 4 }))).sessionEpoch, 4);
  assert.equal(await readSession(request, envWithUser({ sessionEpoch: 5 })), null);
});

test("epoch 필드가 없는 legacy cookie는 DB epoch 0에서만 전환 호환된다", async () => {
  const cookie = await legacySessionCookie({
    username: "user@example.com",
    displayName: "사용자",
    role: "User"
  });
  const request = requestWithCookie(cookie);

  assert.equal((await readSession(request, envWithUser({ sessionEpoch: 0 }))).sessionEpoch, 0);
  assert.equal(await readSession(request, envWithUser({ sessionEpoch: 1 })), null);
});

test("readSession refreshes granular permissions from app_users on every request", async () => {
  const cookie = await createSessionCookie({
    username: "user@example.com",
    displayName: "사용자",
    role: "User"
  }, envWithUser(), true);
  const session = await readSession(requestWithCookie(cookie), envWithUser({
    id: 9,
    canManageDocuments: 1,
    canViewAudit: 1
  }));

  assert.equal(session.userId, 9);
  assert.equal(session.can_manage_documents, true);
  assert.equal(session.can_view_audit, true);
  assert.equal(session.can_manage_users, false);
});

test("readSession revalidates admin sessions against the database role", async () => {
  const env = envWithUser({
    username: "nkh92",
    displayName: "관리자",
    role: "Admin",
    status: "approved"
  });
  const cookie = await createSessionCookie({
    username: "nkh92",
    displayName: "관리자",
    role: "Admin"
  }, env, true);
  const request = requestWithCookie(cookie);

  assert.equal((await readSession(request, env)).role, "Admin");
  assert.equal((await readSession(request, envWithUser({ username: "nkh92", role: "User", status: "approved" }))).role, "User");
});

test("validateUser authenticates admins from app_users", async () => {
  const passwordRecord = await createPasswordRecord("secret-123");
  const env = envWithUser({
    username: "nkh92",
    displayName: "관리자",
    role: "Admin",
    status: "approved",
    passwordRecord
  });

  const user = await validateUser(env, "nkh92", "secret-123");

  assert.equal(user.username, "nkh92");
  assert.equal(user.role, "Admin");
  assert.equal(await validateUser(env, "nkh92", "wrong-password"), null);
});

test("validateUser는 미등록·비승인 계정에도 동일한 password verifier를 한 번 실행한다", async () => {
  const calls = [];
  const verifyPasswordFn = async (...args) => {
    calls.push(args);
    return false;
  };
  const missingEnv = {
    DB: {
      prepare() {
        return { bind() { return { async first() { return null; } }; } };
      }
    }
  };

  assert.equal(await validateUser(missingEnv, "missing@example.com", "guess", { verifyPasswordFn }), null);
  assert.equal(await validateUser(envWithUser({ status: "rejected" }), "user@example.com", "guess", { verifyPasswordFn }), null);
  assert.equal(calls.length, 2);
  for (const [, salt, hash] of calls) {
    assert.ok(salt);
    assert.ok(hash);
  }
});

test("legacy PBKDF2 100000회 record는 정상 로그인 시 현재 work factor로 승격된다", async () => {
  const database = await createMigratedDatabase();
  try {
    const password = "legacy-password-2026";
    const saltBytes = new Uint8Array(16).fill(7);
    const salt = Buffer.from(saltBytes).toString("base64url");
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const digest = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: 100000
    }, material, 256);
    const legacyHash = Buffer.from(digest).toString("base64url");
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash,
        status, role, approved_at, approved_by, must_change_password
      ) VALUES (?, ?, ?, ?, 'approved', 'User', CURRENT_TIMESTAMP, 'test', 0)
    `).run("legacy-hash@example.com", "Legacy hash", salt, legacyHash);

    const user = await validateUser(
      { DB: sqliteD1(database) },
      "legacy-hash@example.com",
      password
    );
    assert.equal(user.username, "legacy-hash@example.com");
    const upgraded = database.prepare(`
      SELECT password_hash FROM app_users WHERE username = ?
    `).get("legacy-hash@example.com").password_hash;
    assert.match(upgraded, /^pbkdf2-sha256\$600000\$/);
    assert.notEqual(upgraded, legacyHash);
  } finally {
    database.close();
  }
});

test("만료된 release smoke 계정만 cron janitor가 제거한다", async () => {
  const database = await createMigratedDatabase();
  try {
    database.exec(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash,
        status, role, approved_at, approved_by, expires_at
      ) VALUES
        ('expired-smoke@hanlim.internal', 'Expired smoke', 'salt', 'hash',
         'approved', 'User', CURRENT_TIMESTAMP, 'release-smoke:expired',
         datetime(CURRENT_TIMESTAMP, '-1 minute')),
        ('live-smoke@hanlim.internal', 'Live smoke', 'salt', 'hash',
         'approved', 'User', CURRENT_TIMESTAMP, 'release-smoke:live',
         datetime(CURRENT_TIMESTAMP, '+30 minutes')),
        ('ordinary-expired@hanlim.internal', 'Ordinary expired', 'salt', 'hash',
         'approved', 'User', CURRENT_TIMESTAMP, 'operator',
         datetime(CURRENT_TIMESTAMP, '-1 minute'));
      INSERT INTO login_throttle (username, fail_count)
      VALUES ('expired-smoke@hanlim.internal', 2), ('live-smoke@hanlim.internal', 1);
    `);

    assert.deepEqual(
      await cleanupExpiredReleaseSmokePrincipals({ DB: sqliteD1(database) }),
      { ok: true }
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM app_users WHERE username = ?")
        .get("expired-smoke@hanlim.internal").count,
      0
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM app_users WHERE username IN (?, ?)")
        .get("live-smoke@hanlim.internal", "ordinary-expired@hanlim.internal").count,
      2
    );
    assert.deepEqual(
      database.prepare("SELECT username FROM login_throttle ORDER BY username").all().map((row) => row.username),
      ["live-smoke@hanlim.internal"]
    );
  } finally {
    database.close();
  }
});

function requestWithCookie(cookie) {
  return new Request("https://example.com/app", {
    headers: {
      Cookie: cookie.split(";")[0]
    }
  });
}

async function legacySessionCookie(user) {
  const payloadObject = {
    ...user,
    mustChangePassword: false,
    csrfToken: "legacy-csrf-token".repeat(2),
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const payload = Buffer.from(JSON.stringify(payloadObject)).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const signature = Buffer.from(signatureBytes).toString("base64url");
  return `hanlim_session=${payload}.${signature}; Path=/`;
}

function envWithUser({
  id = 1,
  username = "user@example.com",
  displayName = "사용자",
  role = "User",
  status = "approved",
  passwordRecord = { salt: "salt", hash: "hash" },
  canManageDocuments = 0,
  canMoveDocuments = 0,
  canManageDisposals = 0,
  canManageSets = 0,
  canManageMasters = 0,
  canManageUsers = 0,
  canViewAudit = 0,
  canApplyDocumentSnapshots = 0,
  sessionEpoch = 0,
  securityReviewRequired = 0
} = {}) {
  return {
    SESSION_SECRET,
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return {
                  id,
                  username,
                  display_name: displayName,
                  password_salt: passwordRecord.salt,
                  password_hash: passwordRecord.hash,
                  role,
                  status,
                  session_epoch: sessionEpoch,
                  security_review_required: securityReviewRequired,
                  can_manage_documents: canManageDocuments,
                  can_move_documents: canMoveDocuments,
                  can_manage_disposals: canManageDisposals,
                  can_manage_sets: canManageSets,
                  can_manage_masters: canManageMasters,
                  can_manage_users: canManageUsers,
                  can_view_audit: canViewAudit,
                  can_apply_document_snapshots: canApplyDocumentSnapshots
                };
              }
            };
          }
        };
      }
    }
  };
}
