#!/usr/bin/env node
/**
 * 운영 D1 export 사본을 메모리 DB에 복원해 migration 선행조건을 읽기 전용으로 검사한다.
 * 원격 DB를 직접 수정하거나 조회 결과의 업무 데이터를 artifact에 기록하지 않는다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasTable(database, table) {
  return Boolean(database.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table));
}

function hasColumn(database, table, column) {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

export function inspectUpgradeReadiness(database) {
  const failures = [];
  let duplicateGroupCount = 0;
  let foreignKeyViolationCount = 0;

  if (!hasTable(database, "documents")) {
    failures.push("documents 테이블이 없습니다.");
  } else {
    const currentPredicate = hasColumn(database, "documents", "sync_state")
      ? "WHERE sync_state = 'current'"
      : "";
    duplicateGroupCount = Number(database.prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT 1
        FROM documents
        ${currentPredicate}
        GROUP BY UPPER(document_number), UPPER(revision_number)
        HAVING COUNT(*) > 1
      ) duplicates
    `).get()?.count || 0);
    if (duplicateGroupCount > 0) {
      failures.push(`현재 대장 identity 중복 그룹 ${duplicateGroupCount}건이 있어 unique migration을 적용할 수 없습니다.`);
    }
  }

  foreignKeyViolationCount = Number(database.prepare("PRAGMA foreign_key_check").all().length);
  if (foreignKeyViolationCount > 0) {
    failures.push(`foreign key 위반 ${foreignKeyViolationCount}건이 있습니다.`);
  }

  return Object.freeze({
    schemaVersion: 1,
    ok: failures.length === 0,
    checks: {
      currentIdentityDuplicates: { ok: duplicateGroupCount === 0, count: duplicateGroupCount },
      foreignKeys: { ok: foreignKeyViolationCount === 0, count: foreignKeyViolationCount }
    },
    failures
  });
}

export async function inspectSqlExport(sqlExportPath) {
  const sql = await readFile(sqlExportPath, "utf8");
  // Wrangler export는 FK 자식 행을 부모 테이블보다 먼저 기록할 수 있다.
  // 복원 중 enforcement만 끄고, 복원 완료 뒤 foreign_key_check로 무결성을 판정한다.
  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  try {
    database.exec(sql);
    return inspectUpgradeReadiness(database);
  } finally {
    database.close();
  }
}

export async function createUpgradeReadinessReport(sqlExportPath, { now = () => new Date() } = {}) {
  let result;
  try {
    result = await inspectSqlExport(sqlExportPath);
  } catch {
    // SQL 원문 일부가 포함될 수 있는 sqlite 오류 메시지는 CI 로그·artifact에 기록하지 않는다.
    result = {
      schemaVersion: 1,
      ok: false,
      checks: {},
      failures: ["D1 export 사본을 복원하거나 검사할 수 없습니다."]
    };
  }
  return { generatedAt: now().toISOString(), ...result };
}

async function main() {
  const sqlExportPath = argument("--sql-export");
  const outPath = argument("--out");
  if (!sqlExportPath || !outPath) {
    console.error("Usage: node scripts/check-upgrade-readiness.mjs --sql-export <d1-export.sql> --out <report.json>");
    process.exit(2);
  }

  const report = await createUpgradeReadinessReport(resolve(sqlExportPath));
  const resolvedOut = resolve(outPath);
  await mkdir(dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!report.ok) {
    for (const failure of report.failures) console.error(`[upgrade-readiness] ${failure}`);
    process.exit(1);
  }
  console.log("✓ 운영 D1 export migration 선행조건 검사 통과");
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
