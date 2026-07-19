import { createBatchPlan } from "../../../platform/d1/batchPlan.js";

export function createSetMutationPlan(action, statements, guard = "set-unlocked") {
  const catalogs = {
    create: [["set.insert", false], ["set.log.create", false]],
    update: [["set.log.update", false], ["set.update", true]],
    delete: [["set.log.delete", false], ["set.items.delete", false], ["set.delete", true]],
    add: [["set.log.add", false], ["set.touch.add", false], ["set.items.add", true]],
    remove: [["set.log.remove", false], ["set.touch.remove", false], ["set.item.remove", true]],
    lock: [["set.log.lock", false], ["system.audit.set-lock", false], ["set.lock.update", true]],
    unlock: [["set.log.unlock", false], ["system.audit.set-unlock", false], ["set.lock.update", true]]
  };
  const catalog = catalogs[action];
  if (!catalog || catalog.length !== statements.length) throw new TypeError(`sets.${action}: statement 계약 불일치`);
  const plan = createBatchPlan(`sets.${action}`).withBudget(catalog.length);
  catalog.forEach(([name, expected], index) => {
    plan.step(name, statements[index], {
      guard,
      auditEventId: name.includes("log") || name.includes("audit") ? name : null
    });
    if (expected) plan.expectChanged(name);
  });
  return plan;
}

export function executableStatements(plan) {
  return plan.execution().statements;
}
