import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { validateUser } from "../src/auth.js";
import worker from "../src/index.js";

const SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
const INITIAL_EMAIL = "nkh92@hanlim.com";
const MIGRATIONS_URL = new URL("../migrations/", import.meta.url);

test("0027 migration은 최초 관리자와 기본 비밀번호 변경 상태를 등록한다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database);
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

test("기본 비밀번호 로그인은 returnUrl을 무시하고 변경 완료 전 모든 기능을 차단한다", async () => {
  const database = new DatabaseSync(":memory:");

  try {
    await applyMigrations(database);
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

    const logout = await worker.fetch(logoutRequest(cookie), env);
    assert.equal(logout.status, 302);
    assert.equal(logout.headers.get("Location"), "/login");

    const changed = await worker.fetch(passwordChangeRequest(cookie, "123456", "new-password-2026"), env);
    assert.equal(changed.status, 302);
    assert.equal(changed.headers.get("Location"), "/app?toast=password-changed");
    assert.equal(database.prepare("SELECT must_change_password FROM app_users WHERE username = ?").get(INITIAL_EMAIL).must_change_password, 0);

    assert.equal(await validateUser(env, INITIAL_EMAIL, "123456"), null);
    assert.equal((await validateUser(env, INITIAL_EMAIL, "new-password-2026")).mustChangePassword, false);

    const app = await worker.fetch(authenticatedRequest("/app", cookie), env);
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

async function applyMigration(database, name) {
  database.exec(await readFile(new URL(name, MIGRATIONS_URL), "utf8"));
}
