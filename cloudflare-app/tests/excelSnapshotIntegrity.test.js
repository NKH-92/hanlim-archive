import assert from "node:assert/strict";
import test from "node:test";

import { loadDocumentFormOptions } from "../src/domains/documents/index.js";
import {
  applyDocumentSnapshot,
  createDocumentSnapshot as createDocumentSnapshotRaw,
  dateOnlyToUtcDate,
  evaluateSnapshotApplyAuthorization,
  getDocumentSnapshotExclusions,
  prepareCanonicalSnapshotRows,
  prepareDocumentSnapshot,
  stageDocumentSnapshotRows,
  utcDateToDateOnly,
  computeCanonicalRowsHash,
  documentIdentity
} from "../src/domains/snapshots/index.js";
import { PERMISSIONS } from "../src/permissions.js";
import { handleCreateDocumentSnapshot } from "../src/handlers/snapshotHandlers.js";
import { documentSnapshotDetailPage } from "../src/views/snapshotViews.js";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

function reviewConfirmation(snapshot) {
  return {
    confirmReview: true,
    confirmedReviewCount: Number(snapshot.create_count || 0) + Number(snapshot.update_count || 0) + Number(snapshot.exclude_count || 0)
  };
}

test("문서관리 권한만 가진 User는 snapshot apply를 할 수 없다", () => {
  const session = {
    role: "User",
    can_manage_documents: 1,
    can_apply_document_snapshots: 0,
    can_move_documents: 0,
    can_manage_disposals: 0
  };
  const result = evaluateSnapshotApplyAuthorization(session, { moveCount: 0, disposeCount: 0, restoreCount: 0 }, {
    EXCEL_SNAPSHOT_APPLY_MODE: "permissioned"
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SNAPSHOT_APPLY_PERMISSION_REQUIRED");
});

test("동기화 작업 생성은 사유를 필수로 저장하고 시작 감사에 포함한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  try {
    const baseInput = {
      sourceName: "reason.xlsx",
      sourceHash: "0".repeat(64),
      sourceSize: 4096,
      totalCount: 1,
      schemaVersion: 1,
      mode: "bootstrap",
      bootstrapConfirmation: "BOOTSTRAP",
      backupConfirmed: true
    };
    const missing = await createDocumentSnapshotRaw(env, baseInput, actor);
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "SNAPSHOT_REASON_REQUIRED");
    assert.match(missing.message, /동기화 사유/);

    const syncReason = "2026년 정기 문서고 관리대장 현행화";
    const form = new FormData();
    Object.entries({ ...baseInput, syncReason }).forEach(([key, value]) => {
      form.set(key, value === true ? "1" : String(value));
    });
    const response = await handleCreateDocumentSnapshot(
      new Request("https://archive.example/document-snapshots", { method: "POST", body: form }),
      env,
      actor
    );
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.ok, true, created.message);
    assert.equal(
      database.prepare("SELECT apply_reason FROM document_snapshots WHERE id = ?").get(created.id).apply_reason,
      syncReason
    );
    const details = JSON.parse(
      database.prepare(`
        SELECT details_json
        FROM system_audit_logs
        WHERE entity_type = 'document_snapshot' AND entity_id = ? AND action = 'create'
      `).get(String(created.id)).details_json
    );
    assert.equal(details.syncReason, syncReason);
  } finally {
    database.close();
  }
});

test("위치·폐기·폐기해제 추가 권한이 없으면 apply가 403으로 거부된다", () => {
  const base = {
    role: "User",
    can_manage_documents: 1,
    can_apply_document_snapshots: 1,
    can_move_documents: 0,
    can_manage_disposals: 0
  };
  assert.equal(evaluateSnapshotApplyAuthorization(base, { moveCount: 1, disposeCount: 0, restoreCount: 0 }, { EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" }).code, "SNAPSHOT_MOVE_PERMISSION_REQUIRED");
  assert.equal(evaluateSnapshotApplyAuthorization(base, { moveCount: 0, disposeCount: 1, restoreCount: 0 }, { EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" }).code, "SNAPSHOT_DISPOSAL_PERMISSION_REQUIRED");
  assert.equal(evaluateSnapshotApplyAuthorization({ ...base, can_manage_disposals: 1 }, { moveCount: 0, disposeCount: 0, restoreCount: 1 }, { EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" }).code, "SNAPSHOT_RESTORE_ADMIN_REQUIRED");
});

test("날짜 전용 값은 시간대와 무관하게 YYYY-MM-DD로 왕복한다", () => {
  for (const value of ["1900-03-01", "2024-02-29", "2026-01-01", "2026-07-20", "2026-12-31"]) {
    const date = dateOnlyToUtcDate(value);
    assert.ok(date);
    assert.equal(utcDateToDateOnly(date), value);
    assert.equal(date.getUTCHours(), 0);
  }
});

test("strict parser는 공란 개정·상태·위치를 기본값으로 보정하지 않는다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    const options = await loadDocumentFormOptions(env, { activeOnly: true });
    const prepared = prepareCanonicalSnapshotRows([{
      rowNumber: 2,
      documentNumber: "DOC-X",
      revisionNumber: "",
      revisionDate: "",
      disposalDueYear: "",
      documentName: "테스트",
      category: "PV",
      rackNumber: "",
      rackColumn: "",
      shelfNumber: "",
      rackFace: "",
      tags: "",
      note: "",
      status: "정상"
    }], options);
    assert.equal(prepared.ok, false);
    assert.ok(prepared.errors.some((error) => error.field === "revisionNumber"));
    assert.ok(prepared.errors.some((error) => error.field === "status"));
    assert.ok(prepared.errors.some((error) => error.field === "location"));
  } finally {
    database.close();
  }
});

test("파일 내부 identity 중복과 case-only 중복은 prepare에서 실패한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  try {
    const rows = [
      row(2, "DOC-DUP", "Rev.1"),
      row(3, "doc-dup", "rev.1")
    ];
    const created = await createDocumentSnapshot(env, {
      sourceName: "dup.xlsx", sourceHash: "e".repeat(64), totalCount: 2, schemaVersion: 1, mode: "bootstrap"
    }, actor);
    assert.equal(created.ok, true);
    assert.equal((await stageDocumentSnapshotRows(env, created.id, rows)).ok, true);
    const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
    assert.equal(prepared.ok, false);
    assert.equal(prepared.code, "SNAPSHOT_IDENTITY_DUPLICATE");
  } finally {
    database.close();
  }
});

test("managed 모드에서 메타데이터 없는 파일과 unsupported schema는 거부된다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  try {
    const missing = await createDocumentSnapshot(env, {
      sourceName: "no-meta.xlsx", sourceHash: "f".repeat(64), totalCount: 1, schemaVersion: 1, mode: "managed"
    }, actor);
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "SNAPSHOT_METADATA_REQUIRED");

    const unsupported = await createDocumentSnapshot(env, {
      sourceName: "old.xlsx", sourceHash: "1".repeat(64), totalCount: 1, schemaVersion: 99, mode: "bootstrap"
    }, actor);
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.code, "SNAPSHOT_SCHEMA_UNSUPPORTED");
  } finally {
    database.close();
  }
});

test("권한 부족 apply는 문서와 snapshot 상태를 바꾸지 않는다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" };
  const admin = actorFixture();
  try {
    const rows = [row(2, "DOC-AUTH", "Rev.0")];
    const created = await createDocumentSnapshot(env, {
      sourceName: "auth.xlsx", sourceHash: "2".repeat(64), totalCount: 1, schemaVersion: 1, mode: "bootstrap"
    }, admin);
    await stageDocumentSnapshotRows(env, created.id, rows);
    const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, admin);
    assert.equal(prepared.ok, true, prepared.message);

    const user = {
      userId: 99,
      username: "doc.user",
      displayName: "문서 담당",
      role: "User",
      can_manage_documents: 1,
      can_apply_document_snapshots: 0
    };
    const applied = await applyDocumentSnapshot(env, created.id, user, {
      applyReason: "권한 없는 반영 시도입니다",
      approvalReference: "X",
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.code, "SNAPSHOT_APPLY_PERMISSION_REQUIRED");
    assert.equal(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(created.id).status, "ready");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE document_number = 'DOC-AUTH'").get().count, 0);
  } finally {
    database.close();
  }
});

test("위치 변경은 movement log를, 폐기는 disposal log를 남긴다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "admin-only" };
  const actor = actorFixture();
  try {
    const first = [row(2, "DOC-MOVE", "Rev.0", { rackColumn: "1", shelfNumber: "1", status: "보관중" })];
    const created = await createDocumentSnapshot(env, {
      sourceName: "move.xlsx", sourceHash: "3".repeat(64), totalCount: 1, schemaVersion: 1, mode: "bootstrap"
    }, actor);
    await stageDocumentSnapshotRows(env, created.id, first);
    const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
    await applyDocumentSnapshot(env, created.id, actor, {
      applyReason: "이동·폐기 이력 검증용 반영",
      approvalReference: "MOV-1",
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    });
    const document = database.prepare("SELECT * FROM documents WHERE document_number = 'DOC-MOVE'").get();
    const exported = {
      rowKey: document.excel_row_key,
      documentNumber: "DOC-MOVE",
      revisionNumber: "Rev.0",
      revisionDate: "2026-07-20",
      disposalDueYear: "2031",
      documentName: "이동 문서",
      category: "PV",
      rackNumber: "2",
      rackColumn: "2",
      shelfNumber: "2",
      rackFace: "1면",
      tags: "중요문서",
      note: "",
      status: "폐기"
    };
    const secondRows = [{ rowNumber: 2, sourceRowKey: exported.rowKey, source: exported }];
    const state = database.prepare("SELECT current_version, current_snapshot_id FROM document_sync_state WHERE id = 1").get();
    const second = await createDocumentSnapshot(env, {
      sourceName: "move2.xlsx",
      sourceHash: "4".repeat(64),
      totalCount: 1,
      schemaVersion: 1,
      mode: "managed",
      baseVersion: state.current_version,
      currentSnapshotId: state.current_snapshot_id,
      hasRowKeys: true
    }, actor);
    await stageDocumentSnapshotRows(env, second.id, secondRows);
    const prepared2 = await prepareDocumentSnapshot(env, second.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
    assert.equal(Number(prepared2.snapshot.move_count), 1);
    assert.equal(Number(prepared2.snapshot.dispose_count), 1);
    const applied2 = await applyDocumentSnapshot(env, second.id, actor, {
      applyReason: "위치 변경과 폐기 반영 검증",
      approvalReference: "MOV-2",
      confirmedExcludeCount: 0,
      confirmExclude: true,
      ...reviewConfirmation(prepared2.snapshot)
    });
    assert.equal(applied2.ok, true, applied2.message);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_movements WHERE document_id = ?").get(document.id).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM disposal_logs WHERE document_id = ? AND action = 'disposed'").get(document.id).count, 1);
    assert.equal(database.prepare("SELECT snapshot_code FROM document_movements WHERE document_id = ?").get(document.id).snapshot_code, prepared2.snapshot.snapshot_code);
    assert.equal(database.prepare("SELECT snapshot_code FROM disposal_logs WHERE document_id = ? AND action = 'disposed'").get(document.id).snapshot_code, prepared2.snapshot.snapshot_code);
  } finally {
    database.close();
  }
});

test("미리보기 UI는 제외 목록과 before/after를 포함한다", async () => {
  const response = documentSnapshotDetailPage({
    session: { role: "Admin", username: "admin", displayName: "관리자", csrfToken: "token".repeat(8) },
    snapshot: {
      id: 9,
      snapshot_code: "SNP-2026-0009",
      source_name: "preview.xlsx",
      status: "ready",
      total_count: 2,
      create_count: 0,
      update_count: 1,
      unchanged_count: 0,
      exclude_count: 1,
      metadata_count: 1,
      move_count: 1,
      dispose_count: 0,
      restore_count: 0,
      tag_change_count: 0,
      reinclude_count: 0,
      base_version: 3,
      source_hash: "a".repeat(64),
      canonical_rows_hash: "b".repeat(64),
      created_by_name: "관리자",
      created_at: "2026-07-20 10:00:00"
    },
    rows: [{
      row_number: 2,
      action: "update",
      changed_fields_json: JSON.stringify(["documentName", "rackSlotId"]),
      change_flags_json: JSON.stringify(["METADATA", "MOVE"]),
      before_json: JSON.stringify({ schemaVersion: 1, rowKey: "HLM-1", values: { documentNumber: "DOC-1", revisionNumber: "Rev.0", documentName: "이전", rackSlotId: 1, rackFace: "A", status: "active" } }),
      after_json: JSON.stringify({ schemaVersion: 1, rowKey: "HLM-1", values: { documentNumber: "DOC-1", revisionNumber: "Rev.0", documentName: "이후", rackSlotId: 2, rackFace: "A", status: "active" } })
    }],
    exclusions: [{
      document_id: 7,
      before_json: JSON.stringify({ schemaVersion: 1, rowKey: "HLM-7", values: { documentNumber: "DOC-EX", revisionNumber: "Rev.0", documentName: "제외문서", status: "active", rackCode: "1-01", rackFace: "A" } })
    }],
    canApply: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DOCUMENTS, PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS, PERMISSIONS.MOVE_DOCUMENTS],
    missingPermissions: [],
    warnings: [
      { code: "EXCLUSION", level: "danger", message: "업로드 파일에 없는 문서 1건이 대장에서 제외됩니다." },
      { code: "LARGE_CHANGE", level: "warning", message: "현재 대장의 10% 이상이 변경됩니다." }
    ]
  });
  const html = await response.text();

  assert.match(html, /제외문서/);
  assert.match(html, /대장 제외 예정/);
  assert.match(html, /documentName: 이전/);
  assert.match(html, /documentName: 이후/);
  assert.match(html, /name="applyReason"/);
  assert.match(html, /name="confirmedExcludeCount"/);
  assert.match(html, /EXCLUSION/);
  assert.match(html, /LARGE_CHANGE/);
  assert.match(html, /snapshot-warnings/);
  assert.match(html, /Identity 변경/);
  assert.match(html, /세트/);
  assert.match(html, /최근 이동/);
  assert.match(html, /\/document-snapshots\/9\/cancel/);
});

test("검증 실패 상세는 앞 20건과 전체 오류 CSV 동선을 제공한다", async () => {
  const validationErrors = Array.from({ length: 21 }, (_, index) => ({
    rowNumber: index + 2,
    field: "revisionDate",
    code: "SNAPSHOT_INVALID_FIELD",
    message: `${index + 2}행 날짜 오류`
  }));
  const response = documentSnapshotDetailPage({
    session: { role: "Admin", username: "admin", displayName: "관리자", csrfToken: "token".repeat(8) },
    snapshot: {
      id: 10,
      snapshot_code: "SNP-2026-0010",
      source_name: "invalid.xlsx",
      status: "failed",
      total_count: 21,
      created_by_name: "관리자",
      created_at: "2026-07-20 10:00:00",
      error_summary: "검증 오류"
    },
    validationErrors
  });
  const html = await response.text();
  assert.match(html, /오류 CSV 내려받기/);
  assert.match(html, /외 1건은 CSV/);
  assert.match(html, /22행 날짜 오류/);
  assert.match(html, /data-snapshot-error-table/);
});

test("canonical rows hash는 배열 순서가 달라도 동일하다", async () => {
  const left = await computeCanonicalRowsHash([
    { rowNumber: 3, rowKey: "B", status: "active", values: { documentNumber: "D2", revisionNumber: "R1", tagIds: [2, 1], status: "active" } },
    { rowNumber: 2, rowKey: "A", status: "active", values: { documentNumber: "D1", revisionNumber: "R1", tagIds: [1, 2], status: "active" } }
  ]);
  const right = await computeCanonicalRowsHash([
    { rowNumber: 2, rowKey: "A", status: "active", values: { documentNumber: "D1", revisionNumber: "R1", tagIds: [2, 1], status: "active" } },
    { rowNumber: 3, rowKey: "B", status: "active", values: { documentNumber: "D2", revisionNumber: "R1", tagIds: [1, 2], status: "active" } }
  ]);
  assert.equal(left, right);
  assert.equal(documentIdentity("doc-1", "rev.0"), documentIdentity("DOC-1", "Rev.0"));
});

test("exclusion 목록 API와 table 행 수가 일치한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  try {
    const linked = database.prepare("SELECT id, document_number, rack_slot_id, rack_face FROM documents ORDER BY id LIMIT 1").get();
    const setResult = database.prepare("INSERT INTO document_sets (name, created_by) VALUES ('제외 위험 검토 세트', 'test')").run();
    database.prepare("INSERT INTO document_set_items (set_id, document_id) VALUES (?, ?)").run(setResult.lastInsertRowid, linked.id);
    database.prepare(`
      INSERT INTO document_movements (
        document_id, document_number_snapshot, from_rack_slot_id, from_rack_face,
        to_rack_slot_id, to_rack_face, from_location_snapshot, to_location_snapshot,
        reason, performed_by_username, performed_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, '이전 위치', '현재 위치', '최근 이동 위험 표시', 'test', '테스트')
    `).run(linked.id, linked.document_number, linked.rack_slot_id, linked.rack_face, linked.rack_slot_id, linked.rack_face);
    const rows = [row(2, "DOC-ONLY", "Rev.0")];
    const created = await createDocumentSnapshot(env, {
      sourceName: "ex.xlsx", sourceHash: "5".repeat(64), totalCount: 1, schemaVersion: 1, mode: "bootstrap"
    }, actor);
    await stageDocumentSnapshotRows(env, created.id, rows);
    const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
    assert.equal(prepared.ok, true, prepared.message);
    const exclusions = await getDocumentSnapshotExclusions(env, created.id);
    assert.equal(exclusions.length, Number(prepared.snapshot.exclude_count));
    assert.equal(exclusions.length, 2);
    const linkedExclusion = exclusions.find((item) => Number(item.document_id) === Number(linked.id));
    assert.equal(Number(linkedExclusion.set_count), 1);
    assert.ok(linkedExclusion.recent_movement_at);
  } finally {
    database.close();
  }
});

test("동시 apply claim은 한 번만 완료되고 completed 재호출은 alreadyApplied다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "admin-only" };
  const actor = actorFixture();
  try {
    const prepared = await bootstrapReadySnapshot(env, actor, [row(2, "DOC-CLAIM", "Rev.0")], "6".repeat(64));
    const [first, second] = await Promise.all([
      applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
        applyReason: "동시 반영 경쟁 검증 A",
        approvalReference: "RACE-A",
        confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
        confirmExclude: true,
        ...reviewConfirmation(prepared.snapshot)
      }),
      applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
        applyReason: "동시 반영 경쟁 검증 B",
        approvalReference: "RACE-B",
        confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
        confirmExclude: true,
        ...reviewConfirmation(prepared.snapshot)
      })
    ]);
    const completed = [first, second].filter((result) => result.ok && !result.alreadyApplied);
    const rejectedOrIdempotent = [first, second].filter((result) => !result.ok || result.alreadyApplied);
    assert.equal(completed.length, 1, `exactly one apply should mutate: ${JSON.stringify([first, second])}`);
    assert.equal(rejectedOrIdempotent.length, 1);
    assert.equal(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(prepared.snapshot.id).status, "completed");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE document_number = 'DOC-CLAIM' AND sync_state = 'current'").get().count, 1);

    const again = await applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
      applyReason: "완료 후 재호출",
      approvalReference: "RACE-C",
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyApplied, true);
  } finally {
    database.close();
  }
});

test("apply batch 중간 SQL 실패 시 문서·snapshot이 롤백된다", async () => {
  const database = await createMigratedDatabase();
  const base = sqliteD1(database);
  const env = {
    DB: {
      prepare: (sql) => base.prepare(sql),
      async batch(statements) {
        const isApplyBatch = /SET status = 'applying'/i.test(statements[0]?.sql || "");
        database.exec("BEGIN IMMEDIATE");
        try {
          const results = [];
          for (let index = 0; index < statements.length; index += 1) {
            const { sql, args } = statements[index];
            if (isApplyBatch && index === 7) {
              throw new Error("injected mid-batch failure");
            }
            if (/\bRETURNING\b/i.test(sql)) {
              const rows = database.prepare(sql).all(...args);
              results.push({
                results: rows,
                meta: {
                  changes: Number(database.prepare("SELECT changes() AS count").get().count || 0),
                  last_row_id: Number(database.prepare("SELECT last_insert_rowid() AS id").get().id || 0)
                }
              });
            } else {
              const result = database.prepare(sql).run(...args);
              results.push({ results: [], meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } });
            }
          }
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      }
    },
    EXCEL_SNAPSHOT_APPLY_MODE: "admin-only"
  };
  const actor = actorFixture();
  try {
    const prepared = await bootstrapReadySnapshot(env, actor, [row(2, "DOC-FAIL", "Rev.0")], "7".repeat(64));
    const beforeDocs = database.prepare("SELECT COUNT(*) AS count FROM documents").get().count;
    await assert.rejects(
      () => applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
        applyReason: "중간 실패 롤백 검증",
        approvalReference: "FAIL-1",
        confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
        confirmExclude: true,
        ...reviewConfirmation(prepared.snapshot)
      }),
      /injected mid-batch failure/
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents").get().count, beforeDocs);
    assert.equal(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(prepared.snapshot.id).status, "ready");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE document_number = 'DOC-FAIL'").get().count, 0);
  } finally {
    database.close();
  }
});

test("prepare 이후 unique identity 경합은 apply batch를 롤백한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "admin-only" };
  const actor = actorFixture();
  try {
    const prepared = await bootstrapReadySnapshot(env, actor, [row(2, "DOC-UNIQ", "Rev.0")], "8".repeat(64));
    const slot = database.prepare("SELECT id FROM rack_slots ORDER BY id LIMIT 1").get();
    const category = database.prepare("SELECT id FROM categories WHERE name = 'PV'").get();
    database.prepare(`
      INSERT INTO documents (
        storage_code, excel_row_key, category_id, document_number, revision_number,
        revision_date, disposal_due_year, document_name, note, rack_slot_id, rack_face,
        status, sync_state, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', CURRENT_TIMESTAMP)
    `).run(
      "ARC-RACE-1",
      "HLM-RACE-UNIQ",
      category.id,
      "DOC-UNIQ",
      "Rev.0",
      "2026-07-20",
      2031,
      "경합 문서",
      "",
      slot.id,
      "A",
      "active"
    );
    const state = database.prepare("SELECT current_version FROM document_sync_state WHERE id = 1").get();
    const currentCount = database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").get().count;
    database.prepare(`
      UPDATE document_snapshots
      SET base_version = ?, baseline_current_document_count = ?
      WHERE id = ?
    `).run(state.current_version, currentCount, prepared.snapshot.id);
    const beforeCount = database.prepare("SELECT COUNT(*) AS count FROM documents WHERE document_number = 'DOC-UNIQ'").get().count;
    await assert.rejects(
      () => applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
        applyReason: "unique index 경합 롤백 검증",
        approvalReference: "UNIQ-1",
        confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
        confirmExclude: true,
        ...reviewConfirmation(prepared.snapshot)
      })
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE document_number = 'DOC-UNIQ'").get().count, beforeCount);
    assert.notEqual(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(prepared.snapshot.id).status, "completed");
  } finally {
    database.close();
  }
});

test("같은 위치 유지 update는 movement 0이고 폐기 해제는 restore log를 남긴다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "admin-only" };
  const actor = actorFixture();
  try {
    const first = [row(2, "DOC-REST", "Rev.0", { status: "폐기" })];
    const created = await createDocumentSnapshot(env, {
      sourceName: "restore.xlsx", sourceHash: "9".repeat(64), totalCount: 1, schemaVersion: 1, mode: "bootstrap"
    }, actor);
    await stageDocumentSnapshotRows(env, created.id, first);
    const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
    await applyDocumentSnapshot(env, created.id, actor, {
      applyReason: "폐기 문서 bootstrap",
      approvalReference: "RST-1",
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    });
    const document = database.prepare("SELECT * FROM documents WHERE document_number = 'DOC-REST'").get();
    const state = database.prepare("SELECT current_version, current_snapshot_id FROM document_sync_state WHERE id = 1").get();
    const secondRows = [{
      rowNumber: 2,
      sourceRowKey: document.excel_row_key,
      source: {
        documentNumber: "DOC-REST",
        revisionNumber: "Rev.0",
        revisionDate: "2026-07-20",
        disposalDueYear: "2031",
        documentName: "무결성 검증 문서",
        category: "PV",
        rackNumber: "1",
        rackColumn: "1",
        shelfNumber: "1",
        rackFace: "단면",
        tags: "중요문서",
        note: "이름만 유지 위치 동일",
        status: "보관중"
      }
    }];
    const second = await createDocumentSnapshot(env, {
      sourceName: "restore2.xlsx",
      sourceHash: "a".repeat(64),
      totalCount: 1,
      schemaVersion: 1,
      mode: "managed",
      baseVersion: state.current_version,
      currentSnapshotId: state.current_snapshot_id,
      hasRowKeys: true
    }, actor);
    await stageDocumentSnapshotRows(env, second.id, secondRows);
    const prepared2 = await prepareDocumentSnapshot(env, second.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
    assert.equal(Number(prepared2.snapshot.move_count), 0);
    assert.equal(Number(prepared2.snapshot.restore_count), 1);
    const applied2 = await applyDocumentSnapshot(env, second.id, actor, {
      applyReason: "폐기 해제와 동일 위치 검증",
      approvalReference: "RST-2",
      confirmedExcludeCount: 0,
      confirmExclude: true,
      ...reviewConfirmation(prepared2.snapshot)
    });
    assert.equal(applied2.ok, true, applied2.message);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_movements WHERE document_id = ?").get(document.id).count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM disposal_logs WHERE document_id = ? AND action = 'restored'").get(document.id).count, 1);
  } finally {
    database.close();
  }
});

test("prepare 중 문서고 version이 바뀌면 snapshot이 failed로 terminal 처리된다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  try {
    const rows = [row(2, "DOC-STALE-P", "Rev.0")];
    const created = await createDocumentSnapshot(env, {
      sourceName: "stale-prepare.xlsx", sourceHash: "c".repeat(64), totalCount: 1, schemaVersion: 1, mode: "bootstrap"
    }, actor);
    await stageDocumentSnapshotRows(env, created.id, rows);
    database.prepare("UPDATE document_sync_state SET current_version = current_version + 1 WHERE id = 1").run();
    const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
    assert.equal(prepared.ok, false);
    assert.equal(prepared.stale, true);
    assert.equal(database.prepare("SELECT status FROM document_snapshots WHERE id = ?").get(created.id).status, "failed");
  } finally {
    database.close();
  }
});

test("identity 중복 오류는 문서번호·개정·충돌 행을 포함한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  try {
    const rows = [row(2, "DOC-MSG", "Rev.1"), row(5, "DOC-MSG", "Rev.1")];
    const created = await createDocumentSnapshot(env, {
      sourceName: "msg.xlsx", sourceHash: "b".repeat(64), totalCount: 2, schemaVersion: 1, mode: "bootstrap"
    }, actor);
    await stageDocumentSnapshotRows(env, created.id, rows);
    const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
    assert.equal(prepared.ok, false);
    assert.match(prepared.message || "", /DOC-MSG/);
    assert.match(prepared.message || JSON.stringify(prepared.errors || []), /Rev\.1|2행|5행|충돌/);
  } finally {
    database.close();
  }
});

test("승인 정책 버전·baseline 건수 drift는 apply를 fail-closed한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "admin-only" };
  const actor = actorFixture();
  try {
    const prepared = await bootstrapReadySnapshot(env, actor, [row(2, "DOC-POL", "Rev.0")], "c".repeat(64));
    database.prepare(`
      UPDATE document_snapshots SET approval_policy_version = 'v0-stale' WHERE id = ?
    `).run(prepared.snapshot.id);
    const policyReject = await applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
      applyReason: "정책 버전 drift 검증용 반영 사유",
      approvalReference: "POL-1",
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    });
    assert.equal(policyReject.ok, false);
    assert.match(policyReject.message || "", /승인 정책/);

    database.prepare(`
      UPDATE document_snapshots SET approval_policy_version = 'v1' WHERE id = ?
    `).run(prepared.snapshot.id);
    database.prepare(`
      UPDATE document_snapshots SET baseline_current_document_count = baseline_current_document_count + 5 WHERE id = ?
    `).run(prepared.snapshot.id);
    const baselineReject = await applyDocumentSnapshot(env, prepared.snapshot.id, actor, {
      applyReason: "baseline drift 검증용 반영 사유입니다",
      approvalReference: "POL-2",
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    });
    assert.equal(baselineReject.ok, false);
    assert.match(baselineReject.message || "", /대장 건수|미리보기/);
  } finally {
    database.close();
  }
});

test("1000건 대장에서 100건 변경은 LARGE_CHANGE 경고와 승인 참조를 만든다", async () => {
  const { computeRiskWarnings } = await import("../src/domains/snapshots/domain/diff.js");
  const { approvalReferenceRequired } = await import("../src/domains/snapshots/domain/authorization.js");
  const warnings = computeRiskWarnings({
    summary: { updateCount: 100, createCount: 0, excludeCount: 0, restoreCount: 0 },
    currentDocumentCount: 1000
  });
  assert.ok(warnings.some((item) => item.code === "LARGE_CHANGE"));
  assert.equal(approvalReferenceRequired({ excludeCount: 0, moveCount: 0, disposeCount: 0, restoreCount: 0 }, {
    warnings
  }), true);
});

test("파일 기반 이중 DatabaseSync 경합에서 패자는 문서/감사 증가가 없다", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const dir = await mkdtemp(join(tmpdir(), "snap-race-"));
  const dbPath = join(dir, "race.sqlite");
  let writer;
  let reader;
  try {
    writer = await createMigratedDatabase(dbPath);
    writer.exec("PRAGMA journal_mode = WAL;");
    writer.close();
    writer = new DatabaseSync(dbPath);
    reader = new DatabaseSync(dbPath);
    const envA = { DB: sqliteD1(writer), EXCEL_SNAPSHOT_APPLY_MODE: "admin-only" };
    const envB = { DB: sqliteD1(reader), EXCEL_SNAPSHOT_APPLY_MODE: "admin-only" };
    const actor = actorFixture();
    const prepared = await bootstrapReadySnapshot(envA, actor, [row(2, "DOC-DUAL", "Rev.0")], "d".repeat(64));
    const docsBefore = writer.prepare("SELECT COUNT(*) AS n FROM documents").get().n;
    const auditsBefore = writer.prepare("SELECT COUNT(*) AS n FROM system_audit_logs").get().n;
    const input = {
      applyReason: "이중 연결 경합 검증용 반영 사유",
      approvalReference: "DUAL-1",
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(prepared.snapshot)
    };
    const results = await Promise.allSettled([
      applyDocumentSnapshot(envA, prepared.snapshot.id, actor, input),
      applyDocumentSnapshot(envB, prepared.snapshot.id, actor, input)
    ]);
    const outcomes = results.map((item) => item.status === "fulfilled" ? item.value : { ok: false, message: String(item.reason) });
    const winners = outcomes.filter((item) => item?.ok);
    assert.ok(winners.length <= 1, "최대 한 apply만 성공해야 한다");
    const docsAfter = writer.prepare("SELECT COUNT(*) AS n FROM documents").get().n;
    const auditsAfter = writer.prepare("SELECT COUNT(*) AS n FROM system_audit_logs").get().n;
    if (winners.length === 1) {
      assert.ok(docsAfter >= docsBefore);
      // 패자 경로가 부분 커밋하면 audits/docs가 비정상 증가한다 — 증가폭은 승자 1회 분량이어야 한다.
      assert.ok(auditsAfter - auditsBefore <= 3);
    } else {
      assert.equal(docsAfter, docsBefore);
      assert.equal(auditsAfter, auditsBefore);
    }
  } finally {
    try { writer?.close(); } catch { /* ignore */ }
    try { reader?.close(); } catch { /* ignore */ }
    await rm(dir, { recursive: true, force: true });
  }
});

async function bootstrapReadySnapshot(env, actor, rows, sourceHash) {
  const created = await createDocumentSnapshot(env, {
    sourceName: "race.xlsx",
    sourceHash,
    totalCount: rows.length,
    schemaVersion: 1,
    mode: "bootstrap"
  }, actor);
  assert.equal(created.ok, true, created.message);
  assert.equal((await stageDocumentSnapshotRows(env, created.id, rows)).ok, true);
  const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
  assert.equal(prepared.ok, true, prepared.message);
  return prepared;
}

function row(rowNumber, documentNumber, revisionNumber, overrides = {}) {
  return {
    rowNumber,
    sourceRowKey: "",
    source: {
      documentNumber,
      revisionNumber,
      revisionDate: "2026-07-20",
      disposalDueYear: "2031",
      documentName: "무결성 검증 문서",
      category: "PV",
      rackNumber: "1",
      rackColumn: "1",
      shelfNumber: "1",
      rackFace: "단면",
      tags: "중요문서",
      note: "",
      status: "보관중",
      ...overrides
    }
  };
}

function createDocumentSnapshot(env, input, actor) {
  return createDocumentSnapshotRaw(env, {
    sourceSize: 4096,
    syncReason: "통합 테스트 문서고 대장 동기화",
    bootstrapConfirmation: input?.mode === "bootstrap" ? "BOOTSTRAP" : "",
    backupConfirmed: input?.mode === "bootstrap",
    ...input
  }, actor);
}
