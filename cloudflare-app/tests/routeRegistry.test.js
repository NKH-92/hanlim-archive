import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "../src/permissions.js";
import {
  AUTHENTICATED_ROUTES,
  PUBLIC_ROUTES,
  ROUTES,
  resolveAuthenticatedRoute,
  resolvePublicRoute,
  routeCollisions,
  routeStatus,
  urlFor
} from "../src/app/routeRegistry.js";

test("route registry는 id·method 충돌 없이 public/authenticated 경계를 완전하게 표현한다", () => {
  assert.equal(new Set(ROUTES.map((item) => item.id)).size, ROUTES.length);
  assert.deepEqual(routeCollisions(), []);
  assert.equal(PUBLIC_ROUTES.every((item) => item.auth === "public"), true);
  assert.equal(AUTHENTICATED_ROUTES.every((item) => item.auth === "required"), true);
});

test("matcher와 named URL builder는 정적 route를 동적 parameter보다 우선한다", () => {
  assert.equal(resolveAuthenticatedRoute("/documents/disposal", "GET").descriptor.id, "documents.disposal");
  assert.deepEqual(resolveAuthenticatedRoute("/disposal-batches/7/items/9/exclude", "POST").params, { id: 7, itemId: 9 });
  assert.equal(resolvePublicRoute("/assets/app.css", "GET").descriptor.id, "assets.generated");
  assert.equal(resolvePublicRoute("/images/floor/zone1.svg", "GET").descriptor.id, "assets.images");
  assert.equal(urlFor("documents.edit", { id: 42 }, { returnTo: "/sets/1" }), "/documents/42/edit?returnTo=%2Fsets%2F1");
  const manifestId = "EXP-123e4567-e89b-12d3-a456-426614174000";
  assert.deepEqual(
    resolveAuthenticatedRoute(`/document-snapshot-exports/${manifestId}/rows`, "GET").params,
    { manifestId }
  );
  assert.equal(
    urlFor("documents.snapshot.export.finalize", { manifestId }),
    `/document-snapshot-exports/${manifestId}/finalize`
  );
});

test("registry는 제거된 완전삭제 POST와 미지원 경로를 404로 유지하고 method mismatch만 405로 구분한다", () => {
  assert.equal(routeStatus("/documents/7", "GET"), 200);
  assert.equal(routeStatus("/documents/7", "PATCH"), 405);
  assert.equal(resolveAuthenticatedRoute("/documents/7/delete-permanent", "POST"), null);
  assert.equal(routeStatus("/documents/7/delete-permanent", "POST"), 404);
  assert.equal(routeStatus("/not-supported", "GET"), 404);
});

test("고급 영역으로 이동한 도구는 기존 route와 permission 계약을 유지한다", () => {
  const permissionById = new Map(AUTHENTICATED_ROUTES.map((item) => [item.id, item.permission]));
  assert.equal(permissionById.get("imports.list"), "can_manage_documents");
  assert.equal(permissionById.get("admin.data-quality"), "can_manage_documents");
  assert.equal(permissionById.get("admin.search-report"), "can_view_audit");
  assert.equal(permissionById.get("sets.list"), null);
  assert.equal(permissionById.get("documents.import.form"), "can_manage_documents");
  assert.equal(permissionById.get("documents.disposal"), "can_manage_disposals");
});

test("모든 인증 POST descriptor는 Origin·CSRF를 요구하고 permission key는 catalog에 존재한다", () => {
  const posts = AUTHENTICATED_ROUTES.filter((item) => item.method === "POST");
  assert.equal(posts.every((item) => item.security.origin && item.security.csrf && item.security.forcedPassword), true);
  const invalid = ROUTES.filter((item) => {
    if (!item.permission) return false;
    return String(item.permission).split("+").some((part) => !PERMISSION_KEYS.includes(part.trim()));
  });
  assert.deepEqual(invalid, []);
  assert.equal(ROUTES.find((item) => item.id === "documents.restore").policy, "admin-only");
  assert.equal(ROUTES.find((item) => item.id === "admin.user.password-reset").policy, "admin-only");
  assert.equal(ROUTES.find((item) => item.id === "admin.user.password-reset.form").policy, "admin-only");
  for (const id of [
    "admin.role-templates",
    "admin.role-template.edit.form",
    "admin.role-template.edit",
    "admin.role-template.apply"
  ]) {
    const route = ROUTES.find((item) => item.id === id);
    assert.equal(route.permission, "can_manage_users");
    assert.equal(route.policy, "admin-only");
  }
  assert.equal(ROUTES.find((item) => item.id === "session.signup.blocked").policy, "always-404");
});
