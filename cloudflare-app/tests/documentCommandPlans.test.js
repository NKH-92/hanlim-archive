import assert from "node:assert/strict";
import test from "node:test";

import * as legacyMutations from "../src/data/documentMutations.js";
import { moveDocument as legacyMoveDocument } from "../src/data/movementData.js";
import * as documents from "../src/domains/documents/index.js";
import {
  createDocumentBulkDisposePlan,
  createDocumentCreatePlan,
  createDocumentMovePlan,
  createDocumentPermanentDeletePlan,
  createDocumentStatusPlan,
  createDocumentUpdatePlan
} from "../src/domains/documents/infrastructure/mutationPlans.js";

const statements = (count) => Array.from({ length: count }, (_, index) => Object.freeze({ index }));

test("문서 생성 plan은 temporary code에서 감사와 확정까지 순서를 고정한다", () => {
  const plan = createDocumentCreatePlan(statements(5), 2);
  assert.deepEqual(plan.describe(), {
    id: "documents.create", budget: 40, statements: 5,
    steps: [
      step("document.insert-temporary", "unique:document-number+revision"),
      step("document.tag.attach.1", "temporary-storage-code"),
      step("document.tag.attach.2", "temporary-storage-code"),
      step("document.audit.create", "temporary-storage-code", "document.create"),
      step("document.storage-code.finalize", "temporary-storage-code", null, true)
    ]
  });
});

test("문서 수정 plan은 pre-state 감사, 태그 교체, optimistic update 순서를 고정한다", () => {
  const plan = createDocumentUpdatePlan(statements(5), 2, "row-version-guard");
  assert.deepEqual(plan.describe().steps, [
    step("document.audit.update", "row-version-guard", "document.update"),
    step("document.tags.detach", "row-version-guard"),
    step("document.tag.attach.1", "row-version-guard"),
    step("document.tag.attach.2", "row-version-guard"),
    step("document.update", "row-version-guard", null, true)
  ]);
});

test("이동·상태 전이·영구삭제 plan은 감사 선행과 최종 변경 guard를 표현한다", () => {
  const move = createDocumentMovePlan(statements(4), "move-guard").describe();
  assert.equal(move.id, "documents.move");
  assert.equal(move.budget, 4);
  assert.deepEqual(move.steps.map(({ name, expectChanged }) => [name, expectChanged]), [
    ["document.audit.move", false], ["document.movement.insert", false],
    ["system.audit.move", false], ["document.location.update", true]
  ]);

  const dispose = createDocumentStatusPlan("dispose", statements(3), "active-version").describe();
  assert.deepEqual(dispose.steps.map((item) => item.name), [
    "document.disposal-log.dispose", "document.audit.dispose", "document.status.dispose"
  ]);

  const restore = createDocumentStatusPlan("restore", statements(4), "disposed-version").describe();
  assert.deepEqual(restore.steps.map((item) => item.name), [
    "document.disposal-log.restore", "document.audit.restore", "system.audit.restore", "document.status.restore"
  ]);

  const deletion = createDocumentPermanentDeletePlan(statements(3), "disposed-version").describe();
  assert.deepEqual(deletion.steps.map((item) => item.name), [
    "document.audit.snapshot", "system.audit.snapshot", "document.delete"
  ]);
  assert.equal(deletion.steps[2].expectChanged, true);
});

test("대량 폐기 plan은 조회 2문장을 제외한 38문장 예산을 강제한다", () => {
  const plan = createDocumentBulkDisposePlan(statements(30), 10);
  assert.equal(plan.describe().budget, 38);
  assert.equal(plan.describe().statements, 30);
  assert.doesNotThrow(() => plan.execution());
});

test("도메인 command service와 infrastructure adapter는 동일 구현에 위임한다", () => {
  for (const name of [
    "createDocument", "updateDocument", "disposeDocument", "disposeDocumentsBulk",
    "restoreDocument", "permanentlyDeleteDocument"
  ]) {
    assert.equal(documents[name], legacyMutations[name], name);
  }
  assert.equal(documents.moveDocument, legacyMoveDocument);
});

function step(name, guard, auditEventId = null, expectChanged = false) {
  return { name, guard, auditEventId, expectChanged };
}
