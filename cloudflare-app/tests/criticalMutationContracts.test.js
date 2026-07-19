import assert from "node:assert/strict";
import test from "node:test";

import { createDocument, moveDocument, processDisposalBatch } from "../src/db.js";
import { actorFixture } from "./helpers/fixtures.js";

const actor = actorFixture();

test("moveDocument는 4개 핵심 기록을 동일 guard와 고정 순서로 한 batch에 쓴다", async () => {
  const expectedUpdatedAt = "2026-07-17 09:10:11";
  const document = {
    id: 5,
    storage_code: "ARC-000005",
    document_number: "DOC-MOVE-5",
    rack_slot_id: 11,
    rack_face: "A",
    status: "active",
    updated_at: expectedUpdatedAt,
    row_version: 7,
    rack_code: "R-01",
    zone_number: 1,
    rack_number: 1,
    is_single_sided: 0,
    column_number: 2,
    shelf_number: 3
  };
  const target = {
    id: 22,
    rack_id: 2,
    rack_code: "R-02",
    zone_number: 1,
    rack_number: 2,
    is_single_sided: 0,
    column_count: 6,
    shelf_count: 7,
    column_number: 4,
    shelf_number: 5,
    slot_code: "R-02-C04-S05"
  };
  const env = recordingEnv({
    first(sql) {
      if (/WHERE d\.id = \?/.test(sql)) return document;
      if (/WHERE rs\.id = \? AND rs\.is_active = 1/.test(sql)) return target;
      return null;
    }
  });

  const result = await moveDocument(env, 5, {
    rackSlotId: 22,
    rackFace: "B",
    reason: "  보관 위치 재정렬  ",
    expectedUpdatedAt,
    expectedRowVersion: 7
  }, actor);

  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 4);
  assert.match(statements[0].sql, /INSERT INTO document_audit_logs/);
  assert.match(statements[1].sql, /INSERT INTO document_movements/);
  assert.match(statements[2].sql, /INSERT INTO system_audit_logs/);
  assert.match(statements[3].sql, /UPDATE documents\s+SET rack_slot_id = \?, rack_face = \?/);

  const expectedGuardBinds = [
    5,
    expectedUpdatedAt,
    7,
    11,
    "A",
    22,
    "B",
    "R-02",
    1,
    2,
    4,
    5,
    0,
    "R-01",
    1,
    1,
    2,
    3,
    0
  ];
  for (const statement of statements) {
    assert.match(statement.sql, /status = 'active'/);
    assert.match(statement.sql, /updated_at = \?/);
    assert.match(statement.sql, /row_version = \?/);
    assert.match(statement.sql, /target_rs\.is_active = 1/);
    assert.match(statement.sql, /source_rs\.id = documents\.rack_slot_id/);
    assert.deepEqual(statement.args.slice(-expectedGuardBinds.length), expectedGuardBinds);
  }

  assert.deepEqual(statements[0].args.slice(0, 7), [
    5,
    "ARC-000005",
    "DOC-MOVE-5",
    "문서고 관리자",
    "Admin",
    17,
    "archive.admin"
  ]);
  assert.equal(JSON.parse(statements[0].args[7]).reason, "보관 위치 재정렬");
  assert.deepEqual(statements[1].args.slice(0, 6), [5, "DOC-MOVE-5", 11, "A", 22, "B"]);
  assert.deepEqual(statements[1].args.slice(8, 12), ["보관 위치 재정렬", 17, "archive.admin", "문서고 관리자"]);
  assert.deepEqual(statements[2].args.slice(0, 7), [
    "document",
    "5",
    "DOC-MOVE-5",
    "move",
    17,
    "archive.admin",
    "문서고 관리자"
  ]);
  assert.equal(JSON.parse(statements[2].args[9]).reason, "보관 위치 재정렬");
  assert.deepEqual(statements[3].args.slice(0, 2), [22, "B"]);
});

test("createDocument는 문서·태그·감사·보관코드 확정을 고정 순서로 원자 처리한다", async () => {
  const env = recordingEnv({
    batch(statements) {
      return statements.map((_, index) => index === 0
        ? { meta: { changes: 1 }, results: [{ id: 42 }] }
        : { meta: { changes: 1 } });
    }
  });
  const values = {
    categoryId: 4,
    documentNumber: "DOC-CRIT-42",
    revisionNumber: "Rev.2",
    revisionDate: "2026-07-01",
    disposalDueYear: "2032",
    documentName: "핵심 변경 계약",
    note: "원본 유지",
    rackSlotId: 27,
    rackFace: "B",
    tagIds: [8, 3, 8]
  };

  const id = await createDocument(env, values, actor, actor.role);

  assert.equal(id, 42);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 5);
  assert.match(statements[0].sql, /INSERT INTO documents/);
  assert.match(statements[0].sql, /SELECT \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, 'active', CURRENT_TIMESTAMP/);
  assert.match(statements[0].sql, /WHERE NOT EXISTS/);
  assert.match(statements[0].sql, /UPPER\(document_number\) = UPPER\(\?\)/);
  assert.match(statements[0].sql, /RETURNING id/);

  const temporaryStorageCode = statements[0].args[0];
  assert.match(temporaryStorageCode, /^TEMP-[0-9a-f-]{36}$/);
  assert.deepEqual(statements[0].args, [
    temporaryStorageCode,
    4,
    "DOC-CRIT-42",
    "Rev.2",
    "2026-07-01",
    2032,
    "핵심 변경 계약",
    "원본 유지",
    27,
    "B",
    "DOC-CRIT-42",
    "Rev.2"
  ]);

  assert.match(statements[1].sql, /INSERT OR IGNORE INTO document_tags/);
  assert.match(statements[2].sql, /INSERT OR IGNORE INTO document_tags/);
  assert.deepEqual(statements[1].args, [8, temporaryStorageCode]);
  assert.deepEqual(statements[2].args, [3, temporaryStorageCode]);
  assert.match(statements[3].sql, /INSERT INTO document_audit_logs/);
  assert.match(statements[3].sql, /'create'/);
  assert.match(statements[3].sql, /WHERE d\.storage_code = \?/);
  assert.deepEqual(statements[3].args, [
    "문서고 관리자",
    "Admin",
    17,
    "archive.admin",
    temporaryStorageCode
  ]);
  assert.match(statements[4].sql, /SET storage_code = 'ARC-' \|\| printf\('%06d', id\)/);
  assert.deepEqual(statements[4].args, [temporaryStorageCode]);
});

test("폐기 캠페인 process는 선점부터 집계까지 로그 선행 guard 순서를 유지한다", async () => {
  const batch = disposalBatchFixture();
  const env = recordingEnv({
    first(sql) {
      return /FROM disposal_batches b/.test(sql) ? batch : null;
    },
    batch(statements) {
      return statements.map((_, index) => index === statements.length - 1
        ? { meta: { changes: 1 }, results: [{ ...batch, completed_count: 25, pending_count: 5 }] }
        : { meta: { changes: 1 } });
    }
  });

  const result = await processDisposalBatch(env, 11, actor);

  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 8);
  const order = [
    /UPDATE disposal_batch_items\s+SET processing_token = \?/,
    /INSERT OR IGNORE INTO disposal_logs/,
    /INSERT OR IGNORE INTO document_audit_logs/,
    /UPDATE documents AS d\s+SET status = 'disposed'/,
    /SET status = 'completed'/,
    /THEN 'changed'/,
    /INSERT INTO system_audit_logs/,
    /UPDATE disposal_batches\s+SET\s+completed_count/
  ];
  order.forEach((pattern, index) => assert.match(statements[index].sql, pattern));

  const token = statements[0].args[0];
  assert.match(token, /^[0-9a-f-]{36}$/);
  assert.deepEqual(statements[0].args, [token, 11, 25]);
  assert.deepEqual(statements[1].args, ["문서고 관리자", 11, token]);
  assert.deepEqual(statements[2].args, ["문서고 관리자", "Admin", 17, "archive.admin", 11, token]);
  assert.deepEqual(statements[3].args, [11, token]);
  assert.deepEqual(statements[4].args, [11, token]);
  assert.deepEqual(statements[5].args, [11, token]);

  assert.match(statements[1].sql, /d\.status = 'active'/);
  assert.match(statements[1].sql, /d\.updated_at = i\.expected_updated_at/);
  assert.match(statements[1].sql, /d\.row_version = i\.expected_document_version/);
  assert.match(statements[2].sql, /JOIN disposal_logs dl/);
  assert.match(statements[3].sql, /JOIN disposal_logs dl/);
  assert.match(statements[3].sql, /JOIN document_audit_logs al/);
  assert.match(statements[3].sql, /d\.updated_at = i\.expected_updated_at/);
  assert.match(statements[3].sql, /d\.row_version = i\.expected_document_version/);
  assert.match(statements[4].sql, /EXISTS \(\s*SELECT 1 FROM disposal_logs dl/);
  assert.match(statements[4].sql, /EXISTS \(\s*SELECT 1 FROM document_audit_logs al/);
  assert.match(statements[4].sql, /d\.status = 'disposed'/);
  assert.match(statements[6].sql, /NOT EXISTS \(SELECT 1 FROM disposal_batch_items i WHERE i\.batch_id = b\.id AND i\.status = 'pending'\)/);
  assert.match(statements[7].sql, /RETURNING \*, MAX\(0, target_count - completed_count - excluded_count - changed_count - failed_count\) AS pending_count/);
});

function disposalBatchFixture() {
  return {
    id: 11,
    batch_code: "DSP-2026-0011",
    title: "정기 폐기",
    criteria_json: JSON.stringify({ disposalDueYear: 2031 }),
    criteria: { disposalDueYear: 2031, yearMode: "exact", categoryId: 0, zoneNumber: 0, rackId: 0 },
    disposal_reason: "보존기간 만료",
    approval_reference: "APR-1",
    status: "processing",
    target_count: 30,
    completed_count: 0,
    excluded_count: 0,
    changed_count: 0,
    failed_count: 0,
    pending_count: 30,
    created_by_name: "문서고 관리자",
    created_at: "2026-07-17",
    updated_at: "2026-07-17"
  };
}

function recordingEnv(behavior = {}) {
  const state = { calls: [], batches: [] };
  return {
    state,
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          args: [],
          bind(...args) {
            this.args = args;
            return this;
          },
          async first() {
            state.calls.push({ type: "first", sql, args: this.args });
            return behavior.first?.(sql, this.args) ?? null;
          },
          async all() {
            state.calls.push({ type: "all", sql, args: this.args });
            return { results: behavior.all?.(sql, this.args) ?? [] };
          },
          async run() {
            state.calls.push({ type: "run", sql, args: this.args });
            return { meta: { changes: 1 } };
          }
        };
        state.calls.push({ type: "prepare", sql });
        return statement;
      },
      async batch(statements) {
        state.batches.push(statements);
        return behavior.batch?.(statements) ?? statements.map(() => ({ meta: { changes: 1 } }));
      }
    }
  };
}
