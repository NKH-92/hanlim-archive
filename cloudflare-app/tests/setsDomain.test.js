import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as legacyFacade from "../src/data/setsData.js";
import * as sets from "../src/domains/sets/index.js";
import { createSetMutationPlan } from "../src/domains/sets/infrastructure/mutationPlans.js";

const statements = (count) => Array.from({ length: count }, (_, index) => ({ index }));

test("세트 lock policy와 Actor 표시명은 도메인에서 정규화한다", () => {
  assert.equal(sets.isSetLocked({ is_locked: 1 }), true);
  assert.equal(sets.isSetLocked({ isLocked: false }), false);
  assert.equal(sets.actorDisplayName({ displayName: " 문서 담당자 ", username: "keeper" }), "문서 담당자");
  assert.equal(sets.actorDisplayName({ username: "keeper" }), "keeper");
});

test("세트 mutation plan은 이력 선행과 잠금 guard를 고정한다", () => {
  const expectations = {
    create: ["set.insert", "set.log.create"],
    update: ["set.log.update", "set.update"],
    delete: ["set.log.delete", "set.items.delete", "set.delete"],
    add: ["set.log.add", "set.touch.add", "set.items.add"],
    remove: ["set.log.remove", "set.touch.remove", "set.item.remove"],
    lock: ["set.log.lock", "system.audit.set-lock", "set.lock.update"],
    unlock: ["set.log.unlock", "system.audit.set-unlock", "set.lock.update"]
  };
  for (const [action, names] of Object.entries(expectations)) {
    const plan = createSetMutationPlan(action, statements(names.length));
    assert.equal(plan.describe().id, `sets.${action}`);
    assert.equal(plan.describe().budget, names.length);
    assert.deepEqual(plan.describe().steps.map((step) => step.name), names);
    assert.equal(plan.describe().steps.at(-1).expectChanged, !["create"].includes(action));
    assert.ok(plan.describe().steps.every((step) => step.guard === "set-unlocked"));
  }
});

test("세트 presenter는 저장 행과 화면 모델 변환을 한 경계에 둔다", () => {
  assert.deepEqual(sets.setRowToReadModel({
    id: 4, name: "감사 세트", description: null, is_locked: 1,
    document_count: 12, disposed_count: 2, updated_at: "2026-07-19"
  }), {
    id: 4, name: "감사 세트", description: "", isLocked: true,
    documentCount: 12, disposedCount: 2, updatedAt: "2026-07-19"
  });
});

test("세트 공개 API와 기존 data adapter는 같은 구현을 위임한다", () => {
  for (const name of [
    "getDocumentSets", "getDocumentSet", "getDocumentSetDocuments", "upsertDocumentSet",
    "deleteDocumentSet", "addDocumentsToSet", "removeDocumentFromSet", "getDocumentSetLogs",
    "setDocumentSetLock"
  ]) {
    assert.equal(legacyFacade[name], sets[name], name);
  }
});

test("세트 HTTP 경계는 mutation에 Actor 객체를 전달한다", async () => {
  const source = await readFile(new URL("../src/handlers/setHandlers.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:upsertDocumentSet|deleteDocumentSet|addDocumentsToSet|removeDocumentFromSet)\([^\n]*session\.displayName/);
});
