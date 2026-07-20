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
    `),
    // 아래 항목은 후보(heuristic)이며 확정 결함이 아니다.
    moveAuditWithoutMovementLog: all(`
      SELECT
        a.id AS audit_id,
        a.document_id,
        a.document_number,
        json_extract(a.details, '$.snapshotCode') AS snapshot_code,
        a.created_at
      FROM document_audit_logs a
      WHERE a.action = 'excel_sync_update'
        AND (
          instr(IFNULL(a.details, ''), '"MOVE"') > 0
          OR json_extract(a.details, '$.before.values.rackSlotId')
             <> json_extract(a.details, '$.after.values.rackSlotId')
          OR json_extract(a.details, '$.before.values.rackFace')
             <> json_extract(a.details, '$.after.values.rackFace')
        )
        AND NOT EXISTS (
          SELECT 1 FROM document_movements m
          WHERE m.document_id = a.document_id
            AND m.reason = json_extract(a.details, '$.applyReason')
        )
      ORDER BY a.id
    `),
    excelRestoreCandidates: all(`
      SELECT
        a.id AS audit_id,
        a.document_id,
        a.document_number,
        json_extract(a.details, '$.snapshotCode') AS snapshot_code,
        json_extract(a.details, '$.before.values.status') AS before_status,
        COALESCE(
          json_extract(a.details, '$.after.values.status'),
          json_extract(a.details, '$.after.status')
        ) AS after_status,
        a.created_at
      FROM document_audit_logs a
      WHERE a.action = 'excel_sync_update'
        AND json_extract(a.details, '$.before.values.status') = 'disposed'
        AND COALESCE(
          json_extract(a.details, '$.after.values.status'),
          json_extract(a.details, '$.after.status')
        ) = 'active'
      ORDER BY a.id
    `),
    snapshotCountMismatchCandidates: all(`
      SELECT
        s.id AS snapshot_id,
        s.snapshot_code,
        s.status,
        s.create_count,
        s.update_count,
        s.exclude_count,
        (
          SELECT COUNT(*) FROM document_audit_logs a
          WHERE a.action = 'excel_sync_create'
            AND json_extract(a.details, '$.snapshotCode') = s.snapshot_code
        ) AS actual_create_audits,
        (
          SELECT COUNT(*) FROM document_audit_logs a
          WHERE a.action = 'excel_sync_update'
            AND json_extract(a.details, '$.snapshotCode') = s.snapshot_code
        ) AS actual_update_audits,
        (
          SELECT COUNT(*) FROM document_audit_logs a
          WHERE a.action = 'excel_sync_exclude'
            AND json_extract(a.details, '$.snapshotCode') = s.snapshot_code
        ) AS actual_exclude_audits
      FROM document_snapshots s
      WHERE s.status = 'completed'
        AND (
          s.create_count <> (
            SELECT COUNT(*) FROM document_audit_logs a
            WHERE a.action = 'excel_sync_create'
              AND json_extract(a.details, '$.snapshotCode') = s.snapshot_code
          )
          OR s.update_count <> (
            SELECT COUNT(*) FROM document_audit_logs a
            WHERE a.action = 'excel_sync_update'
              AND json_extract(a.details, '$.snapshotCode') = s.snapshot_code
          )
          OR s.exclude_count <> (
            SELECT COUNT(*) FROM document_audit_logs a
            WHERE a.action = 'excel_sync_exclude'
              AND json_extract(a.details, '$.snapshotCode') = s.snapshot_code
          )
        )
      ORDER BY s.id
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
