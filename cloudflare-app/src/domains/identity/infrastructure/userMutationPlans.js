import { createBatchPlan } from "../../../platform/d1/batchPlan.js";

export function createUserStatusMutationPlan(action, auditStatement, updateStatement, guard) {
  return createBatchPlan(`identity.user.${action}`)
    .step(`user.audit.${action}`, auditStatement, { guard, auditEventId: `user.${action}` })
    .step(`user.status.${action}`, updateStatement, { guard })
    .expectChanged(`user.status.${action}`)
    .withBudget(2);
}

export function createApprovedUserMutationPlan(auditStatement, insertStatement, guard) {
  return createBatchPlan("identity.user.create_approved")
    .step("user.audit.create_approved", auditStatement, { guard, auditEventId: "user.create_approved" })
    .step("user.create.approved", insertStatement, { guard })
    .expectChanged("user.create.approved")
    .withBudget(2);
}

export function createUserPermissionMutationPlan(auditStatement, updateStatement, guard) {
  return createBatchPlan("identity.user.permissions")
    .step("user.audit.permissions", auditStatement, { guard, auditEventId: "user.permissions_update" })
    .step("user.permissions.update", updateStatement, { guard })
    .expectChanged("user.permissions.update")
    .withBudget(2);
}

export function createUserPasswordResetMutationPlan(auditStatement, clearThrottleStatement, updateStatement, guard) {
  return createBatchPlan("identity.user.password_reset")
    .step("user.audit.password_reset", auditStatement, { guard, auditEventId: "user.password_reset" })
    .step("user.login_throttle.clear", clearThrottleStatement, { guard })
    .step("user.password.reset", updateStatement, { guard })
    .expectChanged("user.password.reset")
    .withBudget(3);
}

// 계정 행은 사라지지만 감사 이력은 actor_user_id FK 없이 보존되므로 삭제 사건을 먼저 기록한다.
export function createUserDeleteMutationPlan(auditStatement, clearThrottleStatement, deleteStatement, guard) {
  return createBatchPlan("identity.user.delete")
    .step("user.audit.delete", auditStatement, { guard, auditEventId: "user.delete" })
    .step("user.login_throttle.clear", clearThrottleStatement, { guard })
    .step("user.delete", deleteStatement, { guard })
    .expectChanged("user.delete")
    .withBudget(3);
}
