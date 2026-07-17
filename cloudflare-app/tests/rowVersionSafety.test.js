import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { optimisticLockClause } from "../src/data/sqlShared.js";

test("0026은 같은 초의 문서 변경도 구분하는 단조 증가 버전을 추가한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE disposal_batch_items (
      id INTEGER PRIMARY KEY,
      expected_updated_at TEXT NOT NULL
    );
  `);
  db.exec(fs.readFileSync(new URL("../migrations/0026_document_row_version.sql", import.meta.url), "utf8"));
  db.exec("INSERT INTO documents (id) VALUES (1)");

  const before = db.prepare("SELECT updated_at, row_version FROM documents WHERE id = 1").get();
  db.exec("UPDATE documents SET row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1");
  const after = db.prepare("SELECT updated_at, row_version FROM documents WHERE id = 1").get();

  assert.equal(after.updated_at, before.updated_at, "SQLite 초 단위 timestamp 충돌을 재현한다");
  assert.equal(after.row_version, before.row_version + 1, "버전은 같은 초에도 반드시 증가한다");

  db.prepare(`
    INSERT INTO disposal_batch_items (id, expected_updated_at, expected_document_version)
    VALUES (1, ?, ?)
  `).run(before.updated_at, before.row_version);
  const stillMatches = db.prepare(`
    SELECT COUNT(*) AS count
    FROM documents d
    JOIN disposal_batch_items i ON i.id = d.id
    WHERE d.updated_at = i.expected_updated_at
      AND d.row_version = i.expected_document_version
  `).get();
  assert.equal(stillMatches.count, 0, "동결 뒤 같은 초의 변경도 폐기 대상에서 제외한다");
});

test("낙관적 잠금 절은 timestamp와 row_version을 함께 검사한다", () => {
  const lock = optimisticLockClause("2026-07-17 12:00:00", 7);
  assert.equal(lock.sql, " AND updated_at = ? AND row_version = ?");
  assert.deepEqual(lock.binds, ["2026-07-17 12:00:00", 7]);
});
