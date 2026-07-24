import assert from "node:assert/strict";
import test from "node:test";

import { processDisposalBatch } from "../src/domains/disposal/index.js";
import { handleFilteredDispose } from "../src/handlers/documentHandlers.js";
import { handleDisposalBatches } from "../src/handlers/disposalBatchHandlers.js";
import { handleSetRoute } from "../src/handlers/setHandlers.js";
import { documentFormPage } from "../src/views/documentViews.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

test("기존 폐기 캠페인 목록 주소는 통합 폐기 관리 이력 탭으로 연결한다", async () => {
  const response = await handleDisposalBatches({}, { role: "Admin" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/documents/disposal?tab=history");
});

test("필터 전체 폐기는 확인한 275건을 한 캠페인으로 동결하고 자동 처리 상태로 만든다", async () => {
  const targetCount = 275;
  const state = { batches: [], status: "draft" };
  const batchRow = () => ({
    id: 17,
    batch_code: "DSP-2026-0017",
    title: "2031년 정기폐기",
    criteria_json: JSON.stringify({
      disposalDueYear: 2031,
      yearMode: "exact",
      categoryId: 3,
      zoneNumber: 0,
      rackId: 0
    }),
    disposal_reason: "보존기간 만료",
    approval_reference: "QA-APP-2031-004",
    status: state.status,
    target_count: state.status === "draft" ? 0 : targetCount,
    completed_count: 0,
    excluded_count: 0,
    changed_count: 0,
    failed_count: 0,
    pending_count: state.status === "draft" ? 0 : targetCount,
    created_by_name: "폐기 담당자",
    created_at: "2026-07-23",
    updated_at: "2026-07-23"
  });
  const env = {
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
            if (sql.includes("COUNT(*) AS count")) return { count: targetCount };
            if (sql.includes("FROM disposal_batches b")) return batchRow();
            return null;
          }
        };
        return statement;
      },
      async batch(statements) {
        state.batches.push(statements);
        const sql = statements.map((statement) => statement.sql).join("\n");
        if (sql.includes("status = 'frozen'")) state.status = "frozen";
        if (sql.includes("status = 'processing'")) state.status = "processing";
        return statements.map((statement, index) => ({
          meta: { changes: 1 },
          results: state.batches.length === 1 && index === 0 ? [{ id: 17 }] : [],
          statement
        }));
      }
    }
  };
  const session = {
    userId: 4,
    username: "disposal",
    displayName: "폐기 담당자",
    role: "User",
    can_manage_disposals: 1
  };
  const request = new Request("https://archive.example.com/documents/dispose-filtered", {
    method: "POST",
    body: new URLSearchParams({
      disposalDueYear: "2031",
      categoryId: "3",
      title: "2031년 정기폐기",
      reason: "보존기간 만료",
      approvalReference: "QA-APP-2031-004",
      confirmedTargetCount: String(targetCount),
      confirmDisposal: "1"
    })
  });

  const response = await handleFilteredDispose(request, env, session);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/disposal-batches/17?autostart=1");
  assert.equal(state.status, "processing");
  assert.equal(state.batches.length, 3);
  const sql = state.batches.flat().map((statement) => statement.sql).join("\n");
  assert.match(sql, /INSERT INTO disposal_batches/);
  assert.match(sql, /INSERT OR IGNORE INTO disposal_batch_items/);
  assert.match(sql, /status = 'frozen'/);
  assert.match(sql, /status = 'processing'/);
  assert.doesNotMatch(sql, /UPDATE documents/);
});

test("275건 정기폐기는 25건씩 끝까지 처리하고 캠페인 집계와 문서별 감사를 함께 보존한다", async (context) => {
  const database = await createMigratedDatabase();
  context.after(() => database.close());
  const categoryId = Number(database.prepare(`
    INSERT INTO categories (name, description, sort_order)
    VALUES ('정기폐기 검증', '대용량 정기폐기 종단 검증', 999)
    RETURNING id
  `).get().id);
  const rackSlotId = Number(database.prepare(`
    SELECT rs.id
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE rs.is_active = 1 AND r.is_active = 1
    ORDER BY rs.id
    LIMIT 1
  `).get().id);
  const insert = database.prepare(`
    INSERT INTO documents (
      storage_code, category_id, document_number, revision_number, revision_date,
      disposal_due_year, document_name, rack_slot_id, rack_face, status, sync_state
    )
    VALUES (?, ?, ?, 'Rev.0', '2026-01-01', 2031, ?, ?, 'A', 'active', 'current')
  `);
  database.exec("BEGIN");
  try {
    for (let index = 1; index <= 275; index += 1) {
      const suffix = String(index).padStart(4, "0");
      insert.run(
        `PERIODIC-${suffix}`,
        categoryId,
        `DSP-E2E-${suffix}`,
        `정기폐기 검증 문서 ${suffix}`,
        rackSlotId
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const user = database.prepare(`
    SELECT id, username, display_name, role
    FROM app_users
    WHERE status = 'approved'
    ORDER BY id
    LIMIT 1
  `).get();
  const actor = {
    userId: Number(user.id),
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    can_manage_disposals: 1
  };
  const request = new Request("https://archive.example.com/documents/dispose-filtered", {
    method: "POST",
    body: new URLSearchParams({
      disposalDueYear: "2031",
      categoryId: String(categoryId),
      title: "2031년 정기폐기 종단 검증",
      reason: "보존기간 만료",
      approvalReference: "QA-E2E-2031",
      confirmedTargetCount: "275",
      confirmDisposal: "1"
    })
  });

  const response = await handleFilteredDispose(request, { DB: sqliteD1(database) }, actor);
  assert.equal(response.status, 302);
  const location = response.headers.get("Location");
  const batchId = Number(location?.match(/^\/disposal-batches\/(\d+)\?autostart=1$/)?.[1]);
  assert.ok(batchId > 0);
  assert.deepEqual(
    { ...database.prepare("SELECT status, target_count FROM disposal_batches WHERE id = ?").get(batchId) },
    { status: "processing", target_count: 275 }
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM disposal_batch_items WHERE batch_id = ?").get(batchId).count,
    275
  );

  let result;
  let requests = 0;
  do {
    result = await processDisposalBatch({ DB: sqliteD1(database) }, batchId, actor);
    requests += 1;
  } while (!result.done && requests < 20);

  assert.equal(result.done, true);
  assert.equal(requests, 11);
  assert.deepEqual(
    { ...database.prepare(`
      SELECT status, target_count, completed_count, excluded_count, changed_count, failed_count
      FROM disposal_batches
      WHERE id = ?
    `).get(batchId) },
    {
      status: "completed",
      target_count: 275,
      completed_count: 275,
      excluded_count: 0,
      changed_count: 0,
      failed_count: 0
    }
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM documents WHERE category_id = ? AND status = 'disposed'").get(categoryId).count,
    275
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM disposal_logs WHERE disposal_batch_id = ?").get(batchId).count,
    275
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM document_audit_logs WHERE disposal_batch_id = ?").get(batchId).count,
    275
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM system_audit_logs
      WHERE entity_type = 'disposal_batch' AND entity_id = ? AND action = 'complete'
    `).get(String(batchId)).count,
    1
  );
});

test("미등록 세트 문서 연결은 문서번호와 안전한 복귀 경로를 폼에 보존한다", async () => {
  const response = documentFormPage({
    session: { role: "Admin", displayName: "관리자", csrfToken: "csrf" },
    title: "문서 등록",
    action: "/documents",
    values: { documentNumber: "PV-NEW-01", returnTo: "/sets/9" },
    categories: [],
    tags: [],
    slots: [],
    selectedTags: []
  });
  const html = await response.text();

  assert.match(html, /name="documentNumber" value="PV-NEW-01"/);
  assert.match(html, /name="returnTo" value="\/sets\/9"/);
});

test("세트 추가와 복제 HTTP 경로는 버전 검사를 거쳐 잠기지 않은 복제본을 만든다", async (context) => {
  const database = await createMigratedDatabase();
  context.after(() => database.close());
  const sourceId = Number(database.prepare(`
    INSERT INTO document_sets (name, description, created_by)
    VALUES ('원본 준비 세트', '복제 경로 검증', '통합 테스트')
    RETURNING id
  `).get().id);
  const documentIds = database.prepare("SELECT id FROM documents ORDER BY id LIMIT 2").all().map((row) => Number(row.id));
  assert.equal(documentIds.length, 2);
  database.prepare("INSERT INTO document_set_items (set_id, document_id) VALUES (?, ?)").run(sourceId, documentIds[0]);
  const env = { DB: sqliteD1(database) };
  const session = {
    userId: 77,
    username: "set-manager@hanlim.test",
    displayName: "세트 담당자",
    role: "Admin",
    csrfToken: "set-route-csrf"
  };

  const addVersion = Number(database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(sourceId).row_version);
  const addResponse = await handleSetRoute(new Request(`https://archive.example.com/sets/${sourceId}/add`, {
    method: "POST",
    body: new URLSearchParams({
      documentId: String(documentIds[1]),
      expectedRowVersion: String(addVersion)
    })
  }), env, session, { id: sourceId, action: "add" });
  assert.equal(addResponse.status, 200);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM document_set_items WHERE set_id = ?").get(sourceId).count,
    2
  );

  const cloneVersion = Number(database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(sourceId).row_version);
  const cloneForm = await handleSetRoute(
    new Request(`https://archive.example.com/sets/${sourceId}/clone`),
    env,
    session,
    { id: sourceId, action: "clone" }
  );
  assert.equal(cloneForm.status, 200);
  assert.match(await cloneForm.text(), /원본 세트<\/dt><dd>원본 준비 세트/);

  const cloneResponse = await handleSetRoute(new Request(`https://archive.example.com/sets/${sourceId}/clone`, {
    method: "POST",
    body: new URLSearchParams({
      name: "원본 준비 세트 복제본",
      expectedRowVersion: String(cloneVersion)
    })
  }), env, session, { id: sourceId, action: "clone" });
  assert.equal(cloneResponse.status, 302);
  const cloneId = Number(cloneResponse.headers.get("Location")?.match(/^\/sets\/(\d+)\?toast=saved$/)?.[1]);
  assert.ok(cloneId > 0);
  assert.equal(database.prepare("SELECT is_locked FROM document_sets WHERE id = ?").get(cloneId).is_locked, 0);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM document_set_items WHERE set_id = ?").get(cloneId).count,
    2
  );
});
