import { createBatchPlan } from "../../../platform/d1/batchPlan.js";

export function createRackResizePlan(statements, guard) {
  const names = ["rack.audit.update", "rack.update", "rack.slots.deactivate-outside", "rack.slots.upsert-grid"];
  const plan = createBatchPlan("racks.resize").withBudget(4);
  statements.forEach((statement, index) => plan.step(names[index], statement, { guard, auditEventId: index === 0 ? "rack.update" : null }));
  return plan.expectChanged("rack.update");
}

export function createRackCreatePlan(statements, guard) {
  const names = ["rack.insert", "rack.audit.create", "rack.slots.insert-grid"];
  const plan = createBatchPlan("racks.create").withBudget(3);
  statements.forEach((statement, index) => plan.step(names[index], statement, { guard, auditEventId: index === 1 ? "rack.create" : null }));
  return plan.expectChanged("rack.insert");
}

export function createRackConfigurationPlan(statements) {
  const names = ["rack-config.audit", "rack-config.ensure-racks", "rack-config.activate-range", "rack-config.ensure-slots"];
  const plan = createBatchPlan("racks.configure").withBudget(4);
  statements.forEach((statement, index) => plan.step(names[index], statement, { guard: "zones:1-3", auditEventId: index === 0 ? "rack_configuration.update" : null }));
  return plan;
}
