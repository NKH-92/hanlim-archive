import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { loadDocumentFormOptions } from "../src/domains/documents/index.js";
import {
  applyDocumentSnapshot,
  cancelDocumentSnapshot,
  createDocumentSnapshot,
  getDocumentSyncState,
  prepareDocumentSnapshot,
  stageDocumentSnapshotRows
} from "../src/domains/snapshots/index.js";
import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";
import { actorFixture } from "./helpers/fixtures.js";
import { createMigratedDatabase, migrationFiles, MIGRATIONS_URL } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

const BOOTSTRAP_CONFIRMATION = "BOOTSTRAP";
const execFileAsync = promisify(execFile);

test("bootstrap은 입력 확인문구와 backup 확인을 서버에서 요구한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    const result = await createDocumentSnapshot(env, {
      sourceName: "bootstrap.xlsx",
      sourceHash: "1".repeat(64),
      sourceSize: 1024,
      totalCount: 1,
      schemaVersion: 1,
      mode: "bootstrap"
    }, actorFixture());
    assert.equal(result.ok, false);
    assert.equal(result.code, "SNAPSHOT_BOOTSTRAP_CONFIRMATION_REQUIRED");
  } finally {
    database.close();
  }
});

test("업로드 원본 크기가 예산을 넘으면 staging 생성 전에 거부한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    const result = await createDocumentSnapshot(env, {
      sourceName: "oversized.xlsx",
      sourceHash: "2".repeat(64),
      sourceSize: FREE_TIER_BUDGET.excelSnapshotMaxFileBytes + 1,
      totalCount: 1,
      schemaVersion: 1,
      mode: "bootstrap",
      bootstrapConfirmation: BOOTSTRAP_CONFIRMATION,
      backupConfirmed: true
    }, actorFixture());
    assert.equal(result.ok, false);
    assert.equal(result.code, "SNAPSHOT_FILE_TOO_LARGE");
  } finally {
    database.close();
  }
});

test("방치 staging/ready 작업은 문서를 바꾸지 않고 감사 후 cancelled로 정리한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  const actor = actorFixture();
  try {
    const beforeDocuments = database.prepare("SELECT COUNT(*) AS count FROM documents").get().count;
    const created = await createDocumentSnapshot(env, {
      sourceName: "abandoned.xlsx",
      sourceHash: "7".repeat(64),
      sourceSize: 1024,
      totalCount: 1,
      schemaVersion: 1,
      mode: "bootstrap",
      bootstrapConfirmation: BOOTSTRAP_CONFIRMATION,
      backupConfirmed: true
    }, actor);
    assert.equal(created.ok, true, created.message);
    const cancelled = await cancelDocumentSnapshot(env, created.id, actor);
    assert.equal(cancelled.ok, true, cancelled.message);
    assert.equal(cancelled.snapshot.status, "cancelled");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents").get().count, beforeDocuments);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'document_snapshot' AND entity_id = ? AND action = 'cancel'").get(String(created.id)).count, 1);
    const again = await cancelDocumentSnapshot(env, created.id, actor);
    assert.equal(again.alreadyCancelled, true);
  } finally {
    database.close();
  }
});

test("managed mode는 현재 상태와 다른 snapshot ID와 미발급 manifest를 거부한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database) };
  try {
    const state = await getDocumentSyncState(env);
    const mismatched = await createDocumentSnapshot(env, {
      sourceName: "forged.xlsx",
      sourceHash: "3".repeat(64),
      sourceSize: 1024,
      totalCount: 1,
      schemaVersion: 1,
      mode: "managed",
      baseVersion: state.currentVersion,
      currentSnapshotId: 999999
    }, actorFixture());
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.code, "SNAPSHOT_EXPORT_PROVENANCE_INVALID");

    const forgedManifest = await createDocumentSnapshot(env, {
      sourceName: "forged-manifest.xlsx",
      sourceHash: "4".repeat(64),
      sourceSize: 1024,
      totalCount: 1,
      schemaVersion: 1,
      mode: "managed",
      baseVersion: state.currentVersion,
      exportManifestId: "EXP-NOT-ISSUED"
    }, actorFixture());
    assert.equal(forgedManifest.ok, false);
    assert.equal(forgedManifest.code, "SNAPSHOT_EXPORT_PROVENANCE_INVALID");
  } finally {
    database.close();
  }
});

test("대량 변경 임계값 미만의 identity-only 변경도 승인 참조를 요구한다", async () => {
  const database = await createMigratedDatabase();
  const env = { DB: sqliteD1(database), EXCEL_SNAPSHOT_APPLY_MODE: "admin-only" };
  const actor = actorFixture();
  try {
    const firstRows = Array.from({ length: 20 }, (_, index) => snapshotRow(index + 2, `IDENTITY-${index + 1}`));
    const initial = await createPrepared(env, actor, firstRows, {
      sourceHash: "5".repeat(64),
      mode: "bootstrap"
    });
    const initialApplied = await applyDocumentSnapshot(env, initial.snapshot.id, actor, {
      applyReason: "identity 승인 테스트 기준 대장 생성",
      approvalReference: "BASE-1",
      confirmedExcludeCount: Number(initial.snapshot.exclude_count || 0),
      confirmExclude: true,
      ...reviewConfirmation(initial.snapshot)
    });
    assert.equal(initialApplied.ok, true, initialApplied.message);

    const documents = database.prepare(`
      SELECT excel_row_key, document_number
      FROM documents
      WHERE sync_state = 'current' AND document_number LIKE 'IDENTITY-%'
      ORDER BY document_number
    `).all();
    const state = await getDocumentSyncState(env);
    const changedRows = documents.map((document, index) => snapshotRow(
      index + 2,
      index === 0 ? `${document.document_number}-RENAMED` : document.document_number,
      document.excel_row_key
    ));
    const changed = await createPrepared(env, actor, changedRows, {
      sourceHash: "6".repeat(64),
      mode: "managed",
      baseVersion: state.currentVersion,
      currentSnapshotId: state.currentSnapshotId
    });
    assert.equal(Number(changed.snapshot.identity_change_count), 1);
    const applied = await applyDocumentSnapshot(env, changed.snapshot.id, actor, {
      applyReason: "문서번호 identity 변경 검증",
      approvalReference: "",
      confirmedExcludeCount: 0,
      confirmExclude: true,
      ...reviewConfirmation(changed.snapshot)
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.code, "SNAPSHOT_APPROVAL_REFERENCE_REQUIRED");
  } finally {
    database.close();
  }
});

function reviewConfirmation(snapshot) {
  return {
    confirmReview: true,
    confirmedReviewCount: Number(snapshot.create_count || 0) + Number(snapshot.update_count || 0) + Number(snapshot.exclude_count || 0)
  };
}

test("audit 날짜 후보 SQL은 현재 before.values 구조와 legacy 구조를 함께 읽는다", async () => {
  const source = await readFile(new URL("../scripts/audit-excel-snapshot-data.mjs", import.meta.url), "utf8");
  assert.match(source, /\$\.before\.values\.revisionDate/);
  assert.match(source, /COALESCE\([\s\S]*\$\.before\.values\.revisionDate[\s\S]*\$\.before\.revisionDate/);

  const directory = await mkdtemp(path.join(tmpdir(), "hanlim-excel-audit-"));
  const databasePath = path.join(directory, "audit.sqlite");
  const reportPath = path.join(directory, "report.json");
  const database = new DatabaseSync(databasePath);
  try {
    for (const migration of await migrationFiles()) {
      database.exec(await readFile(new URL(migration.name, MIGRATIONS_URL), "utf8"));
    }
    const document = database.prepare("SELECT id, storage_code, document_number FROM documents ORDER BY id LIMIT 1").get();
    database.prepare(`
      INSERT INTO document_audit_logs (
        document_id, storage_code, document_number, action, actor, actor_role, summary, details
      ) VALUES (?, ?, ?, 'excel_sync_update', '감사 테스트', 'Admin', '날짜 하루 감소 후보', ?)
    `).run(document.id, document.storage_code, document.document_number, JSON.stringify({
      snapshotCode: "SNP-AUDIT-DATE",
      before: { schemaVersion: 1, values: { revisionDate: "2026-07-20" } },
      after: { schemaVersion: 1, values: { revisionDate: "2026-07-19" } }
    }));
    database.prepare(`
      INSERT INTO document_snapshots (
        snapshot_code, source_name, source_hash, schema_version, base_version,
        status, total_count, created_by_name, created_at, updated_at
      ) VALUES ('SNP-OLD-STAGING', 'old.xlsx', ?, 1, 1, 'staging', 1, 'test', '2026-06-01', '2026-06-01')
    `).run("a".repeat(64));
  } finally {
    database.close();
  }
  try {
    await execFileAsync(process.execPath, [
      fileURLToPath(new URL("../scripts/audit-excel-snapshot-data.mjs", import.meta.url)),
      "--db", databasePath,
      "--out", reportPath,
      "--abandoned-days", "7"
    ]);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.findings.dateMinusOneDayCandidates.length, 1);
    assert.equal(report.findings.dateMinusOneDayCandidates[0].before_date, "2026-07-20");
    assert.ok(report.findings.abandonedSnapshots.some((snapshot) => snapshot.snapshot_code === "SNP-OLD-STAGING"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("브라우저 업로드는 arrayBuffer 전에 파일 크기를 검사하고 ZIP 비압축 예산을 전달한다", async () => {
  const source = await readFile(new URL("../src/views/clientScript/excelSnapshots.js", import.meta.url), "utf8");
  const sizeCheck = source.indexOf("file.size");
  const arrayBufferRead = source.indexOf("file.arrayBuffer");
  assert.ok(sizeCheck >= 0 && sizeCheck < arrayBufferRead);
  assert.match(source, /excelSnapshotMaxZipUncompressedBytes/);
});

async function createPrepared(env, actor, rows, options) {
  const created = await createDocumentSnapshot(env, {
    sourceName: "completion.xlsx",
    sourceHash: options.sourceHash,
    sourceSize: 4096,
    totalCount: rows.length,
    schemaVersion: 1,
    mode: options.mode,
    baseVersion: options.baseVersion || "",
    currentSnapshotId: options.currentSnapshotId || "",
    hasRowKeys: options.mode === "managed",
    bootstrapConfirmation: BOOTSTRAP_CONFIRMATION,
    backupConfirmed: true
  }, actor);
  assert.equal(created.ok, true, created.message);
  for (let index = 0; index < rows.length; index += FREE_TIER_BUDGET.excelSnapshotStageChunkSize) {
    const staged = await stageDocumentSnapshotRows(env, created.id, rows.slice(index, index + FREE_TIER_BUDGET.excelSnapshotStageChunkSize));
    assert.equal(staged.ok, true, staged.message);
  }
  const prepared = await prepareDocumentSnapshot(env, created.id, await loadDocumentFormOptions(env, { activeOnly: true }), null, actor);
  assert.equal(prepared.ok, true, prepared.message);
  return prepared;
}

function snapshotRow(rowNumber, documentNumber, sourceRowKey = "") {
  return {
    rowNumber,
    sourceRowKey,
    source: {
      documentNumber,
      revisionNumber: "Rev.0",
      revisionDate: "2026-07-20",
      disposalDueYear: "2031",
      documentName: `무결성 검증 ${documentNumber}`,
      category: "PV",
      rackNumber: "1",
      rackColumn: String((rowNumber - 2) % 7 + 1),
      shelfNumber: String((rowNumber - 2) % 6 + 1),
      rackFace: "단면",
      tags: "중요문서",
      note: "",
      status: "보관중"
    }
  };
}
