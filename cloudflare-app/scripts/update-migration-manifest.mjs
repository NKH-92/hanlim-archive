#!/usr/bin/env node
/**
 * migrations/manifest.json 재생성.
 * 새 migration을 추가한 뒤 checksum과 schema(table/trigger) 목록을 실제 replay 결과로 갱신한다.
 * 과거 migration 파일은 읽기만 하며 released-baseline.json은 이 스크립트가 건드리지 않는다.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { hashMigrationSql } from "./check-migrations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildMigrationManifest(migrationsDir) {
  const names = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const checksums = {};
  const database = new DatabaseSync(":memory:");
  try {
    for (const name of names) {
      const sql = await readFile(join(migrationsDir, name), "utf8");
      checksums[name] = hashMigrationSql(sql);
      try {
        database.exec(sql);
      } catch (error) {
        error.message = `${name}: ${error.message}`;
        throw error;
      }
    }
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
    return { version: 1, checksums, schema: { tables, triggers } };
  } finally {
    database.close();
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const target = process.argv.includes("--search")
    ? join(ROOT, "search-migrations")
    : join(ROOT, "migrations");
  const manifest = await buildMigrationManifest(target);
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `✓ ${target} manifest 갱신: migration ${Object.keys(manifest.checksums).length}개, `
    + `table ${manifest.schema.tables.length}개, trigger ${manifest.schema.triggers.length}개`
  );
}
