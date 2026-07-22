import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { validateUser } from "../src/auth.js";
import { approveUser, disableUser, enableUser } from "../src/domains/identity/index.js";
import worker from "../src/index.js";

const SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
const INITIAL_EMAIL = "nkh92@hanlim.com";
const MIGRATIONS_URL = new URL("../migrations/", import.meta.url);

test("0027 migration은 최초 관리자와 기본 비밀번호 변경 상태를 등록한다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database, 27);
    const account = database.prepare(`
      SELECT username, display_name, status, role, must_change_password,
             can_manage_documents, can_move_documents, can_manage_disposals,
             can_manage_sets, can_manage_masters, can_manage_users, can_view_audit
      FROM app_users
      WHERE username = ?
    `).get(INITIAL_EMAIL);

    assert.deepEqual({ ...account }, {
      username: INITIAL_EMAIL,
      display_name: "관리자",
      status: "approved",
      role: "Admin",
      must_change_password: 1,
      can_manage_documents: 1,
      can_move_documents: 1,
      can_manage_disposals: 1,
      can_manage_sets: 1,
      can_manage_masters: 1,
      can_manage_users: 1,
      can_view_audit: 1
    });

    const env = sqliteEnv(database);
    const user = await validateUser(env, INITIAL_EMAIL, "123456");
    assert.equal(user.role, "Admin");
    assert.equal(user.mustChangePassword, true);
    assert.equal(await validateUser(env, "unregistered@hanlim.com", "123456"), null);
  } finally {
    database.close();
  }
});

test("0036 remediation 이후 알려진 bootstrap credential은 격리되고 verifier가 폐기된다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database);
    const account = database.prepare(`
      SELECT status, role, must_change_password, can_manage_users, can_manage_documents,
             security_review_required, password_salt, password_hash
      FROM app_users WHERE username = ?
    `).get(INITIAL_EMAIL);
    assert.equal(account.status, "rejected");
    assert.equal(account.role, "User");
    assert.equal(account.can_manage_users, 0);
    assert.equal(account.can_manage_documents, 0);
    assert.equal(account.security_review_required, 1);
    assert.match(account.password_salt, /^[0-9a-f]{32}$/);
    assert.match(account.password_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(account.password_salt, "SbSC_rf4ZST_wP85vzRNrQ");
    assert.notEqual(account.password_hash, "4qR0RbTdZfjmx7IOgmaD1F3sdrF8YqWS-oIblfuL02I");
    assert.equal(await validateUser(sqliteEnv(database), INITIAL_EMAIL, "123456"), null);

    // 신규 guard를 모르는 이전 Worker의 일반 승인 UPDATE도 DB가 차단한다.
    assert.throws(() => database.prepare(`
      UPDATE app_users
      SET status = 'approved', security_review_required = 0
      WHERE username = ?
    `).run(INITIAL_EMAIL), /security review account/);
    assert.equal(await validateUser(sqliteEnv(database), INITIAL_EMAIL, "123456"), null);
  } finally {
    database.close();
  }
});

test("사용중지와 재활성화는 epoch를 각각 회전시켜 기존 cookie를 되살리지 않는다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database);
    const { createPasswordRecord } = await import("../src/auth/passwords.js");
    const material = await createPasswordRecord("normal-user-pass-2026");
    const inserted = database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role,
        approved_at, approved_by, must_change_password, security_review_required
      ) VALUES (
        'normal-user@hanlim.com', '일반 사용자', ?, ?, 'approved', 'User',
        CURRENT_TIMESTAMP, 'ops', 0, 0
      )
    `).run(material.salt, material.hash);
    const userId = Number(inserted.lastInsertRowid);
    const env = sqliteEnv(database);
    const actor = { username: "ops-admin", displayName: "운영 관리자", role: "Admin" };

    const login = await worker.fetch(loginRequest("normal-user@hanlim.com", "normal-user-pass-2026", "/app"), env);
    const copiedCookie = login.headers.get("Set-Cookie");
    assert.ok(copiedCookie);

    assert.equal((await disableUser(env, userId, actor)).ok, true);
    assert.equal(database.prepare("SELECT session_epoch FROM app_users WHERE id = ?").get(userId).session_epoch, 1);
    assert.equal((await worker.fetch(authenticatedRequest("/app", copiedCookie), env)).status, 302);

    assert.equal((await enableUser(env, userId, actor)).ok, true);
    assert.equal(database.prepare("SELECT session_epoch FROM app_users WHERE id = ?").get(userId).session_epoch, 2);
    const staleAfterEnable = await worker.fetch(authenticatedRequest("/app", copiedCookie), env);
    assert.equal(staleAfterEnable.status, 302);
    assert.match(staleAfterEnable.headers.get("Location"), /^\/login\?returnUrl=/);

    const freshLogin = await worker.fetch(loginRequest("normal-user@hanlim.com", "normal-user-pass-2026", "/app"), env);
    assert.ok(freshLogin.headers.get("Set-Cookie"));
  } finally {
    database.close();
  }
});

test("0036 DB guard는 epoch를 모르는 이전 Worker의 재활성화를 차단한다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database);
    const inserted = database.prepare(`
      INSERT INTO app_users (username, display_name, password_salt, password_hash, status, role)
      VALUES ('rollback-user@hanlim.com', '롤백 사용자', 'salt', 'hash', 'approved', 'User')
    `).run();
    const userId = Number(inserted.lastInsertRowid);

    database.prepare("UPDATE app_users SET status = 'disabled' WHERE id = ?").run(userId);
    assert.equal(database.prepare("SELECT session_epoch FROM app_users WHERE id = ?").get(userId).session_epoch, 1);

    assert.throws(
      () => database.prepare("UPDATE app_users SET status = 'approved' WHERE id = ?").run(userId),
      /session epoch rotation/
    );
    database.prepare(`
      UPDATE app_users
      SET status = 'approved', session_epoch = session_epoch + 1
      WHERE id = ?
    `).run(userId);
    assert.deepEqual(
      { ...database.prepare("SELECT status, session_epoch FROM app_users WHERE id = ?").get(userId) },
      { status: "approved", session_epoch: 2 }
    );
  } finally {
    database.close();
  }
});

test("알려진 bootstrap 계정은 일반 재승인 경로로 다시 활성화할 수 없다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database);
    const account = database.prepare("SELECT id FROM app_users WHERE username = ?").get(INITIAL_EMAIL);
    const env = sqliteEnv(database);
    const result = await approveUser(env, account.id, {
      userId: 999,
      username: "independent-admin@hanlim.com",
      displayName: "독립 관리자",
      role: "Admin"
    });

    assert.equal(result.ok, false);
    assert.equal(database.prepare("SELECT status FROM app_users WHERE id = ?").get(account.id).status, "rejected");
    assert.equal(await validateUser(env, INITIAL_EMAIL, "123456"), null);
  } finally {
    database.close();
  }
});

test("0027 bootstrap은 기존 동명 계정의 비밀번호를 덮어쓰지 않는다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database, 26);
    database.prepare(`
      INSERT INTO app_users (username, display_name, password_salt, password_hash, status, role)
      VALUES (?, '기존 사용자', 'existing-salt', 'existing-hash', 'pending', 'User')
    `).run(INITIAL_EMAIL);
    await applyMigration(database, "0027_initial_admin_and_forced_password_change.sql");

    const account = database.prepare(`
      SELECT password_salt, password_hash, status, role, must_change_password,
             can_manage_documents, can_manage_users
      FROM app_users WHERE username = ?
    `).get(INITIAL_EMAIL);
    assert.deepEqual({ ...account }, {
      password_salt: "existing-salt",
      password_hash: "existing-hash",
      status: "approved",
      role: "Admin",
      must_change_password: 0,
      can_manage_documents: 1,
      can_manage_users: 1
    });
  } finally {
    database.close();
  }
});

test("0034는 bootstrap 승격 동명을 검토 대상으로 두고 Admin으로 남기지 않는다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database, 26);
    database.prepare(`
      INSERT INTO app_users (username, display_name, password_salt, password_hash, status, role)
      VALUES (?, '기존 사용자', 'existing-salt', 'existing-hash', 'pending', 'User')
    `).run(INITIAL_EMAIL);
    await applyMigrationsFrom(database, 27, 34);

    const account = database.prepare(`
      SELECT password_salt, password_hash, status, role, must_change_password,
             can_manage_documents, can_manage_users, security_review_required, approved_by
      FROM app_users WHERE username = ?
    `).get(INITIAL_EMAIL);
    assert.equal(account.password_salt, "existing-salt");
    assert.equal(account.password_hash, "existing-hash");
    assert.equal(account.approved_by, "system-bootstrap");
    assert.equal(account.role, "User");
    assert.equal(account.can_manage_users, 0);
    assert.equal(account.can_manage_documents, 0);
    assert.equal(account.must_change_password, 1);
    assert.equal(account.security_review_required, 1);
  } finally {
    database.close();
  }
});

test("0034는 동명 비특권 User를 Admin으로 자동 승격하지 않는다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database, 26);
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role,
        approved_at, approved_by,
        can_manage_documents, can_move_documents, can_manage_disposals,
        can_manage_sets, can_manage_masters, can_manage_users, can_view_audit
      ) VALUES (
        ?, '일반 사용자', 'user-salt', 'user-hash', 'approved', 'User',
        CURRENT_TIMESTAMP, 'ops-reviewer',
        0, 0, 0, 0, 0, 0, 0
      )
    `).run(INITIAL_EMAIL);
    await applyMigrationsFrom(database, 27, 34);

    const account = database.prepare(`
      SELECT role, status, can_manage_users, can_manage_documents, security_review_required,
             must_change_password, password_salt, approved_by
      FROM app_users WHERE username = ?
    `).get(INITIAL_EMAIL);
    assert.equal(account.password_salt, "user-salt");
    assert.equal(account.approved_by, "ops-reviewer");
    assert.equal(account.role, "User");
    assert.equal(account.status, "approved");
    assert.equal(account.can_manage_users, 0);
    assert.equal(account.can_manage_documents, 0);
    assert.equal(account.must_change_password, 1);
    assert.equal(account.security_review_required, 1);
  } finally {
    database.close();
  }
});

test("0034는 정당한 동명 Admin도 상태 기반 자동 복구하지 않고 검토만 요구한다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database, 26);
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role,
        approved_at, approved_by,
        can_manage_documents, can_move_documents, can_manage_disposals,
        can_manage_sets, can_manage_masters, can_manage_users, can_view_audit
      ) VALUES (
        ?, '정당한 관리자', 'legit-salt', 'legit-hash', 'approved', 'Admin',
        CURRENT_TIMESTAMP, 'ops-reviewer',
        1, 1, 1, 1, 1, 1, 1
      )
    `).run(INITIAL_EMAIL);
    await applyMigrationsFrom(database, 27, 34);

    const account = database.prepare(`
      SELECT role, status, can_manage_users, can_manage_documents, security_review_required,
             password_salt, approved_by
      FROM app_users WHERE username = ?
    `).get(INITIAL_EMAIL);
    assert.equal(account.password_salt, "legit-salt");
    assert.equal(account.approved_by, "ops-reviewer");
    // 0033 demotion 후 0034는 권한을 되돌리지 않는다(fail-closed review).
    assert.equal(account.role, "User");
    assert.equal(account.can_manage_users, 0);
    assert.equal(account.can_manage_documents, 0);
    assert.equal(account.security_review_required, 1);
  } finally {
    database.close();
  }
});

test("security_review_required=1 계정은 비밀번호가 맞아도 로그인·세션이 거부된다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database);
    const { createPasswordRecord } = await import("../src/auth/passwords.js");
    const material = await createPasswordRecord("review-pass-2026");
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role,
        approved_at, approved_by, must_change_password, security_review_required
      ) VALUES (
        'review-locked@hanlim.com', '검토 대상', ?, ?, 'approved', 'User',
        CURRENT_TIMESTAMP, 'ops', 0, 1
      )
    `).run(material.salt, material.hash);

    const env = sqliteEnv(database);
    assert.equal(await validateUser(env, "review-locked@hanlim.com", "review-pass-2026"), null);

    const loginResponse = await worker.fetch(
      loginRequest("review-locked@hanlim.com", "review-pass-2026", "/app"),
      env
    );
    assert.equal(loginResponse.status, 302);
    assert.match(loginResponse.headers.get("Location"), /^\/login\?error=1/);
    assert.equal(loginResponse.headers.has("Set-Cookie"), false);
  } finally {
    database.close();
  }
});

test("기본 비밀번호 로그인은 returnUrl을 무시하고 변경 완료 전 모든 기능을 차단한다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    // 0033 revoke 직전 상태(알려진 bootstrap 활성)로 forced-change 흐름을 검증한다.
    await applyMigrations(database, 32);
    // 최신 런타임이 참조하는 호환 컬럼만 추가한다(검토 잠금은 끔).
    database.exec(`
      ALTER TABLE app_users
      ADD COLUMN security_review_required INTEGER NOT NULL DEFAULT 0
        CHECK (security_review_required IN (0, 1));
      ALTER TABLE app_users
      ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0
        CHECK (session_epoch >= 0);
    `);
    const env = sqliteEnv(database);
    const loginResponse = await worker.fetch(loginRequest(INITIAL_EMAIL, "123456", "/admin/settings"), env);

    assert.equal(loginResponse.status, 302);
    assert.equal(loginResponse.headers.get("Location"), "/account/password?required=1");
    const cookie = loginResponse.headers.get("Set-Cookie");
    assert.ok(cookie);

    const blocked = await worker.fetch(authenticatedRequest("/admin/settings?from=returnUrl", cookie), env);
    assert.equal(blocked.status, 302);
    assert.equal(blocked.headers.get("Location"), "/account/password?required=1");

    const changePage = await worker.fetch(authenticatedRequest("/account/password", cookie), env);
    assert.equal(changePage.status, 200);
    assert.match(await changePage.text(), /최초 로그인입니다/);

    const invalidChange = await worker.fetch(passwordChangeRequest(cookie, "wrong-password", "new-password-2026"), env);
    assert.equal(invalidChange.status, 200);
    assert.match(await invalidChange.text(), /최초 로그인입니다/);
    assert.equal(database.prepare("SELECT must_change_password FROM app_users WHERE username = ?").get(INITIAL_EMAIL).must_change_password, 1);

    const samePassword = await worker.fetch(passwordChangeRequest(cookie, "123456", "123456"), env);
    assert.equal(samePassword.status, 200);
    assert.match(await samePassword.text(), /현재 비밀번호와 달라야/);
    assert.equal(database.prepare("SELECT must_change_password FROM app_users WHERE username = ?").get(INITIAL_EMAIL).must_change_password, 1);

    const logout = await worker.fetch(logoutRequest(cookie), env);
    assert.equal(logout.status, 302);
    assert.equal(logout.headers.get("Location"), "/login");

    const copiedAfterLogout = await worker.fetch(authenticatedRequest("/app", cookie), env);
    assert.equal(copiedAfterLogout.status, 302);
    assert.match(copiedAfterLogout.headers.get("Location"), /^\/login\?returnUrl=/);

    const secondLogin = await worker.fetch(loginRequest(INITIAL_EMAIL, "123456", "/app"), env);
    const passwordCookie = secondLogin.headers.get("Set-Cookie");
    assert.ok(passwordCookie);

    const changed = await worker.fetch(passwordChangeRequest(passwordCookie, "123456", "new-password-2026"), env);
    assert.equal(changed.status, 302);
    assert.equal(changed.headers.get("Location"), "/app?toast=password-changed");
    const refreshedCookie = changed.headers.get("Set-Cookie");
    assert.ok(refreshedCookie);
    assert.equal(database.prepare("SELECT must_change_password FROM app_users WHERE username = ?").get(INITIAL_EMAIL).must_change_password, 0);

    assert.equal(await validateUser(env, INITIAL_EMAIL, "123456"), null);
    assert.equal((await validateUser(env, INITIAL_EMAIL, "new-password-2026")).mustChangePassword, false);

    const copiedAfterPasswordChange = await worker.fetch(authenticatedRequest("/app", passwordCookie), env);
    assert.equal(copiedAfterPasswordChange.status, 302);
    assert.match(copiedAfterPasswordChange.headers.get("Location"), /^\/login\?returnUrl=/);

    const app = await worker.fetch(authenticatedRequest("/app", refreshedCookie), env);
    assert.equal(app.status, 200);
  } finally {
    database.close();
  }
});

test("공개 가입 화면은 비활성화되고 등록되지 않은 이메일은 로그인할 수 없다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database);
    const env = sqliteEnv(database);

    const signup = await worker.fetch(new Request("https://archive.example.com/signup"), env);
    assert.equal(signup.status, 404);

    const response = await worker.fetch(loginRequest("unregistered@hanlim.com", "123456", "/app"), env);
    assert.equal(response.status, 302);
    assert.match(response.headers.get("Location"), /^\/login\?error=1/);
    assert.equal(response.headers.has("Set-Cookie"), false);
  } finally {
    database.close();
  }
});

function loginRequest(username, password, returnUrl) {
  return new Request("https://archive.example.com/login", {
    method: "POST",
    headers: { Origin: "https://archive.example.com" },
    body: new URLSearchParams({ username, password, returnUrl })
  });
}

function authenticatedRequest(path, cookie) {
  return new Request(`https://archive.example.com${path}`, {
    headers: { Cookie: cookie.split(";", 1)[0] }
  });
}

function passwordChangeRequest(cookie, currentPassword, newPassword) {
  return new Request("https://archive.example.com/account/password", {
    method: "POST",
    headers: {
      Cookie: cookie.split(";", 1)[0],
      Origin: "https://archive.example.com"
    },
    body: new URLSearchParams({
      csrf_token: csrfToken(cookie),
      currentPassword,
      newPassword,
      confirmPassword: newPassword
    })
  });
}

function logoutRequest(cookie) {
  return new Request("https://archive.example.com/logout", {
    method: "POST",
    headers: {
      Cookie: cookie.split(";", 1)[0],
      Origin: "https://archive.example.com"
    },
    body: new URLSearchParams({ csrf_token: csrfToken(cookie) })
  });
}

function csrfToken(cookie) {
  const value = cookie.match(/hanlim_session=([^;]+)/)?.[1];
  const payload = value?.split(".", 1)[0];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).csrfToken;
}

function sqliteEnv(database) {
  return {
    SESSION_SECRET,
    DB: {
      prepare(sql) {
        return d1Statement(database, sql);
      },
      async batch(statements) {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      }
    }
  };
}

function d1Statement(database, sql, args = []) {
  return {
    bind(...nextArgs) {
      return d1Statement(database, sql, nextArgs);
    },
    async first() {
      return database.prepare(sql).get(...args) ?? null;
    },
    async all() {
      return { results: database.prepare(sql).all(...args) };
    },
    async run() {
      const result = database.prepare(sql).run(...args);
      return {
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid || 0)
        }
      };
    }
  };
}

async function applyMigrations(database, maximum = Number.POSITIVE_INFINITY) {
  const names = (await readdir(MIGRATIONS_URL))
    .filter((name) => name.endsWith(".sql") && Number(name.slice(0, 4)) <= maximum)
    .sort();
  for (const name of names) await applyMigration(database, name);
}

async function applyMigrationsFrom(database, minimum, maximum = Number.POSITIVE_INFINITY) {
  const names = (await readdir(MIGRATIONS_URL))
    .filter((name) => {
      const number = Number(name.slice(0, 4));
      return name.endsWith(".sql") && number >= minimum && number <= maximum;
    })
    .sort();
  for (const name of names) await applyMigration(database, name);
}

async function applyMigration(database, name) {
  database.exec(await readFile(new URL(name, MIGRATIONS_URL), "utf8"));
}
