#!/usr/bin/env node
/**
 * Execute the compatibility Worker against both the pre-0036 schema and the
 * full release schema. This is used before the one-time compatibility deploy.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SESSION_SECRET = "compatibility-verification-secret-at-least-32-characters";
const KNOWN_BOOTSTRAP_USERNAME = "nkh92@hanlim.com";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function sqliteD1(database) {
  const statement = (sql, args = []) => ({
    bind(...nextArgs) { return statement(sql, nextArgs); },
    async first() { return database.prepare(sql).get(...args) ?? null; },
    async all() { return { results: database.prepare(sql).all(...args) }; },
    async run() {
      const result = database.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
    }
  });
  return { prepare(sql) { return statement(sql); } };
}

async function applyMigrations(database, appRoot, { minimum = 1, maximum = Number.POSITIVE_INFINITY } = {}) {
  const migrationsDir = resolve(appRoot, "migrations");
  const names = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .filter((name) => {
      const number = Number(name.slice(0, 4));
      return number >= minimum && number <= maximum;
    })
    .sort();
  for (const name of names) database.exec(await readFile(resolve(migrationsDir, name), "utf8"));
}

function cookieRequest(cookie) {
  return new Request("https://archive.example.com/app", {
    headers: { Cookie: cookie.split(";", 1)[0] }
  });
}

async function main() {
  const compatRoot = resolve(argument("--compat-app-root"));
  const releaseRoot = resolve(argument("--release-app-root"));
  if (!argument("--compat-app-root") || !argument("--release-app-root")) {
    throw new Error("--compat-app-root and --release-app-root are required");
  }

  const auth = await import(pathToFileURL(resolve(compatRoot, "src", "auth.js")).href);
  const { handleLogout } = await import(pathToFileURL(resolve(compatRoot, "src", "handlers", "sessionHandlers.js")).href);
  const worker = (await import(pathToFileURL(resolve(compatRoot, "src", "index.js")).href)).default;
  const database = new DatabaseSync(":memory:");
  try {
    await applyMigrations(database, compatRoot);
    const env = {
      DB: sqliteD1(database),
      SESSION_SECRET,
      CF_VERSION_METADATA: { id: "compat-verification-version" }
    };
    const password = "compat-user-password-2026";
    const preMigrationPassword = "compat-user-password-pre-2026";
    const postMigrationPassword = "compat-user-password-post-2026";
    const passwordRecord = await auth.createPasswordRecord(password);
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role,
        approved_at, approved_by, must_change_password
      ) VALUES ('compat-user@hanlim.com', '호환 검증', ?, ?, 'approved', 'User', CURRENT_TIMESTAMP, 'test', 0)
    `).run(passwordRecord.salt, passwordRecord.hash);

    assert.equal(await auth.validateUser(env, KNOWN_BOOTSTRAP_USERNAME, "123456"), null);
    const blockedBootstrapCookie = await auth.createSessionCookie({
      username: KNOWN_BOOTSTRAP_USERNAME,
      displayName: "차단 계정",
      role: "Admin",
      sessionEpoch: 0
    }, env);
    assert.equal(await auth.readSession(cookieRequest(blockedBootstrapCookie), env), null);

    const preUser = await auth.validateUser(env, "compat-user@hanlim.com", password);
    assert.equal(preUser.sessionEpoch, 0);
    const preCookie = await auth.createSessionCookie(preUser, env);
    const preSession = await auth.readSession(cookieRequest(preCookie), env);
    assert.equal(preSession.username, "compat-user@hanlim.com");
    assert.equal((await worker.fetch(new Request("https://archive.example.com/healthz"), env)).status, 200);
    await handleLogout(new URL("https://archive.example.com/logout"), env, preSession);
    const prePasswordResult = await auth.changeUserPassword(env, preUser.username, password, preMigrationPassword);
    assert.deepEqual(prePasswordResult, { ok: true, sessionEpoch: 0 });

    await applyMigrations(database, releaseRoot, { minimum: 31 });
    const postUser = await auth.validateUser(env, "compat-user@hanlim.com", preMigrationPassword);
    assert.equal(postUser.sessionEpoch, 0);
    const copiedLogoutCookie = await auth.createSessionCookie(postUser, env);
    const postSession = await auth.readSession(cookieRequest(copiedLogoutCookie), env);
    await handleLogout(new URL("https://archive.example.com/logout"), env, postSession);
    assert.equal(await auth.readSession(cookieRequest(copiedLogoutCookie), env), null);

    const passwordUser = await auth.validateUser(env, "compat-user@hanlim.com", preMigrationPassword);
    const copiedPasswordCookie = await auth.createSessionCookie(passwordUser, env);
    const changed = await auth.changeUserPassword(
      env,
      passwordUser.username,
      preMigrationPassword,
      postMigrationPassword
    );
    assert.equal(changed.ok, true);
    assert.equal(changed.sessionEpoch, passwordUser.sessionEpoch + 1);
    assert.equal(await auth.readSession(cookieRequest(copiedPasswordCookie), env), null);
    const freshCookie = await auth.createSessionCookie({ ...passwordUser, sessionEpoch: changed.sessionEpoch }, env);
    assert.equal((await auth.readSession(cookieRequest(freshCookie), env)).username, passwordUser.username);

    const health = await worker.fetch(new Request("https://archive.example.com/healthz"), env);
    const healthBody = await health.json();
    assert.equal(healthBody.rollbackCompatibility.sessionEpoch, 1);
    assert.equal(healthBody.workerVersion, "compat-verification-version");
    console.log("session-epoch compatibility verified against pre-0036 and full release schemas");
  } finally {
    database.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`[session-epoch-compat] ${error.stack || error.message}`);
  process.exit(1);
}
