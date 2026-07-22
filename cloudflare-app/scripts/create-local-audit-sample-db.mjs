#!/usr/bin/env node
/**
 * 로컬/샘플 SQLite에 migration을 적용해 read-only 감사 스크립트 입력으로 쓴다.
 * production D1에는 연결하지 않는다.
 */
import { mkdirSync, unlinkSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const outPath = process.argv[2] || "reports/excel-snapshot-audit/local-sample.sqlite";
const absolute = path.resolve(outPath);
mkdirSync(path.dirname(absolute), { recursive: true });
try {
  unlinkSync(absolute);
} catch {
  // ignore missing file
}

const migrationsDir = new URL("../migrations/", import.meta.url);
const names = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
const database = new DatabaseSync(absolute);
try {
  for (const name of names) {
    const sql = await readFile(new URL(name, migrationsDir), "utf8");
    database.exec(sql);
  }
} finally {
  database.close();
}

console.log(`local audit sample db: ${absolute}`);
console.log(`cwd-relative: ${path.relative(process.cwd(), absolute) || outPath}`);
console.log(`migrations: ${names.length}`);
console.log(`script: ${fileURLToPath(import.meta.url)}`);
