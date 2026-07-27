import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hasAnyPermission,
  hasPermission,
  PERMISSION_KEYS,
  PERMISSIONS,
  samePermissions,
  sessionHasManagementAccess
} from "../src/permissions.js";
import { requireManagementAccess, requirePermission } from "../src/handlers/permissionGuards.js";
import { handleUserPermissions } from "../src/handlers/userPermissionHandlers.js";
import { userPermissionsPage } from "../src/views/permissionViews.js";
import { adminSettingsPage } from "../src/views/adminViews.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

const adminSession = {
  userId: 1,
  username: "admin",
  displayName: "관리자",
  role: "Admin",
  csrfToken: "token".repeat(8)
};

function insertApprovedUser(database, username) {
  database.prepare(`
    INSERT INTO app_users (
      username, display_name, password_salt, password_hash, status, role, role_template_key, row_version
    ) VALUES (?, ?, 'salt', 'hash', 'approved', 'User', 'viewer', 1)
  `).run(username, username);
  return Number(database.prepare("SELECT id FROM app_users WHERE username = ?").get(username).id);
}

function permissionRequest(id, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(`https://archive.example.com/admin/users/${id}/permissions`, {
    method: "POST",
    body: form
  });
}

test("Admin은 세부 플래그와 관계없이 모든 권한을 가진다", () => {
  const admin = { role: "Admin" };
  for (const permission of PERMISSION_KEYS) {
    assert.equal(hasPermission(admin, permission), true);
  }
  assert.equal(sessionHasManagementAccess(admin), true);
});

test("User는 DB 권한 플래그에 해당하는 기능만 사용할 수 있다", async () => {
  const user = { role: "User", can_manage_documents: 1, can_view_audit: "1" };
  assert.equal(hasPermission(user, PERMISSIONS.MANAGE_DOCUMENTS), true);
  assert.equal(hasPermission(user, PERMISSIONS.VIEW_AUDIT), true);
  assert.equal(hasPermission(user, PERMISSIONS.MANAGE_USERS), false);
  assert.equal(hasPermission(user, "unknown"), false);
  assert.equal(hasAnyPermission(user, [PERMISSIONS.MANAGE_USERS, PERMISSIONS.VIEW_AUDIT]), true);
  assert.equal(requireManagementAccess(user), null);

  assert.equal(requirePermission(user, PERMISSIONS.MANAGE_DOCUMENTS), null);
  const denied = requirePermission(user, PERMISSIONS.MANAGE_USERS);
  assert.equal(denied.status, 403);
  assert.match(await denied.text(), /접근 권한/);
});

test("코드에는 역할 정의 상수를 두지 않고 플래그 비교만 제공한다", async () => {
  const source = await readFile(new URL("../src/permissions.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /PERMISSION_PRESETS|permissionsForPreset|matchingPermissionPreset/);
  assert.doesNotMatch(source, /archive_manager|disposal_manager|operations_admin/);

  assert.equal(samePermissions({ can_manage_documents: 1 }, { can_manage_documents: true }), true);
  assert.equal(samePermissions({ can_manage_documents: 1 }, { can_move_documents: 1 }), false);
  assert.equal(samePermissions({}, {}), true);
});

test("사용자 권한 화면은 DB 역할 템플릿 3종과 개별 예외 권한을 제공한다", async () => {
  const templates = [
    { key: "viewer", label: "조회", row_version: 1 },
    { key: "document_manager", label: "문서관리", can_manage_documents: 1, can_move_documents: 1, row_version: 1 },
    { key: "system_admin", label: "시스템관리", ...Object.fromEntries(PERMISSION_KEYS.map((key) => [key, 1])), row_version: 1 }
  ];
  const response = userPermissionsPage({
    session: { role: "Admin", username: "admin", displayName: "관리자", csrfToken: "token".repeat(8) },
    user: {
      id: 7,
      username: "viewer<script>",
      display_name: "조회자",
      role_template_key: null,
      row_version: 3,
      can_manage_documents: 1
    },
    templates
  });
  const html = await response.text();

  assert.match(html, />조회</);
  assert.match(html, />문서관리</);
  assert.match(html, />시스템관리</);
  assert.match(html, /현재 구성: 사용자 지정/);
  assert.match(html, /name="expectedRowVersion" value="3"/);
  assert.match(html, /name="templateVersions" value="[^"]*&quot;document_manager&quot;:1[^"]*"/);
  assert.match(html, /역할을 선택해 저장하면 서버가 그 역할의 표준 권한을 그대로 적용합니다/);
  for (const permission of PERMISSION_KEYS) {
    assert.match(html, new RegExp(`name="${permission}"`));
  }
  assert.doesNotMatch(html, /viewer<script>/);
  assert.match(html, /viewer&lt;script&gt;/);
});

test("역할을 선택한 저장은 체크박스 없이도 서버가 템플릿 권한을 적용한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = { DB: sqliteD1(database) };
    const id = insertApprovedUser(database, "role-target");
    const response = await handleUserPermissions(
      permissionRequest(id, {
        confirmPermissions: "1",
        templateKey: "document_manager",
        templateVersions: JSON.stringify({ viewer: 1, document_manager: 1, system_admin: 1 }),
        expectedRowVersion: "1"
      }),
      env,
      adminSession,
      id
    );

    assert.equal(response.status, 302);
    const saved = database.prepare(`
      SELECT role_template_key, can_manage_documents, can_move_documents,
        can_manage_disposals, can_manage_sets, can_manage_users, row_version
      FROM app_users WHERE id = ?
    `).get(id);
    assert.deepEqual({ ...saved }, {
      role_template_key: "document_manager",
      can_manage_documents: 1,
      can_move_documents: 1,
      can_manage_disposals: 1,
      can_manage_sets: 1,
      can_manage_users: 0,
      row_version: 2
    });
  } finally {
    database.close();
  }
});

test("사용자 지정 저장만 체크박스를 사용하고, 편집된 템플릿 저장은 거부한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const env = { DB: sqliteD1(database) };
    const id = insertApprovedUser(database, "custom-target");

    const custom = await handleUserPermissions(
      permissionRequest(id, {
        confirmPermissions: "1",
        templateKey: "custom",
        templateVersions: JSON.stringify({ viewer: 1, document_manager: 1, system_admin: 1 }),
        expectedRowVersion: "1",
        can_move_documents: "1"
      }),
      env,
      adminSession,
      id
    );
    assert.equal(custom.status, 302);
    const saved = database.prepare(`
      SELECT role_template_key, can_manage_documents, can_move_documents, row_version
      FROM app_users WHERE id = ?
    `).get(id);
    assert.deepEqual({ ...saved }, {
      role_template_key: null,
      can_manage_documents: 0,
      can_move_documents: 1,
      row_version: 2
    });

    database.prepare("UPDATE user_role_templates SET row_version = row_version + 1 WHERE key = 'viewer'").run();
    const stale = await handleUserPermissions(
      permissionRequest(id, {
        confirmPermissions: "1",
        templateKey: "viewer",
        templateVersions: JSON.stringify({ viewer: 1, document_manager: 1, system_admin: 1 }),
        expectedRowVersion: "2"
      }),
      env,
      adminSession,
      id
    );
    assert.equal(stale.status, 200);
    assert.match(await stale.text(), /역할 템플릿이 변경되었습니다/);
    assert.equal(database.prepare("SELECT row_version FROM app_users WHERE id = ?").get(id).row_version, 2);
  } finally {
    database.close();
  }
});

test("사용자 관리 화면은 반려와 사용중지를 분리한다", async () => {
  const response = adminSettingsPage({
    session: { role: "Admin", username: "admin", displayName: "관리자", csrfToken: "token".repeat(8) },
    users: [
      { id: 7, username: "active", display_name: "사용자", role: "User", status: "approved" },
      { id: 8, username: "disabled", display_name: "중지", role: "User", status: "disabled" },
      { id: 9, username: "pending", display_name: "대기", role: "User", status: "pending" },
      {
        id: 10,
        username: "review-locked",
        display_name: "보안 검토",
        role: "User",
        status: "rejected",
        security_review_required: 1
      }
    ]
  });
  const html = await response.text();

  assert.match(html, /사용중지 사용자/);
  assert.match(html, /action="\/admin\/users\/7\/disable"/);
  assert.match(html, /action="\/admin\/users\/8\/enable"/);
  assert.match(html, /href="\/admin\/users\/7\/permissions"/);
  assert.match(html, /href="\/admin\/users\/7\/reset-password"/);
  assert.match(html, /href="\/admin\/users\/8\/reset-password"/);
  assert.match(html, /action="\/admin\/users\/9\/reject"/);
  assert.doesNotMatch(html, /action="\/admin\/users\/7\/reject"/);
  assert.match(html, /보안 검토 필요/);
  assert.match(html, /보안 검토 대상 · 일반 재승인 불가/);
  assert.doesNotMatch(html, /action="\/admin\/users\/10\/approve"/);
  assert.doesNotMatch(html, /href="\/admin\/users\/10\/permissions"/);
  assert.doesNotMatch(html, /href="\/admin\/users\/10\/reset-password"/);
});

test("사용자 관리 화면은 세 그룹을 접힌 행으로 쌓고 완전삭제 경로를 제공한다", async () => {
  const session = { role: "Admin", username: "admin", userId: 1, displayName: "관리자", csrfToken: "token".repeat(8) };
  const html = await adminSettingsPage({
    session,
    users: [
      { id: 1, username: "admin", display_name: "관리자", role: "Admin", status: "approved" },
      { id: 7, username: "active", display_name: "사용자", role: "User", status: "approved" },
      { id: 8, username: "disabled", display_name: "중지", role: "User", status: "disabled" },
      { id: 10, username: "review-locked", display_name: "보안 검토", role: "User", status: "rejected", security_review_required: 1 }
    ]
  }).text();

  // 3열 병렬 배치를 3행 접힘 그룹으로 바꾼다. 기본 상태는 접힘이므로 open 속성이 없다.
  assert.doesNotMatch(html, /<section class="two-col">/);
  assert.match(html, /class="user-group-stack"/);
  assert.equal((html.match(/<details class="panel user-group">/g) || []).length, 3);
  assert.doesNotMatch(html, /<details class="panel user-group" open>/);
  for (const label of ["승인된 사용자", "사용중지 사용자", "반려된 요청"]) {
    assert.match(html, new RegExp(`user-group-title">${label}<`));
  }

  // 완전삭제는 목록에서 즉시 실행하지 않고 확인 화면으로 이동한다.
  assert.match(html, /href="\/admin\/users\/7\/delete"/);
  assert.match(html, /href="\/admin\/users\/10\/delete"/, "보안 검토 대상도 정리할 수 있다");
  assert.doesNotMatch(html, /action="\/admin\/users\/\d+\/delete"/);
  assert.doesNotMatch(html, /href="\/admin\/users\/1\/delete"/, "현재 로그인 계정은 삭제 경로를 노출하지 않는다");
});
