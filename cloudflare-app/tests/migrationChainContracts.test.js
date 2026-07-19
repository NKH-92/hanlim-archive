import assert from "node:assert/strict";
import test from "node:test";

import { createMigratedDatabase, migrationFiles } from "./helpers/migratedDatabase.js";

const BASELINE_LAST_MIGRATION = 26;

const CORE_TABLES = [
  "app_users",
  "categories",
  "disposal_batch_items",
  "disposal_batches",
  "disposal_logs",
  "document_audit_logs",
  "document_import_items",
  "document_import_jobs",
  "document_movements",
  "document_set_items",
  "document_set_logs",
  "document_sets",
  "document_tags",
  "documents",
  "floor_plan_regions",
  "login_throttle",
  "rack_slots",
  "racks",
  "search_clicks",
  "search_logs",
  "system_audit_logs",
  "tags"
].sort();

const IMMUTABILITY_TRIGGERS = [
  "trg_disposal_logs_no_update",
  "trg_document_audit_logs_no_delete",
  "trg_document_audit_logs_no_update",
  "trg_document_movements_no_delete",
  "trg_document_movements_no_update",
  "trg_document_set_logs_no_delete",
  "trg_document_set_logs_no_update",
  "trg_system_audit_logs_no_delete",
  "trg_system_audit_logs_no_update"
].sort();

test("migration 파일 번호는 0001부터 중복·누락 없이 이어지고 0001~0026 이력을 보존한다", async () => {
  const migrations = await validatedMigrationFiles();
  assert.ok(migrations.length >= BASELINE_LAST_MIGRATION);

  const numbers = migrations.map(({ number }) => number);
  const expected = Array.from({ length: migrations.at(-1).number }, (_, index) => index + 1);
  assert.deepEqual(numbers, expected, "migration 번호는 0001부터 연속이어야 한다");
  assert.deepEqual(
    numbers.slice(0, BASELINE_LAST_MIGRATION),
    Array.from({ length: BASELINE_LAST_MIGRATION }, (_, index) => index + 1),
    "기존 0001~0026 이력은 삭제하거나 번호를 바꿀 수 없다"
  );
});

test("전체 migration을 순차 적용하면 핵심 schema와 FK 무결성이 유지된다", async () => {
  const database = await createMigratedDatabase();

  try {
    assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(({ name }) => name);
    const triggers = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger'
      ORDER BY name
    `).all().map(({ name }) => name);

    assert.equal(tables.length, 22, "핵심 업무 테이블 수");
    assert.deepEqual(tables, CORE_TABLES);
    assert.equal(triggers.length, 9, "감사·이력 불변성 trigger 수");
    assert.deepEqual(triggers, IMMUTABILITY_TRIGGERS);
  } finally {
    database.close();
  }
});

async function validatedMigrationFiles() {
  const migrations = (await migrationFiles()).map(({ name, number }) => {
    const match = name.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
    assert.ok(match, `migration 파일명 형식 오류: ${name}`);
    assert.equal(number, Number(match[1]));
    return { name, number };
  }).sort((left, right) => left.number - right.number || left.name.localeCompare(right.name));

  const duplicateNumbers = migrations
    .filter((migration, index) => index > 0 && migration.number === migrations[index - 1].number)
    .map(({ number }) => String(number).padStart(4, "0"));
  assert.deepEqual(duplicateNumbers, [], "migration 번호 중복");
  return migrations;
}
