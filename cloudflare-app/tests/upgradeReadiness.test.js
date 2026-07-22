import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createUpgradeReadinessReport,
  inspectSqlExport,
  inspectUpgradeReadiness
} from "../scripts/check-upgrade-readiness.mjs";

function readinessDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      document_number TEXT NOT NULL,
      revision_number TEXT NOT NULL,
      sync_state TEXT NOT NULL
    );
  `);
  return database;
}

test("upgrade readiness는 현재 대장의 대소문자 identity 중복을 차단한다", (context) => {
  const database = readinessDatabase();
  context.after(() => database.close());
  database.exec(`
    INSERT INTO documents VALUES (1, 'SOP-QA-1', 'Rev.0', 'current');
    INSERT INTO documents VALUES (2, 'sop-qa-1', 'rev.0', 'current');
  `);

  const result = inspectUpgradeReadiness(database);
  assert.equal(result.ok, false);
  assert.equal(result.checks.currentIdentityDuplicates.count, 1);
  assert.match(result.failures.join(" "), /unique migration/);
});

test("upgrade readiness는 제외 이력의 같은 identity를 중복으로 세지 않는다", (context) => {
  const database = readinessDatabase();
  context.after(() => database.close());
  database.exec(`
    INSERT INTO documents VALUES (1, 'SOP-QA-1', 'Rev.0', 'current');
    INSERT INTO documents VALUES (2, 'sop-qa-1', 'rev.0', 'excluded');
  `);

  const result = inspectUpgradeReadiness(database);
  assert.equal(result.ok, true);
  assert.equal(result.checks.currentIdentityDuplicates.count, 0);
  assert.equal(result.checks.foreignKeys.count, 0);
});

test("upgrade readiness는 D1 SQL export 사본을 메모리 DB에 복원해 검사한다", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "upgrade-readiness-"));
  const sqlPath = join(directory, "d1-export.sql");
  try {
    await writeFile(sqlPath, `
      BEGIN TRANSACTION;
      CREATE TABLE document_tags (
        document_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      );
      INSERT INTO document_tags VALUES (1, 7);
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY,
        document_number TEXT NOT NULL,
        revision_number TEXT NOT NULL,
        sync_state TEXT NOT NULL
      );
      INSERT INTO documents VALUES (1, 'DOC-1', 'Rev.0', 'current');
      CREATE TABLE tags (id INTEGER PRIMARY KEY);
      INSERT INTO tags VALUES (7);
      COMMIT;
    `, "utf8");
    const result = await inspectSqlExport(sqlPath);
    assert.equal(result.ok, true);
    assert.equal(result.checks.currentIdentityDuplicates.count, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("upgrade readiness 보고서는 SQL 복원 오류 원문을 artifact용 결과에서 제거한다", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "upgrade-readiness-error-"));
  const sqlPath = join(directory, "malformed.sql");
  try {
    await writeFile(sqlPath, "INSERT INTO secret_table VALUES ('sensitive-literal');", "utf8");
    const report = await createUpgradeReadinessReport(sqlPath, {
      now: () => new Date("2026-07-22T00:00:00.000Z")
    });
    assert.equal(report.ok, false);
    assert.deepEqual(report.failures, ["D1 export 사본을 복원하거나 검사할 수 없습니다."]);
    assert.doesNotMatch(JSON.stringify(report), /secret_table|sensitive-literal/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
