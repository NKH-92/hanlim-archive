import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS_URL = new URL("../migrations/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("../migrations/manifest.json", import.meta.url), "utf8"));
const names = (await readdir(MIGRATIONS_URL)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const expectedNumbers = Array.from({ length: names.length }, (_, index) => String(index + 1).padStart(4, "0"));
const actualNumbers = names.map((name) => name.slice(0, 4));

if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
  throw new Error("migration 번호는 0001부터 중복·누락 없이 이어져야 합니다.");
}
if (JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.checksums))) {
  throw new Error("migration manifest의 파일 목록이 실제 파일과 다릅니다.");
}

const database = new DatabaseSync(":memory:");
try {
  for (const name of names) {
    const sql = await readFile(new URL(name, MIGRATIONS_URL), "utf8");
    // Git checkout의 OS별 줄바꿈 변환과 무관하게 같은 migration으로 판정한다.
    const normalizedSql = sql.replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(normalizedSql).digest("hex");
    if (checksum !== manifest.checksums[name]) throw new Error(`${name}: checksum 불일치`);
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

  if (JSON.stringify(tables) !== JSON.stringify(manifest.schema.tables)) throw new Error("table manifest 불일치");
  if (JSON.stringify(triggers) !== JSON.stringify(manifest.schema.triggers)) throw new Error("trigger manifest 불일치");
  if (foreignKeyErrors.length) throw new Error(`foreign key 위반 ${foreignKeyErrors.length}건`);
} finally {
  database.close();
}

console.log(`✓ migration ${names.length}개 checksum·schema·FK 검사 통과`);
