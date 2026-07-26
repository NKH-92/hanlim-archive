import assert from "node:assert/strict";
import test from "node:test";

import {
  addDocumentsToSet,
  deleteDocumentSet,
  removeDocumentFromSet,
  upsertDocumentSet
} from "../src/domains/sets/index.js";
import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";
import { recordingEnv } from "./helpers/recordingD1.js";

test("세트 생성·수정은 create/update 이력과 OCC guard를 같은 batch에 둔다", async () => {
  const createEnv = recordingEnv({
    batch: (statements) => statements.map((_, index) => index === 0
      ? { meta: { changes: 1 }, results: [{ id: 9 }] }
      : { meta: { changes: 1 } })
  });
  const created = await upsertDocumentSet(createEnv, { name: "정기감사 준비문서" }, "관리자");
  assert.equal(created.ok, true);
  assert.equal(createEnv.state.batches.length, 1);
  assert.equal(createEnv.state.batches[0].length, 2);
  assert.match(createEnv.state.batches[0][0].sql, /INSERT INTO document_sets/);
  assert.match(createEnv.state.batches[0][1].sql, /INSERT INTO document_set_logs/);
  assert.match(createEnv.state.batches[0][1].sql, /'create'/);

  const updateEnv = recordingEnv();
  const updated = await upsertDocumentSet(updateEnv, {
    id: 9,
    name: "정기감사 준비문서",
    expectedRowVersion: 1
  }, "관리자");
  assert.equal(updated.ok, true);
  assert.equal(updateEnv.state.batches.length, 1);
  assert.equal(updateEnv.state.batches[0].length, 3);
  assert.match(updateEnv.state.batches[0][0].sql, /INSERT INTO document_set_logs/);
  assert.match(updateEnv.state.batches[0][0].sql, /'update'/);
  assert.match(updateEnv.state.batches[0][1].sql, /UPDATE document_sets/);
  assert.match(updateEnv.state.batches[0][2].sql, /STALE_VERSION/);
});

test("세트 문서 추가는 실제 추가 문서번호를 기록하고 stale guard를 유지한다", async () => {
  const env = recordingEnv({
    batch: (statements) => statements.map(() => ({ meta: { changes: 1 } })),
    first: (sql) => sql.includes("addable_count")
      ? { id: 3, is_locked: 0, row_version: 1, addable_count: 1 }
      : null
  });
  const { added } = await addDocumentsToSet(env, 3, [10, 11], "관리자", 1);
  assert.equal(added, 1);
  assert.equal(env.state.batches.length, 1);
  assert.equal(env.state.batches[0].length, 5);
  const log = env.state.batches[0][0];
  assert.match(log.sql, /INSERT INTO document_set_logs/);
  assert.match(log.sql, /'add'/);
  assert.match(log.sql, /GROUP_CONCAT\(eligible\.document_number/);
  assert.deepEqual(JSON.parse(log.args[0]), [10, 11]);
  assert.ok(log.args.length <= FREE_TIER_BUDGET.maxD1BoundParametersPerStatement);
  assert.match(env.state.batches[0][2].sql, /STALE_VERSION/);
  assert.match(env.state.batches[0][4].sql, /STALE_VERSION/);
});

test("세트 문서 200건 추가는 json_each 한 statement로 bind 예산을 지킨다", async () => {
  const env = recordingEnv({
    batch: (statements) => statements.map((_, index) => ({
      meta: { changes: index === 3 ? 200 : 1 },
      results: []
    })),
    first: (sql) => sql.includes("addable_count")
      ? { id: 3, is_locked: 0, row_version: 1, addable_count: 200 }
      : null
  });
  const ids = Array.from({ length: 200 }, (_, index) => index + 1);
  const result = await addDocumentsToSet(env, 3, ids, "관리자", 1);
  assert.equal(result.added, 200);
  assert.equal(env.state.batches[0].length, 5);
  assert.match(env.state.batches[0][3].sql, /FROM json_each\(\?\)/);
  assert.match(env.state.batches[0][3].sql, /INSERT OR IGNORE INTO document_set_items/);
  assert.deepEqual(JSON.parse(env.state.batches[0][3].args[0]), ids);
  for (const statement of env.state.batches[0]) {
    assert.ok(statement.args.length <= FREE_TIER_BUDGET.maxD1BoundParametersPerStatement);
  }
  assert.match(env.state.batches[0][4].sql, /STALE_VERSION/);
});

test("세트 문서 제외와 세트 삭제는 remove/delete 이력을 상태 변경 전에 기록한다", async () => {
  const removeEnv = recordingEnv({
    first: (sql) => sql.includes("FROM document_set_items")
      ? { set_name: "감사세트", row_version: 1, document_number: "PV-2026-014" }
      : null
  });
  const removed = await removeDocumentFromSet(removeEnv, 3, 10, "관리자", 1);
  assert.equal(removed.ok, true);
  assert.equal(removeEnv.state.batches.length, 1);
  assert.equal(removeEnv.state.batches[0].length, 5);
  const removeLog = removeEnv.state.batches[0][0];
  assert.match(removeLog.sql, /INSERT INTO document_set_logs/);
  assert.match(removeLog.sql, /'remove'/);
  assert.ok(removeLog.args.some((value) => String(value).includes("PV-2026-014")));
  assert.match(removeEnv.state.batches[0][2].sql, /STALE_VERSION/);
  assert.match(removeEnv.state.batches[0][4].sql, /STALE_VERSION/);

  const deleteEnv = recordingEnv({
    first: (sql) => sql.includes("FROM document_sets")
      ? { id: 3, name: "감사세트", row_version: 1 }
      : null
  });
  const deleted = await deleteDocumentSet(deleteEnv, 3, "관리자", 1);
  assert.equal(deleted.ok, true);
  assert.equal(deleteEnv.state.batches.length, 1);
  const deleteSqls = deleteEnv.state.batches[0].map((statement) => statement.sql);
  assert.ok(deleteSqls.some((sql) => sql.includes("INSERT INTO document_set_logs") && sql.includes("'delete'")));
  assert.ok(deleteSqls.some((sql) => sql.includes("DELETE FROM document_sets")));
});
