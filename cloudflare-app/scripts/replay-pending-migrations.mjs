#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const APP_ROOT = path.resolve(import.meta.dirname, "..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function appliedMigrationNames(database) {
  const table = database.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'd1_migrations'
  `).get();
  if (!table) throw new Error("D1 export does not contain d1_migrations.");
  return database.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((row) => row.name);
}

function assertAppliedPrefix(applied, migrationNames, label) {
  if (applied.length > migrationNames.length) {
    throw new Error(`${label} has more applied migrations than the local manifest.`);
  }
  for (let index = 0; index < applied.length; index += 1) {
    if (applied[index] !== migrationNames[index]) {
      throw new Error(`${label} migration history is not an exact local-manifest prefix at position ${index + 1}.`);
    }
  }
}

export async function replayMigrationExport({
  sqlExportPath,
  migrationsDir,
  manifestPath,
  label
}) {
  const [exportSql, manifestText] = await Promise.all([
    readFile(sqlExportPath, "utf8"),
    readFile(manifestPath, "utf8")
  ]);
  const manifest = JSON.parse(manifestText);
  const migrationNames = Object.keys(manifest.checksums || {});
  if (!migrationNames.length) throw new Error(`${label} migration manifest is empty.`);

  const migrationSql = new Map();
  for (const name of migrationNames) {
    const sql = await readFile(path.join(migrationsDir, name), "utf8");
    if (sha256(sql) !== manifest.checksums[name]) {
      throw new Error(`${label} migration checksum mismatch: ${name}`);
    }
    migrationSql.set(name, sql);
  }

  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    database.exec(exportSql);
    const appliedBefore = appliedMigrationNames(database);
    assertAppliedPrefix(appliedBefore, migrationNames, label);
    const pending = migrationNames.slice(appliedBefore.length);

    for (const name of pending) {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migrationSql.get(name));
        database.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw new Error(`${label} pending migration replay failed at ${name}: ${error.message}`);
      }
    }

    const appliedAfter = appliedMigrationNames(database);
    assertAppliedPrefix(appliedAfter, migrationNames, label);
    if (appliedAfter.length !== migrationNames.length) {
      throw new Error(`${label} replay did not reach the local manifest head.`);
    }
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length) {
      throw new Error(`${label} replay produced ${foreignKeyViolations.length} foreign-key violation(s).`);
    }

    return Object.freeze({
      label,
      appliedBefore: appliedBefore.length,
      pendingReplayed: pending,
      appliedAfter: appliedAfter.length,
      latestMigration: migrationNames.at(-1),
      foreignKeyViolations: 0
    });
  } finally {
    database.close();
  }
}

export async function replayProductionExports({
  coreExport,
  searchExport,
  appRoot = APP_ROOT
}) {
  const [core, search] = await Promise.all([
    replayMigrationExport({
      sqlExportPath: coreExport,
      migrationsDir: path.join(appRoot, "migrations"),
      manifestPath: path.join(appRoot, "migrations", "manifest.json"),
      label: "core"
    }),
    replayMigrationExport({
      sqlExportPath: searchExport,
      migrationsDir: path.join(appRoot, "search-migrations"),
      manifestPath: path.join(appRoot, "search-migrations", "manifest.json"),
      label: "search"
    })
  ]);
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: true,
    databases: { core, search }
  });
}

async function main() {
  const coreExport = argument("--core-export");
  const searchExport = argument("--search-export");
  const outPath = argument("--out");
  if (!coreExport || !searchExport || !outPath) {
    console.error("Usage: replay-pending-migrations.mjs --core-export <sql> --search-export <sql> --out <json>");
    process.exit(2);
  }
  try {
    const report = await replayProductionExports({
      coreExport: path.resolve(coreExport),
      searchExport: path.resolve(searchExport)
    });
    const resolvedOut = path.resolve(outPath);
    await mkdir(path.dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      action: "pending-migration-replay",
      corePending: report.databases.core.pendingReplayed.length,
      searchPending: report.databases.search.pendingReplayed.length
    }));
  } catch (error) {
    console.error(`[migration-replay] ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
