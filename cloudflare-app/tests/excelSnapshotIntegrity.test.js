import assert from "node:assert/strict";
import test from "node:test";

import { loadDocumentFormOptions } from "../src/domains/documents/index.js";
import {
  applyDocumentSnapshot,
  createDocumentSnapshot,
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
import { documentSnapshotDetailPage } from "../src/views/snapshotViews.js";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

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
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0)
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
      confirmedExcludeCount: Number(prepared.snapshot.exclude_count || 0)
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
      confirmedExcludeCount: 0
    });
    assert.equal(applied2.ok, true, applied2.message);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_movements WHERE document_id = ?").get(document.id).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM disposal_logs WHERE document_id = ? AND action = 'disposed'").get(document.id).count, 1);
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
    requiredPermissions: [PERMISSIONS.MANAGE_DOCUMENTS, PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS, PERMISSIONS.MOVE_DOCUMENTS]
  });
  const html = await response.text();

  assert.match(html, /제외문서/);
  assert.match(html, /대장 제외 예정/);
  assert.match(html, /documentName: 이전/);
  assert.match(html, /documentName: 이후/);
  assert.match(html, /name="applyReason"/);
  assert.match(html, /name="confirmedExcludeCount"/);
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
  } finally {
    database.close();
  }
});

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
