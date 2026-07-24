import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_SMOKE_PATH,
  resolveSmokeTarget,
  runReleaseSmoke,
  verifyReleasePublicSurface
} from "../scripts/smoke-release.mjs";

import { resolveAuthenticatedRoute } from "../src/app/routeRegistry.js";
import { PERMISSIONS } from "../src/permissions.js";
import { adminSettingsPage } from "../src/views/adminViews.js";
import { createPasswordRecord } from "../src/auth/passwords.js";
import worker from "../src/index.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

test("release smoke readiness gate rejects a healthy but operationally unready version", async () => {
  const responses = [
    new Response(JSON.stringify({ ok: true, workerVersion: "version-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }),
    new Response(JSON.stringify({ ok: false, workerVersion: "version-1" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    })
  ];
  await assert.rejects(
    runReleaseSmoke({
      baseUrl: "https://archive.example",
      username: "reader@example.com",
      password: "password",
      expectedWorkerVersion: "version-1",
      requireReadiness: true,
      healthAttempts: 1,
      allowedHosts: ["archive.example"],
      fetchImpl: async () => responses.shift()
    }),
    /\/readyz smoke/
  );
});

test("smoke URL은 credential 사용 전에 host·protocol·path를 거부한다", () => {
  assert.throws(() => resolveSmokeTarget("http://evil.example"), /https만/);
  assert.throws(() => resolveSmokeTarget("https://evil.example/login"), /path 없는 origin/);
  assert.throws(() => resolveSmokeTarget("https://evil.example?x=1"), /query\/hash/);
  assert.throws(() => resolveSmokeTarget("https://evil.example", { allowedHosts: ["archive.example"] }), /allowlist/);
  assert.deepEqual(
    resolveSmokeTarget("https://archive.example", { allowedHosts: ["archive.example"] }),
    { origin: "https://archive.example", hostname: "archive.example", protocol: "https:" }
  );
  assert.equal(resolveSmokeTarget("http://127.0.0.1:8787").hostname, "127.0.0.1");
});

test("운영 공개면 smoke는 HTTPS 전환과 asset MIME·304 재검증을 함께 확인한다", async () => {
  const target = resolveSmokeTarget("https://archive.example", { allowedHosts: ["archive.example"] });
  const calls = [];
  const contentTypes = new Map([
    ["/assets/app.css", "text/css; charset=utf-8"],
    ["/assets/app.js", "text/javascript; charset=utf-8"],
    ["/images/hanlim-pharm-logo.svg", "image/svg+xml"]
  ]);
  const result = await verifyReleasePublicSurface({
    target,
    fetchImpl: async (input, init = {}) => {
      const url = new URL(input);
      calls.push({ url: url.toString(), init });
      if (url.protocol === "http:") {
        return new Response(null, {
          status: 308,
          headers: { Location: "https://archive.example/login" }
        });
      }
      if (new Headers(init.headers).get("If-None-Match") === "*") {
        return new Response(null, { status: 304 });
      }
      return new Response("asset", {
        status: 200,
        headers: { "Content-Type": contentTypes.get(url.pathname) }
      });
    }
  });

  assert.equal(result.httpRedirect, 308);
  assert.deepEqual(result.assets, {
    "/assets/app.css": 200,
    "/assets/app.js": 200,
    "/images/hanlim-pharm-logo.svg": 200
  });
  assert.equal(calls.length, 7);
});

test("관리자 smoke는 route registry의 사용자 관리 GET 계약을 사용한다", () => {
  const resolved = resolveAuthenticatedRoute(ADMIN_SMOKE_PATH, "GET");
  assert.equal(ADMIN_SMOKE_PATH, "/admin/settings");
  assert.equal(resolved?.descriptor.id, "admin.settings");
  assert.equal(resolved?.descriptor.permission, PERMISSIONS.MANAGE_USERS);
  assert.equal(resolveAuthenticatedRoute("/admin/users", "GET"), null);
});

test("release smoke는 읽기 계정과 독립 Admin의 실제 관리 화면 접근을 함께 검증한다", async () => {
  const calls = [];
  const actualAdminSettingsPage = adminSettingsPage({
    session: { username: "admin@example.com", displayName: "관리자", role: "Admin", csrfToken: "csrf".repeat(8) },
    users: []
  });
  const responses = [
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    new Response('<form><input name="username"></form>', { status: 200 }),
    new Response("not found", { status: 404 }),
    new Response("", { status: 302, headers: { location: "/app?q=release-smoke", "set-cookie": "session=reader; Path=/" } }),
    new Response('<section data-viewer-app></section>', { status: 200 }),
    new Response("", { status: 302, headers: { location: ADMIN_SMOKE_PATH, "set-cookie": "session=admin; Path=/" } }),
    actualAdminSettingsPage
  ];
  const result = await runReleaseSmoke({
    baseUrl: "https://archive.example",
    username: "reader@example.com",
    password: "reader-password",
    adminUsername: "admin@example.com",
    adminPassword: "admin-password",
    requireAdmin: true,
    allowedHosts: ["archive.example"],
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return responses.shift();
    },
    waitImpl: async () => {}
  });
  assert.equal(result.adminSettings, 200);
  assert.equal(calls.at(-1).url, `https://archive.example${ADMIN_SMOKE_PATH}`);
  assert.match(calls.at(-1).init.headers.Cookie, /session=admin/);
});

test("release smoke는 migrated SQLite와 실제 Worker fetch 경로를 종단 검증한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const readerPassword = "reader-password-2026";
    const adminPassword = "admin-password-2026";
    const readerRecord = await createPasswordRecord(readerPassword);
    const adminRecord = await createPasswordRecord(adminPassword);
    const insert = database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash,
        status, role, approved_at, approved_by, must_change_password,
        security_review_required, session_epoch, can_manage_users
      ) VALUES (?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP, 'test-fixture', 0, 0, 0, ?)
    `);
    insert.run("reader@example.com", "읽기 사용자", readerRecord.salt, readerRecord.hash, "User", 0);
    insert.run("admin@example.com", "릴리스 관리 사용자", adminRecord.salt, adminRecord.hash, "User", 1);

    const env = {
      DB: sqliteD1(database),
      SESSION_SECRET: "release-smoke-test-secret-at-least-32-characters"
    };
    const result = await runReleaseSmoke({
      baseUrl: "https://archive.example",
      username: "reader@example.com",
      password: readerPassword,
      adminUsername: "admin@example.com",
      adminPassword,
      requireAdmin: true,
      requireSessionEpochCompatibility: true,
      allowedHosts: ["archive.example"],
      fetchImpl: (input, init) => worker.fetch(new Request(input, init), env),
      waitImpl: async () => {}
    });

    assert.deepEqual({ ...result }, {
      health: 200,
      login: 200,
      signup: 404,
      search: 200,
      origin: "https://archive.example",
      sessionEpochCompatibility: 1,
      adminSettings: 200
    });
  } finally {
    database.close();
  }
});

test("migration 전 smoke는 session-epoch 비호환 이전 Worker를 fail-closed한다", async () => {
  await assert.rejects(runReleaseSmoke({
    baseUrl: "https://archive.example",
    username: "reader@example.com",
    password: "reader-password",
    requireSessionEpochCompatibility: true,
    allowedHosts: ["archive.example"],
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }),
    waitImpl: async () => {}
  }), /호환 Worker를 먼저 배포/);
});

test("compatibility smoke는 edge의 old 200 뒤 marker가 있는 새 Worker까지 재시도한다", async () => {
  const calls = [];
  const waits = [];
  const responses = [
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ ok: true, rollbackCompatibility: { sessionEpoch: 1 }, workerVersion: "compat-v1" }), { status: 200, headers: { "content-type": "application/json" } }),
    new Response('<input name="username">', { status: 200 }),
    new Response("not found", { status: 404 }),
    new Response(null, { status: 302, headers: { location: "/app", "set-cookie": "hanlim_session=token; Path=/" } }),
    new Response('<main data-viewer-app></main>', { status: 200 })
  ];

  const result = await runReleaseSmoke({
    baseUrl: "https://archive.example",
    username: "reader@example.com",
    password: "reader-password",
    requireSessionEpochCompatibility: true,
    expectedWorkerVersion: "compat-v1",
    allowedHosts: ["archive.example"],
    fetchImpl: async (url) => {
      calls.push(url);
      return responses.shift();
    },
    waitImpl: async (milliseconds) => waits.push(milliseconds)
  });

  assert.equal(result.sessionEpochCompatibility, 1);
  assert.equal(result.workerVersion, "compat-v1");
  assert.equal(calls.filter((url) => url.endsWith("/healthz")).length, 2);
  assert.deepEqual(waits, [1_000]);
});

test("post-deploy smoke는 확장된 재시도 정책으로 늦게 전파된 Worker 버전을 확인한다", async () => {
  const waits = [];
  const responses = [
    new Response(JSON.stringify({ ok: true, rollbackCompatibility: { sessionEpoch: 1 }, workerVersion: "old-v1" }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, rollbackCompatibility: { sessionEpoch: 1 }, workerVersion: "old-v1" }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, rollbackCompatibility: { sessionEpoch: 1 }, workerVersion: "release-v2" }), { status: 200 }),
    new Response('<input name="username">', { status: 200 }),
    new Response("not found", { status: 404 }),
    new Response("", { status: 302, headers: { location: "/app", "set-cookie": "hanlim_session=token; Path=/" } }),
    new Response('<main data-viewer-app></main>', { status: 200 })
  ];

  const result = await runReleaseSmoke({
    baseUrl: "https://archive.example",
    username: "reader@example.com",
    password: "reader-password",
    requireSessionEpochCompatibility: true,
    expectedWorkerVersion: "release-v2",
    healthAttempts: 3,
    healthRetryMs: 25,
    allowedHosts: ["archive.example"],
    fetchImpl: async () => responses.shift(),
    waitImpl: async (milliseconds) => waits.push(milliseconds)
  });

  assert.equal(result.workerVersion, "release-v2");
  assert.deepEqual(waits, [25, 25]);
});

test("Worker 버전 전파 제한시간 오류는 기대·관측 버전과 시도 횟수를 남긴다", async () => {
  await assert.rejects(runReleaseSmoke({
    baseUrl: "https://archive.example",
    username: "reader@example.com",
    password: "reader-password",
    expectedWorkerVersion: "release-v2",
    healthAttempts: 2,
    healthRetryMs: 1,
    allowedHosts: ["archive.example"],
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, workerVersion: "old-v1" }), { status: 200 }),
    waitImpl: async () => {}
  }), /expected=release-v2, observed=old-v1, attempts=2/);
});

test("smoke 재시도 설정은 제한 범위를 벗어나면 네트워크 요청 전에 거부한다", async () => {
  let fetchCount = 0;
  await assert.rejects(runReleaseSmoke({
    baseUrl: "https://archive.example",
    username: "reader@example.com",
    password: "reader-password",
    healthAttempts: 121,
    allowedHosts: ["archive.example"],
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  }), /SMOKE_HEALTH_ATTEMPTS은 1 이상 120 이하/);
  assert.equal(fetchCount, 0);
});

test("관리자 smoke는 제목만 있는 임의 200 응답을 관리 화면으로 인정하지 않는다", async () => {
  const responses = [
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    new Response('<form><input name="username"></form>', { status: 200 }),
    new Response("not found", { status: 404 }),
    new Response("", { status: 302, headers: { location: "/app?q=release-smoke", "set-cookie": "session=reader; Path=/" } }),
    new Response('<section data-viewer-app></section>', { status: 200 }),
    new Response("", { status: 302, headers: { location: ADMIN_SMOKE_PATH, "set-cookie": "session=admin; Path=/" } }),
    new Response("<h1>사용자 관리</h1>", { status: 200 })
  ];

  await assert.rejects(runReleaseSmoke({
    baseUrl: "https://archive.example",
    username: "reader@example.com",
    password: "reader-password",
    adminUsername: "admin@example.com",
    adminPassword: "admin-password",
    requireAdmin: true,
    allowedHosts: ["archive.example"],
    fetchImpl: async () => responses.shift(),
    waitImpl: async () => {}
  }), /관리자 설정 접근 smoke 실패/);
});
