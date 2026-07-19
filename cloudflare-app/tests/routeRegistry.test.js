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
  assert.equal(resolvePublicRoute("/images/floor/zone1.svg", "GET").descriptor.id, "assets.images");
  assert.equal(urlFor("documents.edit", { id: 42 }, { returnTo: "/sets/1" }), "/documents/42/edit?returnTo=%2Fsets%2F1");
});

test("registry는 404와 method mismatch 405를 구분하되 compatibility router는 기존 404를 유지할 수 있다", () => {
  assert.equal(routeStatus("/documents/7", "GET"), 200);
  assert.equal(routeStatus("/documents/7", "PATCH"), 405);
  assert.equal(routeStatus("/not-supported", "GET"), 404);
});

test("모든 인증 POST descriptor는 Origin·CSRF를 요구하고 permission key는 catalog에 존재한다", () => {
  const posts = AUTHENTICATED_ROUTES.filter((item) => item.method === "POST");
  assert.equal(posts.every((item) => item.security.origin && item.security.csrf && item.security.forcedPassword), true);
  assert.deepEqual(ROUTES.filter((item) => item.permission && !PERMISSION_KEYS.includes(item.permission)), []);
  assert.equal(ROUTES.find((item) => item.id === "documents.restore").policy, "admin-only");
  assert.equal(ROUTES.find((item) => item.id === "session.signup.blocked").policy, "always-404");
});
