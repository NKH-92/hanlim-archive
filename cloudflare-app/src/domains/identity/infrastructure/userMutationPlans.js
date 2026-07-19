import { createBatchPlan } from "../../../platform/d1/batchPlan.js";

export function createUserStatusMutationPlan(action, auditStatement, updateStatement, guard) {
  return createBatchPlan(`identity.user.${action}`)
    .step(`user.audit.${action}`, auditStatement, { guard, auditEventId: `user.${action}` })
    .step(`user.status.${action}`, updateStatement, { guard })
    .expectChanged(`user.status.${action}`)
    .withBudget(2);
}

export function createUserPermissionMutationPlan(auditStatement, updateStatement, guard) {
  return createBatchPlan("identity.user.permissions")
    .step("user.audit.permissions", auditStatement, { guard, auditEventId: "user.permissions_update" })
    .step("user.permissions.update", updateStatement, { guard })
    .expectChanged("user.permissions.update")
    .withBudget(2);
}
