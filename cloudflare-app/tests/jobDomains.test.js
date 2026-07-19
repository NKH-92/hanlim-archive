import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as dbFacade from "../src/db.js";
import * as disposal from "../src/domains/disposal/index.js";
import { createDisposalPlan } from "../src/domains/disposal/infrastructure/plans.js";
import * as imports from "../src/domains/imports/index.js";
import { createImportPlan } from "../src/domains/imports/infrastructure/plans.js";

test("폐기 캠페인과 항목 상태 machine은 terminal 상태 재처리를 막는다", () => {
  assert.equal(disposal.canTransitionDisposalBatch("draft", "frozen"), true);
  assert.equal(disposal.canTransitionDisposalBatch("processing", "completed"), true);
  assert.equal(disposal.canTransitionDisposalBatch("completed", "processing"), false);
  assert.equal(disposal.canTransitionDisposalItem("pending", "changed"), true);
  assert.equal(disposal.canTransitionDisposalItem("completed", "pending"), false);
});

test("가져오기 job과 item 상태 machine은 재개와 terminal 의미를 구분한다", () => {
  assert.equal(imports.canTransitionImportJob("ready", "processing"), true);
  assert.equal(imports.canTransitionImportJob("processing", "processing"), true);
  assert.equal(imports.canTransitionImportJob("completed", "processing"), false);
  assert.equal(imports.canTransitionImportItem("pending", "failed"), true);
  assert.equal(imports.canTransitionImportItem("failed", "pending"), false);
});

test("staged import payload는 Worker 재개에 필요한 최소 shape를 고정한다", () => {
  assert.deepEqual(imports.normalizeStagedImportPayload({
    documentNumber: " DOC-1 ", revisionNumber: " A ", documentName: " 기록 ",
    categoryId: "2", rackSlotId: "8", rackFace: "B", tagIds: [3, "4", 0]
  }), {
    documentNumber: "DOC-1", revisionNumber: "A", documentName: "기록",
    categoryId: 2, rackSlotId: 8, rackFace: "B", tagIds: [3, 4]
  });
});

test("disposal과 import는 서로 독립된 plan id와 statement budget을 갖는다", () => {
  const disposalPlan = createDisposalPlan("process", [{}, {}, {}], "processing+claim-token").describe();
  const importPlan = createImportPlan("process", [{}, {}], "claim-token+pending-item").describe();
  assert.equal(disposalPlan.id, "disposal.process");
  assert.equal(importPlan.id, "imports.process");
  assert.equal(disposalPlan.budget, 40);
  assert.equal(importPlan.budget, 40);
  assert.deepEqual(disposalPlan.steps.map((step) => step.name), ["process.1", "process.2", "process.3"]);
  assert.ok(disposalPlan.steps.every((step) => step.guard === "processing+claim-token"));
});

test("장기 작업 공개 API는 기존 db facade surface를 유지한다", () => {
  for (const name of [
    "normalizeDisposalCriteria", "createDisposalBatch", "freezeDisposalBatch", "startDisposalBatch",
    "processDisposalBatch", "cancelDisposalBatch", "getDisposalBatchExportRows"
  ]) assert.equal(dbFacade[name], disposal[name], name);
  for (const name of [
    "createDocumentImportJob", "processDocumentImportJob", "failDocumentImportItem",
    "cancelDocumentImportJob", "getDocumentImportFailureRows"
  ]) assert.equal(dbFacade[name], imports[name], name);
});

test("두 장기 작업 도메인은 범용 job framework나 상호 의존을 만들지 않는다", async () => {
  const disposalSource = await readFile(new URL("../src/domains/disposal/infrastructure/repository.js", import.meta.url), "utf8");
  const importSource = await readFile(new URL("../src/domains/imports/infrastructure/repository.js", import.meta.url), "utf8");
  assert.doesNotMatch(disposalSource, /domains\/imports|jobFramework|durable object/i);
  assert.doesNotMatch(importSource, /domains\/disposal|jobFramework|durable object/i);
});
