import assert from "node:assert/strict";
import test from "node:test";

import { createSessionCookie } from "../src/auth.js";
import { verifyPassword } from "../src/auth/passwords.js";
import {
  createApprovedUser,
  validateApprovedUser
} from "../src/domains/identity/index.js";
import { handleApprovedUserCreate } from "../src/handlers/adminHandlers.js";
import { approvedUserCreatePage, adminSettingsPage } from "../src/views/adminViews.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";
import worker from "../src/index.js";

const actor = {
  userId: 1,
  username: "admin@hanlim.com",
  displayName: "시스템 관리자",
  role: "Admin",
  csrfToken: "csrf-approved-user"
};
const SESSION_SECRET = "approved-user-test-session-secret-2026";

test("승인 사용자 입력은 이메일·이름·부서와 보호 계정을 fail-closed로 검증한다", () => {
  assert.deepEqual(validateApprovedUser({
    username: " New.User@Hanlim.com ",
    displayName: " 신규 사용자 ",
    team: " SQA팀 "
  }), {
    ok: true,
    values: {
      username: "new.user@hanlim.com",
      displayName: "신규 사용자",
      team: "SQA팀"
    }
  });
  assert.equal(validateApprovedUser({ username: "not-an-email", displayName: "사용자" }).ok, false);
  assert.equal(validateApprovedUser({ username: "user@hanlim.com", displayName: "" }).ok, false);
  assert.equal(validateApprovedUser({
    username: "user@hanlim.com",
    displayName: "사용자",
    team: "가".repeat(41)
  }).ok, false);
  assert.match(validateApprovedUser({
    username: "nkh92@hanlim.com",
    displayName: "보호 계정"
  }).message, /보호된 운영 계정/);
});

test("시스템관리자는 승인된 조회 전용 계정을 감사와 함께 원자적으로 추가한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = { DB: sqliteD1(database) };
    const temporaryPassword = "temporary-password-2026";
    const result = await createApprovedUser(env, {
      username: " New.User@Hanlim.com ",
      displayName: " 신규 사용자 ",
      team: " SQA팀 ",
      temporaryPassword
    }, actor);
    assert.deepEqual(result, {
      ok: true,
      username: "new.user@hanlim.com",
      displayName: "신규 사용자"
    });

    const account = database.prepare(`
      SELECT username, display_name, team, status, role, role_template_key,
        must_change_password, security_review_required, approved_by,
        can_manage_documents, can_move_documents, can_manage_disposals,
        can_manage_sets, can_manage_masters, can_manage_users, can_view_audit,
        can_apply_document_snapshots, password_salt, password_hash
      FROM app_users WHERE username = ?
    `).get("new.user@hanlim.com");
    assert.deepEqual({
      username: account.username,
      displayName: account.display_name,
      team: account.team,
      status: account.status,
      role: account.role,
      roleTemplateKey: account.role_template_key,
      mustChangePassword: account.must_change_password,
      securityReviewRequired: account.security_review_required,
      approvedBy: account.approved_by
    }, {
      username: "new.user@hanlim.com",
      displayName: "신규 사용자",
      team: "SQA팀",
      status: "approved",
      role: "User",
      roleTemplateKey: "viewer",
      mustChangePassword: 1,
      securityReviewRequired: 0,
      approvedBy: "admin@hanlim.com"
    });
    assert.equal([
      account.can_manage_documents,
      account.can_move_documents,
      account.can_manage_disposals,
      account.can_manage_sets,
      account.can_manage_masters,
      account.can_manage_users,
      account.can_view_audit,
      account.can_apply_document_snapshots
    ].every((permission) => permission === 0), true);
    assert.equal(await verifyPassword(temporaryPassword, account.password_salt, account.password_hash), true);

    const audit = database.prepare(`
      SELECT action, actor_username_snapshot, summary, details_json
      FROM system_audit_logs
      WHERE entity_type = 'user' AND entity_reference = ? AND action = 'create_approved'
    `).get("new.user@hanlim.com");
    assert.equal(audit.actor_username_snapshot, "admin@hanlim.com");
    assert.equal(audit.summary, "승인 사용자 추가");
    assert.equal(JSON.parse(audit.details_json).after.roleTemplateKey, "viewer");
    assert.doesNotMatch(audit.details_json, /temporary-password-2026/);
    assert.doesNotMatch(audit.details_json, /passwordHash|passwordSalt/);
  } finally {
    database.close();
  }
});

test("승인 사용자 추가는 중복·비관리자·과대 비밀번호에서 계정과 감사를 만들지 않는다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = { DB: sqliteD1(database) };
    const input = {
      username: "duplicate@hanlim.com",
      displayName: "중복 사용자",
      temporaryPassword: "temporary-password-2026"
    };
    assert.equal((await createApprovedUser(env, input, actor)).ok, true);
    const duplicate = await createApprovedUser(env, input, actor);
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM system_audit_logs
      WHERE entity_reference = ? AND action = 'create_approved'
    `).get(input.username).count, 1);

    const regular = await createApprovedUser(env, {
      ...input,
      username: "blocked-regular@hanlim.com"
    }, { ...actor, role: "User" });
    assert.equal(regular.ok, false);
    const oversized = await createApprovedUser(env, {
      ...input,
      username: "oversized@hanlim.com",
      temporaryPassword: "가".repeat(400)
    }, actor);
    assert.equal(oversized.ok, false);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM app_users
      WHERE username IN ('blocked-regular@hanlim.com', 'oversized@hanlim.com')
    `).get().count, 0);
  } finally {
    database.close();
  }
});

test("승인 사용자 화면은 시스템관리자에게만 생성 동선을 노출하고 비밀번호를 재표시하지 않는다", async () => {
  const adminHtml = await adminSettingsPage({ session: actor, users: [] }).text();
  assert.match(adminHtml, /href="\/admin\/users\/new"[^>]*>승인 사용자 추가<\/a>/);
  const delegatedHtml = await adminSettingsPage({
    session: { ...actor, role: "User", can_manage_users: 1 },
    users: []
  }).text();
  assert.doesNotMatch(delegatedHtml, /href="\/admin\/users\/new"/);

  const html = await approvedUserCreatePage({
    session: actor,
    values: {
      username: "user@hanlim.com",
      displayName: "<신규>",
      team: "SQA팀"
    },
    error: "입력 오류",
    minLength: 6
  }).text();
  assert.match(html, /action="\/admin\/users\/new"/);
  assert.match(html, /name="username"[^>]*value="user@hanlim\.com"/);
  assert.match(html, /value="&lt;신규&gt;"/);
  assert.match(html, /name="temporaryPassword"[^>]*autocomplete="new-password"/);
  assert.doesNotMatch(html, /value="temporary-password/);
  assert.match(html, /일반 사용자·조회 전용/);
});

test("승인 사용자 핸들러는 비밀번호 불일치 시 비민감 입력만 보존한다", async () => {
  const request = new Request("https://archive.example.com/admin/users/new", {
    method: "POST",
    body: new URLSearchParams({
      username: "user@hanlim.com",
      displayName: "사용자",
      team: "SQA팀",
      temporaryPassword: "first-password",
      confirmPassword: "other-password",
      confirmCreate: "1"
    })
  });
  const response = await handleApprovedUserCreate(request, {}, actor);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /임시 비밀번호가 일치하지 않습니다/);
  assert.match(html, /value="user@hanlim\.com"/);
  assert.doesNotMatch(html, /first-password|other-password/);
});

test("실제 Worker 경로는 시스템관리자에게만 승인 사용자 GET·POST를 허용한다", async () => {
  const database = await createMigratedDatabase();
  try {
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role,
        must_change_password, security_review_required, session_epoch, role_template_key,
        can_manage_users
      ) VALUES (?, ?, 'salt', 'hash', 'approved', ?, 0, 0, 0, ?, ?)
    `).run("route-admin@hanlim.com", "라우트 관리자", "Admin", "system_admin", 1);
    database.prepare(`
      INSERT INTO app_users (
        username, display_name, password_salt, password_hash, status, role,
        must_change_password, security_review_required, session_epoch, role_template_key,
        can_manage_users
      ) VALUES (?, ?, 'salt', 'hash', 'approved', 'User', 0, 0, 0, NULL, 1)
    `).run("delegated@hanlim.com", "권한 위임 사용자");
    const env = { DB: sqliteD1(database), SESSION_SECRET };
    const adminCookie = await createSessionCookie({
      username: "route-admin@hanlim.com",
      displayName: "라우트 관리자",
      role: "Admin",
      sessionEpoch: 0
    }, env, false);
    const adminHeaders = { Cookie: adminCookie.split(";", 1)[0] };
    const formResponse = await worker.fetch(new Request(
      "https://archive.example.com/admin/users/new",
      { headers: adminHeaders }
    ), env);
    assert.equal(formResponse.status, 200);
    assert.match(await formResponse.text(), /승인 사용자 추가/);

    const csrfToken = sessionCsrfToken(adminCookie);
    const createResponse = await worker.fetch(new Request(
      "https://archive.example.com/admin/users/new",
      {
        method: "POST",
        headers: { ...adminHeaders, Origin: "https://archive.example.com" },
        body: new URLSearchParams({
          csrf_token: csrfToken,
          username: "worker-created@hanlim.com",
          displayName: "Worker 생성 사용자",
          team: "SQA팀",
          temporaryPassword: "temporary-password-2026",
          confirmPassword: "temporary-password-2026",
          confirmCreate: "1"
        })
      }
    ), env);
    assert.equal(createResponse.status, 302);
    assert.equal(createResponse.headers.get("Location"), "/admin/settings?toast=user-created");
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM app_users
      WHERE username = 'worker-created@hanlim.com' AND status = 'approved'
    `).get().count, 1);

    const delegatedCookie = await createSessionCookie({
      username: "delegated@hanlim.com",
      displayName: "권한 위임 사용자",
      role: "User",
      sessionEpoch: 0,
      can_manage_users: 1
    }, env, false);
    const denied = await worker.fetch(new Request(
      "https://archive.example.com/admin/users/new",
      { headers: { Cookie: delegatedCookie.split(";", 1)[0] } }
    ), env);
    assert.equal(denied.status, 403);
  } finally {
    database.close();
  }
});

function sessionCsrfToken(cookie) {
  const payload = cookie.split(";", 1)[0].split("=", 2)[1].split(".", 1)[0];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).csrfToken;
}
