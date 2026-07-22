import assert from "node:assert/strict";
import test from "node:test";

import { sessionToActor } from "../src/auth.js";
import {
  PASSWORD_POLICY,
  auditActorSnapshot,
  canTransitionUser,
  capabilitiesFromSession,
  transitionFor,
  validateNewPassword
} from "../src/domains/identity/index.js";
import { createUserPermissionMutationPlan, createUserStatusMutationPlan } from "../src/domains/identity/infrastructure/userMutationPlans.js";
import * as sessionHandlers from "../src/handlers/sessionHandlers.js";

test("session은 감사용 Actor 계약으로 한 번만 정규화된다", () => {
  const session = { userId: 7, username: "operator", displayName: "운영자", role: "User", can_manage_sets: 1 };
  const actor = sessionToActor(session);
  assert.equal(actor.userId, 7);
  assert.equal(actor.permissions.can_manage_sets, true);
  assert.deepEqual(auditActorSnapshot(session), actor);
  assert.equal(Object.isFrozen(actor.permissions), true);
});

test("비밀번호 policy와 사용자 상태 machine은 기존 규칙을 단일 catalog로 제공한다", () => {
  assert.equal(PASSWORD_POLICY.minLength, 8);
  assert.deepEqual(validateNewPassword("short"), { ok: false, message: "새 비밀번호는 8자 이상이어야 합니다." });
  assert.equal(canTransitionUser({ role: "User", status: "pending" }, "approve"), true);
  assert.equal(canTransitionUser({ role: "User", status: "approved" }, "reject"), false);
  assert.equal(canTransitionUser({ role: "User", status: "rejected", security_review_required: 1 }, "approve"), false);
  assert.deepEqual(transitionFor("enable"), { from: ["disabled"], to: "approved" });
});

test("capability model은 direct URL 권한과 기존 Admin-only 설정 메뉴 정책을 구분한다", () => {
  const user = capabilitiesFromSession({ role: "User", can_manage_masters: 1, can_manage_documents: 1 });
  assert.equal(user.canManageMasters, true);
  assert.equal(user.canManageDocuments, true);
  assert.equal(user.canShowAdminSettings, false);
  const admin = capabilitiesFromSession({ role: "Admin" });
  assert.equal(admin.canShowAdminSettings, true);
  assert.equal(admin.canOpenManagement, true);
});

test("사용자 상태·권한 mutation plan은 감사가 변경보다 앞서고 2문장 예산을 지킨다", () => {
  const audit = { name: "audit" };
  const update = { name: "update" };
  const status = createUserStatusMutationPlan("disable", audit, update, "user:3:approved");
  assert.deepEqual(status.execution().statements, [audit, update]);
  assert.deepEqual(status.describe().steps.map((step) => step.name), ["user.audit.disable", "user.status.disable"]);
  const permissions = createUserPermissionMutationPlan(audit, update, "user:3:v1");
  assert.deepEqual(permissions.describe().steps.map((step) => step.name), ["user.audit.permissions", "user.permissions.update"]);
  assert.equal(permissions.describe().budget, 2);
});

test("비활성 signup handler surface는 제거되고 공개 route는 registry의 always-404 policy만 남는다", () => {
  assert.equal("renderSignup" in sessionHandlers, false);
  assert.equal("handleSignup" in sessionHandlers, false);
});
