import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { clean } from "../../../shared/text/normalize.js";
import { SNAPSHOT_ERROR_CODES, snapshotError } from "../domain/errorCodes.js";
import { isStableRowKey, temporaryStagingRowKey } from "../domain/identity.js";
import { createSnapshotPlan, optionalPositiveInteger } from "./support.js";

export async function stageDocumentSnapshotRows(env, snapshotId, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > FREE_TIER_BUDGET.excelSnapshotStageChunkSize) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH, `한 번에 ${FREE_TIER_BUDGET.excelSnapshotStageChunkSize}행씩 전송해야 합니다.`);
  }
  const normalized = [];
  const seenRows = new Set();
  const seenKeys = new Set();
  for (const entry of rows) {
    const rowNumber = Number(entry?.rowNumber);
    const sourceRowKey = clean(entry?.sourceRowKey ?? entry?.rowKey);
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > FREE_TIER_BUDGET.excelSnapshotMaxItems + 1) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "엑셀 행 번호가 올바르지 않습니다.");
    }
    if (sourceRowKey && !isStableRowKey(sourceRowKey)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `${rowNumber}행의 숨김 관리 ID가 올바르지 않습니다.`);
    }
    if (seenRows.has(rowNumber)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_DUPLICATE, "같은 행 번호가 중복되었습니다.");
    }
    if (sourceRowKey && seenKeys.has(sourceRowKey)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_DUPLICATE, "같은 관리 ID가 중복되었습니다.");
    }
    seenRows.add(rowNumber);
    if (sourceRowKey) seenKeys.add(sourceRowKey);
    const stagingKey = sourceRowKey || temporaryStagingRowKey(snapshotId, rowNumber);
    normalized.push({
      rowNumber,
      rowKey: stagingKey,
      sourceRowKey: sourceRowKey || null,
      source: normalizeSourceRow(entry?.source)
    });
  }

  const payload = JSON.stringify(normalized);
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_snapshot_rows (snapshot_id, row_number, row_key, source_row_key, source_json)
      SELECT
        ?,
        CAST(json_extract(staged.value, '$.rowNumber') AS INTEGER),
        json_extract(staged.value, '$.rowKey'),
        NULLIF(json_extract(staged.value, '$.sourceRowKey'), ''),
        json(json_extract(staged.value, '$.source'))
      FROM json_each(?) staged
      WHERE EXISTS (
        SELECT 1 FROM document_snapshots
        WHERE id = ? AND status = 'staging'
      )
      ON CONFLICT(snapshot_id, row_number) DO UPDATE SET
        row_key = excluded.row_key,
        source_row_key = excluded.source_row_key,
        source_json = excluded.source_json,
        normalized_json = NULL,
        before_json = NULL,
        after_json = NULL,
        changed_fields_json = NULL,
        change_flags_json = NULL,
        expected_row_version = NULL,
        action = 'staged',
        matched_document_id = NULL
    `).bind(snapshotId, payload, snapshotId),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET staged_count = (SELECT COUNT(*) FROM document_snapshot_rows WHERE snapshot_id = ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'staging'
      RETURNING staged_count, total_count
    `).bind(snapshotId, snapshotId)
  ];
  const results = await executeMutationBatch(env, createSnapshotPlan("stage", statements));
  const progress = results[1]?.results?.[0];
  if (!progress) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "행을 추가할 수 없는 동기화 작업입니다.");
  return { ok: true, stagedCount: Number(progress.staged_count || 0), totalCount: Number(progress.total_count || 0) };
}

export async function stageDocumentSnapshotMembership(env, snapshotId, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > FREE_TIER_BUDGET.excelSnapshotMembershipChunkSize) {
    return snapshotError(
      SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH,
      `membership은 한 번에 ${FREE_TIER_BUDGET.excelSnapshotMembershipChunkSize}행까지 전송할 수 있습니다.`
    );
  }
  const normalized = [];
  const seenRows = new Set();
  const seenKeys = new Set();
  for (const entry of rows) {
    const rowNumber = Number(entry?.rowNumber);
    const rowKey = clean(entry?.rowKey ?? entry?.sourceRowKey);
    const baseRowVersion = optionalPositiveInteger(entry?.baseRowVersion);
    const baseHash = clean(entry?.baseHash).toLowerCase();
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > FREE_TIER_BUDGET.excelSnapshotMaxItems + 1) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "membership 행 번호가 올바르지 않습니다.");
    }
    if (!rowKey || !isStableRowKey(rowKey)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `${rowNumber}행의 숨김 관리 ID가 올바르지 않습니다.`);
    }
    if (baseHash && !/^[a-f0-9]{64}$/.test(baseHash)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `${rowNumber}행의 기준 행 해시가 올바르지 않습니다.`);
    }
    if (seenRows.has(rowNumber) || seenKeys.has(rowKey)) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_DUPLICATE, "membership 행 번호 또는 관리 ID가 중복되었습니다.");
    }
    seenRows.add(rowNumber);
    seenKeys.add(rowKey);
    normalized.push({ rowNumber, rowKey, baseRowVersion, baseHash: baseHash || null });
  }
  const payload = JSON.stringify(normalized);
  const results = await executeMutationBatch(env, createSnapshotPlan("membership", [
    env.DB.prepare(`
      INSERT INTO document_snapshot_membership (
        snapshot_id, row_number, row_key, base_row_version, base_hash
      )
      SELECT
        ?,
        CAST(json_extract(item.value, '$.rowNumber') AS INTEGER),
        json_extract(item.value, '$.rowKey'),
        CAST(json_extract(item.value, '$.baseRowVersion') AS INTEGER),
        NULLIF(json_extract(item.value, '$.baseHash'), '')
      FROM json_each(?) item
      WHERE EXISTS (
        SELECT 1 FROM document_snapshots
        WHERE id = ? AND status = 'staging' AND schema_version = 2
      )
      ON CONFLICT(snapshot_id, row_number) DO UPDATE SET
        row_key = excluded.row_key,
        base_row_version = excluded.base_row_version,
        base_hash = excluded.base_hash
    `).bind(snapshotId, payload, snapshotId),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'staging' AND schema_version = 2
      RETURNING (
        SELECT COUNT(*) FROM document_snapshot_membership WHERE snapshot_id = ?
      ) AS membership_count
    `).bind(snapshotId, snapshotId)
  ]));
  const count = Number(results[1]?.results?.[0]?.membership_count || 0);
  if (!count) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_STATE, "membership을 추가할 수 없는 동기화 작업입니다.");
  return { ok: true, membershipCount: count };
}

function normalizeSourceRow(source = {}) {
  return {
    documentNumber: clean(source.documentNumber),
    revisionNumber: clean(source.revisionNumber),
    revisionDate: clean(source.revisionDate),
    disposalDueYear: clean(source.disposalDueYear),
    documentName: clean(source.documentName),
    category: clean(source.category),
    rackNumber: clean(source.rackNumber || source.rackCode),
    rackColumn: clean(source.rackColumn),
    shelfNumber: clean(source.shelfNumber),
    rackFace: clean(source.rackFace),
    tags: clean(source.tags),
    note: clean(source.note),
    status: clean(source.status)
  };
}
