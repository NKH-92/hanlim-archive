#!/usr/bin/env node
/**
 * Migration checksum / schema / released-baseline immutability gate.
 * Past migrations listed in released-baseline.json must keep their canonical LF hash.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function canonicalizeMigrationSql(sql) {
  return String(sql ?? "").replace(/\r\n/g, "\n");
}

export function hashMigrationSql(sql) {
  return createHash("sha256").update(canonicalizeMigrationSql(sql)).digest("hex");
}

/**
 * @param {{
 *   migrationsDir?: string,
 *   manifest?: object,
 *   baseline?: object|null,
 *   applySchema?: boolean
 * }} [options]
 */
export async function verifyMigrationChain({
  migrationsDir,
  manifest,
  baseline,
  applySchema = true
} = {}) {
  const root = migrationsDir || join(DEFAULT_ROOT, "migrations");
  const resolvedManifest = manifest || JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

  let baselineDoc = baseline;
  let baselineLoadError = null;
  if (baseline === undefined) {
    try {
      baselineDoc = JSON.parse(await readFile(join(root, "released-baseline.json"), "utf8"));
    } catch (error) {
      baselineDoc = null;
      baselineLoadError = error;
    }
  }

  const names = (await readdir(root))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const expectedNumbers = Array.from({ length: names.length }, (_, index) => String(index + 1).padStart(4, "0"));
  const actualNumbers = names.map((name) => name.slice(0, 4));
  const errors = [];

  if (baselineLoadError) {
    errors.push(`released-baseline.json을 읽을 수 없습니다: ${baselineLoadError.message}`);
  }
  if (!baselineDoc || baselineDoc.version !== 1 || !baselineDoc.checksums || typeof baselineDoc.checksums !== "object") {
    errors.push("released-baseline.json은 version 1과 비어 있지 않은 checksums를 반드시 포함해야 합니다.");
  } else {
    const baselineNames = Object.keys(baselineDoc.checksums);
    if (!baselineNames.length) {
      errors.push("released-baseline.json checksums는 비어 있을 수 없습니다.");
    } else if (JSON.stringify(baselineNames) !== JSON.stringify(names.slice(0, baselineNames.length))) {
      errors.push("released-baseline migration은 0001부터 현재 이력의 연속된 prefix여야 합니다.");
    }
    if (typeof baselineDoc.releasedThrough !== "string" || !baselineDoc.releasedThrough) {
      errors.push("released-baseline.json must declare releasedThrough.");
    } else if (baselineDoc.releasedThrough !== baselineNames.at(-1)) {
      errors.push("released-baseline.json releasedThrough must match the final checksum entry.");
    }
  }

  if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
    errors.push("migration 번호는 0001부터 중복·누락 없이 이어져야 합니다.");
  }
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(resolvedManifest.checksums || {}))) {
    errors.push("migration manifest의 파일 목록이 실제 파일과 다릅니다.");
  }

  const fileHashes = {};
  for (const name of names) {
    const sql = await readFile(join(root, name), "utf8");
    const checksum = hashMigrationSql(sql);
    fileHashes[name] = checksum;
    if (checksum !== resolvedManifest.checksums?.[name]) {
      errors.push(`${name}: checksum 불일치 (manifest)`);
    }
  }

  if (baselineDoc?.checksums && typeof baselineDoc.checksums === "object") {
    for (const [name, expected] of Object.entries(baselineDoc.checksums)) {
      if (!fileHashes[name]) {
        errors.push(`${name}: released baseline에 있으나 파일이 삭제·개명되었습니다.`);
        continue;
      }
      if (fileHashes[name] !== expected) {
        errors.push(`${name}: released baseline checksum 불일치 (과거 migration 변조)`);
      }
      if (resolvedManifest.checksums?.[name] && resolvedManifest.checksums[name] !== expected) {
        errors.push(`${name}: manifest checksum이 released baseline과 함께 변조되었습니다.`);
      }
    }
  }

  if (errors.length) {
    return { ok: false, errors, names, fileHashes };
  }

  if (!applySchema) {
    return { ok: true, errors: [], names, fileHashes };
  }

  const database = new DatabaseSync(":memory:");
  try {
    for (const name of names) {
      const sql = await readFile(join(root, name), "utf8");
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
    const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();

    if (JSON.stringify(tables) !== JSON.stringify(resolvedManifest.schema.tables)) {
      return { ok: false, errors: ["table manifest 불일치"], names, fileHashes };
    }
    if (JSON.stringify(triggers) !== JSON.stringify(resolvedManifest.schema.triggers)) {
      return { ok: false, errors: ["trigger manifest 불일치"], names, fileHashes };
    }
    if (foreignKeyErrors.length) {
      return { ok: false, errors: [`foreign key 위반 ${foreignKeyErrors.length}건`], names, fileHashes };
    }
  } finally {
    database.close();
  }

  return { ok: true, errors: [], names, fileHashes };
}

export async function verifySearchMigrationChain({
  migrationsDir = join(DEFAULT_ROOT, "search-migrations"),
  applySchema = true
} = {}) {
  const manifest = JSON.parse(await readFile(join(migrationsDir, "manifest.json"), "utf8"));
  const names = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const expectedNumbers = Array.from({ length: names.length }, (_, index) => String(index + 1).padStart(4, "0"));
  const errors = [];
  if (JSON.stringify(names.map((name) => name.slice(0, 4))) !== JSON.stringify(expectedNumbers)) {
    errors.push("Search D1 migration 번호는 0001부터 연속이어야 합니다.");
  }
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.checksums || {}))) {
    errors.push("Search D1 migration manifest의 파일 목록이 실제 파일과 다릅니다.");
  }
  for (const name of names) {
    const checksum = hashMigrationSql(await readFile(join(migrationsDir, name), "utf8"));
    if (checksum !== manifest.checksums?.[name]) errors.push(`${name}: Search D1 checksum 불일치`);
  }
  if (errors.length || !applySchema) return { ok: errors.length === 0, errors, names };

  const database = new DatabaseSync(":memory:");
  try {
    for (const name of names) database.exec(await readFile(join(migrationsDir, name), "utf8"));
    const requiredTables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type IN ('table', 'view')
        AND name IN ('search_documents', 'search_documents_fts', 'search_runtime_state')
      ORDER BY name
    `).all().map(({ name }) => name);
    if (JSON.stringify(requiredTables) !== JSON.stringify(manifest.schema.tables)) {
      errors.push("Search D1 핵심 schema manifest 불일치");
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      errors.push("Search D1 foreign key 위반");
    }
  } finally {
    database.close();
  }
  return { ok: errors.length === 0, errors, names };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [result, searchResult] = await Promise.all([
    verifyMigrationChain(),
    verifySearchMigrationChain()
  ]);
  if (!result.ok || !searchResult.ok) {
    for (const error of [...result.errors, ...searchResult.errors]) console.error(`[migrations] ${error}`);
    process.exit(1);
  }
  console.log(`✓ Core migration ${result.names.length}개 + Search migration ${searchResult.names.length}개 checksum·schema·FK 검사 통과`);
}
