import assert from "node:assert/strict";
import test from "node:test";

import { createPasswordRecord, createSessionCookie, readSession, validateUser } from "../src/auth.js";

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

function requestWithCookie(cookie) {
  return new Request("https://example.com/app", {
    headers: {
      Cookie: cookie.split(";")[0]
    }
  });
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
  canApplyDocumentSnapshots = 0
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
