import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { createBatchPlan } from "../../../platform/d1/batchPlan.js";

export function createDocumentCreatePlan(statements, tagCount) {
  const plan = createBatchPlan("documents.create").withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest);
  plan.step("document.insert-temporary", statements[0], { guard: "unique:document-number+revision" });
  for (let index = 0; index < tagCount; index += 1) {
    plan.step(`document.tag.attach.${index + 1}`, statements[index + 1], { guard: "temporary-storage-code" });
  }
  plan.step("document.audit.create", statements[tagCount + 1], {
    guard: "temporary-storage-code", auditEventId: "document.create"
  });
  return plan.step("document.storage-code.finalize", statements[tagCount + 2], {
    guard: "temporary-storage-code"
  }).expectChanged("document.storage-code.finalize");
}

export function createDocumentUpdatePlan(statements, tagCount, guard) {
  const plan = createBatchPlan("documents.update").withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest)
    .step("document.audit.update", statements[0], { guard, auditEventId: "document.update" })
    .step("document.tags.detach", statements[1], { guard });
  for (let index = 0; index < tagCount; index += 1) {
    plan.step(`document.tag.attach.${index + 1}`, statements[index + 2], { guard });
  }
  return plan.step("document.update", statements[tagCount + 2], { guard }).expectChanged("document.update");
}

export function createDocumentMovePlan(statements, guard) {
  const names = ["document.audit.move", "document.movement.insert", "system.audit.move", "document.location.update"];
  const plan = createBatchPlan("documents.move").withBudget(4);
  statements.forEach((statement, index) => plan.step(names[index], statement, {
    guard,
    auditEventId: index === 0 ? "document.move" : index === 2 ? "system.document.move" : null
  }));
  return plan.expectChanged("document.location.update");
}

export function createDocumentStatusPlan(action, statements, guard) {
  const plan = createBatchPlan(`documents.${action}`).withBudget(4)
    .step(`document.disposal-log.${action}`, statements[0], { guard })
    .step(`document.audit.${action}`, statements[1], { guard, auditEventId: `document.${action}` });
  if (statements.length === 4) {
    plan.step(`system.audit.${action}`, statements[2], { guard, auditEventId: `system.document.${action}` });
  }
  return plan.step(`document.status.${action}`, statements.at(-1), { guard })
    .expectChanged(`document.status.${action}`);
}

export function createDocumentBulkDisposePlan(statements, documentCount) {
  const plan = createBatchPlan("documents.bulk-dispose")
    .withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest - 2);
  for (let index = 0; index < documentCount; index += 1) {
    const offset = index * 3;
    const guard = `active-document:${index + 1}`;
    plan.step(`document.${index + 1}.disposal-log`, statements[offset], { guard });
    plan.step(`document.${index + 1}.audit.dispose`, statements[offset + 1], {
      guard, auditEventId: `document.${index + 1}.dispose`
    });
    plan.step(`document.${index + 1}.status.dispose`, statements[offset + 2], { guard });
  }
  return plan;
}

export function createDocumentPermanentDeletePlan(statements, guard) {
  return createBatchPlan("documents.permanent-delete")
    .step("document.audit.snapshot", statements[0], { guard, auditEventId: "document.delete_permanent" })
    .step("system.audit.snapshot", statements[1], { guard, auditEventId: "system.document.delete_permanent" })
    .step("document.delete", statements[2], { guard })
    .expectChanged("document.delete")
    .withBudget(3);
}

export function executableStatements(plan) {
  return plan.execution().statements;
}
