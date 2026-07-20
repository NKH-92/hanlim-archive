import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAnyPermission,
  hasPermission,
  PERMISSION_KEYS,
  PERMISSIONS,
  permissionsForPreset,
  sessionHasManagementAccess
} from "../src/permissions.js";
import { requireManagementAccess, requirePermission } from "../src/handlers/permissionGuards.js";
import { userPermissionsPage } from "../src/views/permissionViews.js";
import { adminSettingsPage } from "../src/views/adminViews.js";

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

test("권한 프리셋은 복수 권한과 사용자 지정을 안정적으로 매핑한다", () => {
  const archiveManager = permissionsForPreset("archive_manager");
  assert.equal(archiveManager.can_manage_documents, true);
  assert.equal(archiveManager.can_move_documents, true);
  assert.equal(archiveManager.can_manage_sets, true);
  assert.equal(archiveManager.can_manage_disposals, false);

  const custom = permissionsForPreset("custom", { can_manage_users: true });
  assert.equal(custom.can_manage_users, true);
  assert.equal(custom.can_view_audit, false);

  const systemAdmin = permissionsForPreset("system_admin");
  assert.ok(PERMISSION_KEYS.every((permission) => systemAdmin[permission]));
});

test("사용자 권한 화면은 프리셋과 개별 권한을 제공한다", async () => {
  const response = userPermissionsPage({
    session: { role: "Admin", username: "admin", displayName: "관리자", csrfToken: "token".repeat(8) },
    user: {
      id: 7,
      username: "viewer<script>",
      display_name: "조회자",
      can_manage_documents: 1
    }
  });
  const html = await response.text();

  assert.match(html, /문서고 담당자/);
  assert.match(html, /폐기 담당자/);
  assert.match(html, /시스템 관리자/);
  for (const permission of PERMISSION_KEYS) {
    assert.match(html, new RegExp(`name="${permission}"`));
  }
  assert.doesNotMatch(html, /viewer<script>/);
  assert.match(html, /viewer&lt;script&gt;/);
});

test("사용자 관리 화면은 반려와 사용중지를 분리한다", async () => {
  const response = adminSettingsPage({
    session: { role: "Admin", username: "admin", displayName: "관리자", csrfToken: "token".repeat(8) },
    users: [
      { id: 7, username: "active", display_name: "사용자", role: "User", status: "approved" },
      { id: 8, username: "disabled", display_name: "중지", role: "User", status: "disabled" },
      { id: 9, username: "pending", display_name: "대기", role: "User", status: "pending" }
    ]
  });
  const html = await response.text();

  assert.match(html, /사용중지 사용자/);
  assert.match(html, /action="\/admin\/users\/7\/disable"/);
  assert.match(html, /action="\/admin\/users\/8\/enable"/);
  assert.match(html, /href="\/admin\/users\/7\/permissions"/);
  assert.match(html, /action="\/admin\/users\/9\/reject"/);
  assert.doesNotMatch(html, /action="\/admin\/users\/7\/reject"/);
});
