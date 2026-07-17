import assert from "node:assert/strict";
import test from "node:test";

import {
  freezeDisposalBatch,
  normalizeDisposalCriteria,
  processDisposalBatch,
  validateDisposalBatchDraft
} from "../src/data/disposalBatchData.js";
import {
  createDocumentImportJob,
  processDocumentImportJob
} from "../src/data/importJobData.js";
import { disposalBatchDetailPage } from "../src/views/disposalBatchViews.js";
import { documentImportJobDetailPage } from "../src/views/importJobViews.js";

const actor = { userId: 7, username: "disposal", displayName: "폐기 담당자", role: "Admin" };

test("폐기 조건은 안전한 값만 정규화하고 최소 한 조건을 요구한다", () => {
  assert.deepEqual(normalizeDisposalCriteria({ disposalDueYear: "2031", yearMode: "lte", zoneNumber: "9", rackId: "3" }), {
    disposalDueYear: 2031, yearMode: "lte", categoryId: 0, zoneNumber: 0, rackId: 3
  });
  assert.equal(validateDisposalBatchDraft({ title: "", disposalReason: "사유", criteria: { rackId: 3 } }).ok, false);
  assert.equal(validateDisposalBatchDraft({ title: "정기 폐기", disposalReason: "보존기간 만료", criteria: {} }).ok, false);
  assert.equal(validateDisposalBatchDraft({ title: "정기 폐기", disposalReason: "보존기간 만료", criteria: { rackId: 3 } }).ok, true);
});

test("폐기 대상 동결은 스냅샷 INSERT와 상태 변경을 한 batch에 둔다", async () => {
  const env = recordingEnv({
    first(sql) {
      if (sql.includes("COUNT(*) AS count")) return { count: 2 };
      if (sql.includes("FROM disposal_batches b")) return disposalBatch({ status: "draft" });
      return null;
    },
    batch(statements) {
      return statements.map((_, index) => index === 2 ? { meta: { changes: 1 } } : { meta: { changes: 1 } });
    }
  });
  const result = await freezeDisposalBatch(env, 11, actor);
  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /INSERT INTO system_audit_logs/);
  assert.match(statements[1].sql, /INSERT OR IGNORE INTO disposal_batch_items/);
  assert.match(statements[1].sql, /expected_updated_at/);
  assert.match(statements[1].sql, /d\.updated_at/);
  assert.match(statements[2].sql, /status = 'frozen'/);
});

test("폐기 process는 25건을 token으로 선점하고 10개 이하 집합 statement로 처리한다", async () => {
  const env = recordingEnv({
    first(sql) {
      return sql.includes("FROM disposal_batches b") ? disposalBatch({ status: "processing", target_count: 30, pending_count: 30 }) : null;
    },
    batch(statements) {
      return statements.map((_, index) => index === statements.length - 1
        ? { meta: { changes: 1 }, results: [{ ...disposalBatch({ status: "processing", target_count: 30, completed_count: 25, pending_count: 5 }) }] }
        : { meta: { changes: 1 } });
    }
  });
  const result = await processDisposalBatch(env, 11, actor);
  assert.equal(result.ok, true);
  assert.ok(result.statementCount <= 10);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 8);
  assert.match(statements[0].sql, /processing_token/);
  assert.match(statements[0].sql, /LIMIT \?/);
  assert.ok(statements[0].args.includes(25));
  assert.match(statements[1].sql, /disposal_batch_item_id/);
  assert.match(statements[2].sql, /document_audit_logs/);
  assert.match(statements[3].sql, /d\.updated_at = i\.expected_updated_at/);
  assert.match(statements[5].sql, /THEN 'changed'/);
  assert.doesNotMatch(statements.map((item) => item.sql).join("\n"), /disposeDocument\s*\(/);
});

test("CSV 작업 생성은 최대 50행을 한 multi-row staging statement에 저장한다", async () => {
  const env = recordingEnv({
    batch(statements) {
      return statements.map((_, index) => index === 0 ? { results: [{ id: 4 }], meta: { changes: 1 } } : { meta: { changes: 1 } });
    }
  });
  const items = Array.from({ length: 50 }, (_, index) => ({
    values: importValues({ documentNumber: `DOC-${index + 1}` }), status: "active"
  }));
  const result = await createDocumentImportJob(env, { sourceName: "docs.csv", items }, actor);
  assert.deepEqual(result, { ok: true, id: 4 });
  assert.equal(env.state.batches[0].length, 4);
  assert.match(env.state.batches[0][1].sql, /UNION ALL/);
  assert.match(env.state.batches[0][1].sql, /document_import_items/);
});

test("CSV process는 pending 한 행만 token으로 선점하고 문서와 item 완료를 원자 처리한다", async () => {
  const payload = { values: importValues(), status: "active" };
  const env = recordingEnv({
    first(sql) {
      if (!sql.includes("FROM document_import_jobs j")) return null;
      return {
        job_id: 4, job_code: "IMP-2026-0004", job_status: "ready", total_count: 2,
        completed_count: 0, failed_count: 0, item_id: 9, row_number: 2,
        payload_json: JSON.stringify(payload), category_active: 1, slot_active: 1,
        rack_active: 1, is_single_sided: 0, requested_tag_count: 1, active_tag_count: 1
      };
    },
    batch(statements) {
      return statements.map((_, index) => {
        if (index === 0) return { meta: { changes: 1 } };
        if (index === statements.length - 1) return { meta: { changes: 1 }, results: [{ id: 4, status: "processing", total_count: 2, completed_count: 1, failed_count: 0, pending_count: 1 }] };
        return { meta: { changes: 1 } };
      });
    }
  });
  const result = await processDocumentImportJob(env, 4, actor);
  assert.equal(result.ok, true);
  assert.ok(result.statementCount <= 40);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 8);
  assert.match(statements[0].sql, /status = 'pending'/);
  assert.match(statements[0].sql, /processing_token IS NULL/);
  assert.match(statements[1].sql, /INSERT INTO documents/);
  assert.match(statements[4].sql, /created_document_id/);
  assert.match(statements[5].sql, /ARC-/);
});

test("완료된 CSV 작업의 process 재호출은 새 batch를 만들지 않는다", async () => {
  const env = recordingEnv({ first: () => ({
    job_id: 4, job_code: "IMP-2026-0004", job_status: "completed", total_count: 1,
    completed_count: 1, failed_count: 0, item_id: null
  }) });
  const result = await processDocumentImportJob(env, 4, actor);
  assert.equal(result.done, true);
  assert.equal(env.state.batches.length, 0);
});

test("작업 상세 화면은 수동 중단과 재개 endpoint를 제공한다", async () => {
  const session = { ...actor, csrfToken: "x".repeat(40) };
  const disposalHtml = disposalBatchDetailPage({ session, batch: disposalBatch({ status: "processing", pending_count: 5 }), items: [] });
  const disposalBody = await disposalHtml.text();
  assert.match(disposalBody, /data-process-disposal/);
  assert.match(disposalBody, /\/disposal-batches\/11\/process/);
  assert.match(disposalBody, /처리 중단/);
  const importHtml = documentImportJobDetailPage({ session, job: {
    id: 4, job_code: "IMP-2026-0004", status: "processing", total_count: 2,
    completed_count: 1, failed_count: 0, pending_count: 1
  }, items: [] });
  const importBody = await importHtml.text();
  assert.match(importBody, /data-process-import/);
  assert.match(importBody, /\/document-import-jobs\/4\/process/);
});

function disposalBatch(overrides = {}) {
  return {
    id: 11, batch_code: "DSP-2026-0011", title: "정기 폐기", criteria_json: JSON.stringify({ disposalDueYear: 2031 }),
    criteria: { disposalDueYear: 2031, yearMode: "exact", categoryId: 0, zoneNumber: 0, rackId: 0 },
    disposal_reason: "보존기간 만료", approval_reference: "APR-1", status: "draft",
    target_count: 0, completed_count: 0, excluded_count: 0, changed_count: 0, failed_count: 0, pending_count: 0,
    created_by_name: "폐기 담당자", created_at: "2026-07-17", updated_at: "2026-07-17",
    ...overrides
  };
}

function importValues(overrides = {}) {
  return {
    documentNumber: "DOC-1", revisionNumber: "Rev.0", revisionDate: "2026-07-17",
    disposalDueYear: "2031", documentName: "문서", categoryId: 1, rackSlotId: 2,
    rackFace: "A", note: "", tagIds: [3], ...overrides
  };
}

function recordingEnv(behavior = {}) {
  const state = { calls: [], batches: [] };
  return {
    state,
    DB: {
      prepare(sql) {
        const statement = {
          sql, args: [],
          bind(...args) { this.args = args; return this; },
          async first() { state.calls.push({ type: "first", sql, args: this.args }); return behavior.first?.(sql, this.args) ?? null; },
          async all() { state.calls.push({ type: "all", sql, args: this.args }); return { results: behavior.all?.(sql, this.args) ?? [] }; },
          async run() { state.calls.push({ type: "run", sql, args: this.args }); return { meta: { changes: 1 } }; }
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
