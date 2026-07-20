#!/usr/bin/env node
/**
 * 엑셀 대장 동기화 데이터 감사(read-only).
 * production 원본이 아니라 D1 export/backup 사본 DB 파일에 대해 실행한다.
 *
 * 사용:
 *   node scripts/audit-excel-snapshot-data.mjs --db path/to/backup.sqlite --out reports/excel-snapshot-audit.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

const dbPath = arg("--db");
const outPath = arg("--out", "reports/excel-snapshot-audit.json");
if (!dbPath) {
  console.error("Usage: node scripts/audit-excel-snapshot-data.mjs --db <sqlite-file> [--out report.json]");
  process.exit(2);
}

const database = new DatabaseSync(dbPath, { readOnly: true });

function all(sql) {
  return database.prepare(sql).all();
}

const report = {
  generatedAt: new Date().toISOString(),
  dbPath,
  findings: {
    currentIdentityDuplicates: all(`
      SELECT
        UPPER(document_number) AS document_number_key,
        UPPER(revision_number) AS revision_key,
        COUNT(*) AS current_count,
        GROUP_CONCAT(id) AS document_ids
      FROM documents
      WHERE sync_state = 'current'
      GROUP BY UPPER(document_number), UPPER(revision_number)
      HAVING COUNT(*) > 1
    `),
    updateAndExcludeSameSnapshot: all(`
      WITH sync_logs AS (
        SELECT
          id,
          document_id,
          action,
          json_extract(details, '$.snapshotCode') AS snapshot_code
        FROM document_audit_logs
        WHERE action IN ('excel_sync_update', 'excel_sync_exclude')
      )
      SELECT
        snapshot_code,
        document_id,
        GROUP_CONCAT(id) AS audit_log_ids
      FROM sync_logs
      WHERE snapshot_code IS NOT NULL
      GROUP BY snapshot_code, document_id
      HAVING COUNT(DISTINCT action) = 2
    `),
    dateMinusOneDayCandidates: all(`
      SELECT
        id AS audit_id,
        document_id,
        document_number,
        json_extract(details, '$.snapshotCode') AS snapshot_code,
        json_extract(details, '$.before.revisionDate') AS before_date,
        COALESCE(
          json_extract(details, '$.after.values.revisionDate'),
          json_extract(details, '$.after.revisionDate')
        ) AS after_date
      FROM document_audit_logs
      WHERE action = 'excel_sync_update'
        AND julianday(json_extract(details, '$.before.revisionDate'))
            - julianday(COALESCE(
              json_extract(details, '$.after.values.revisionDate'),
              json_extract(details, '$.after.revisionDate')
            )) = 1
    `),
    excludedDocumentsInSets: all(`
      SELECT
        s.id AS set_id,
        s.name AS set_name,
        d.id AS document_id,
        d.document_number,
        d.revision_number,
        d.status,
        d.last_snapshot_id
      FROM document_set_items i
      JOIN document_sets s ON s.id = i.set_id
      JOIN documents d ON d.id = i.document_id
      WHERE d.sync_state = 'excluded'
      ORDER BY s.id, d.document_number, d.revision_number
    `),
    abandonedSnapshots: all(`
      SELECT id, snapshot_code, status, created_at, updated_at, total_count, staged_count
      FROM document_snapshots
      WHERE status IN ('staging', 'ready')
      ORDER BY created_at
    `)
  }
};

report.summary = Object.fromEntries(
  Object.entries(report.findings).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])
);

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
database.close();
console.log(`Wrote ${outPath}`);
console.log(JSON.stringify(report.summary, null, 2));
