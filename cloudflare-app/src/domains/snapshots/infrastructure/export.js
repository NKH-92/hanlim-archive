import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { clean } from "../../../shared/text/normalize.js";
import { auditActorSnapshot } from "../../identity/index.js";
import { SNAPSHOT_ERROR_CODES, snapshotError } from "../domain/errorCodes.js";
import {
  computeExportManifestHash,
  computeExportPageChainHash
} from "../domain/hash.js";
import { getDocumentSyncState } from "./queries.js";

export async function createDocumentSnapshotExport(env, actor = {}, attempt = 0) {
  const stateBefore = await getDocumentSyncState(env);
  const [countResult, categoryResult, tagResult, rackResult] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").first(),
    env.DB.prepare("SELECT name FROM categories WHERE is_active = 1 ORDER BY sort_order, name").all(),
    env.DB.prepare("SELECT name FROM tags WHERE is_active = 1 ORDER BY name").all(),
    env.DB.prepare("SELECT rack_number, code, is_single_sided FROM racks WHERE is_active = 1 ORDER BY zone_number, rack_number").all()
  ]);
  const state = await getDocumentSyncState(env);
  if (
    state.currentVersion !== stateBefore.currentVersion ||
    state.currentSnapshotId !== stateBefore.currentSnapshotId
  ) {
    if (attempt >= 1) throw new Error("엑셀 추출 중 문서고가 계속 변경되어 일관된 export를 만들 수 없습니다.");
    return createDocumentSnapshotExport(env, actor, attempt + 1);
  }

  const documentCount = Number(countResult?.count || 0);
  const exportManifestId = `EXP-${crypto.randomUUID()}`;
  const actorSnapshot = auditActorSnapshot(actor);
  const persisted = await env.DB.prepare(`
    INSERT INTO document_snapshot_export_manifests (
      manifest_id, schema_version, base_version, current_snapshot_id,
      canonical_export_hash, document_count, created_by_user_id, created_by_name,
      status, page_size, finalized_at
    )
    SELECT ?, 2, state.current_version, NULLIF(state.current_snapshot_id, 0), ?, ?, ?, ?,
           'building', ?, NULL
    FROM document_sync_state state
    WHERE state.id = 1
      AND state.current_version = ?
      AND COALESCE(state.current_snapshot_id, 0) = ?
    RETURNING manifest_id
  `).bind(
    exportManifestId,
    "0".repeat(64),
    documentCount,
    actorSnapshot.userId,
    actorSnapshot.displayName,
    FREE_TIER_BUDGET.excelSnapshotExportPageSize,
    state.currentVersion,
    state.currentSnapshotId
  ).first();
  if (!persisted?.manifest_id) {
    if (attempt >= 1) throw new Error("엑셀 추출 중 문서고가 계속 변경되어 일관된 export를 만들 수 없습니다.");
    return createDocumentSnapshotExport(env, actor, attempt + 1);
  }

  return {
    schemaVersion: 2,
    baseVersion: state.currentVersion,
    currentSnapshotId: state.currentSnapshotId || null,
    exportManifestId,
    exportedAt: new Date().toISOString(),
    documentCount,
    clientSourceHashNote: "업로드 시 sourceHash는 브라우저가 계산한 원본 XLSX SHA-256이며 서버 검증 해시가 아닙니다.",
    codes: {
      categories: (categoryResult.results ?? []).map((row) => row.name),
      tags: (tagResult.results ?? []).map((row) => row.name),
      racks: (rackResult.results ?? []).map((row) => ({
        rackNumber: Number(row.rack_number), code: row.code, singleSided: Boolean(row.is_single_sided)
      }))
    }
  };
}

export async function getDocumentSnapshotExport(env, actor = {}, attempt = 0) {
  const stateBefore = await getDocumentSyncState(env);
  const [result, categoryResult, tagResult, rackResult] = await Promise.all([
    env.DB.prepare(`
      SELECT
        d.excel_row_key, d.row_version, d.document_number, d.revision_number, d.revision_date,
        d.disposal_due_year, d.document_name, c.name AS category_name,
        r.rack_number, r.code AS rack_code, r.is_single_sided,
        rs.column_number, rs.shelf_number, d.rack_face,
        GROUP_CONCAT(t.name, ';') AS tag_names,
        d.note, d.status
      FROM documents d
      JOIN categories c ON c.id = d.category_id
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      JOIN racks r ON r.id = rs.rack_id
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      LEFT JOIN tags t ON t.id = dt.tag_id
      WHERE d.sync_state = 'current'
      GROUP BY d.id
      ORDER BY r.rack_number, d.rack_face, rs.column_number, rs.shelf_number, d.document_number, d.id
    `).all(),
    env.DB.prepare("SELECT name FROM categories WHERE is_active = 1 ORDER BY sort_order, name").all(),
    env.DB.prepare("SELECT name FROM tags WHERE is_active = 1 ORDER BY name").all(),
    env.DB.prepare("SELECT rack_number, code, is_single_sided FROM racks WHERE is_active = 1 ORDER BY zone_number, rack_number").all()
  ]);
  const state = await getDocumentSyncState(env);
  if (
    state.currentVersion !== stateBefore.currentVersion ||
    state.currentSnapshotId !== stateBefore.currentSnapshotId
  ) {
    if (attempt >= 1) throw new Error("엑셀 추출 중 문서고가 계속 변경되어 일관된 export를 만들 수 없습니다.");
    return getDocumentSnapshotExport(env, actor, attempt + 1);
  }
  const documents = (result.results ?? []).map(exportDocument);
  const exportManifestId = `EXP-${crypto.randomUUID()}`;
  const canonicalExportHash = await computeExportManifestHash(documents);
  const actorSnapshot = auditActorSnapshot(actor);
  const persisted = await env.DB.prepare(`
    INSERT INTO document_snapshot_export_manifests (
      manifest_id, schema_version, base_version, current_snapshot_id,
      canonical_export_hash, document_count, created_by_user_id, created_by_name,
      status, page_size, finalized_at
    )
    SELECT ?, 2, state.current_version, NULLIF(state.current_snapshot_id, 0), ?, ?, ?, ?,
           'completed', ?, CURRENT_TIMESTAMP
    FROM document_sync_state state
    WHERE state.id = 1
      AND state.current_version = ?
      AND COALESCE(state.current_snapshot_id, 0) = ?
    RETURNING manifest_id
  `).bind(
    exportManifestId,
    canonicalExportHash,
    documents.length,
    actorSnapshot.userId,
    actorSnapshot.displayName,
    FREE_TIER_BUDGET.excelSnapshotExportPageSize,
    state.currentVersion,
    state.currentSnapshotId
  ).first();
  if (!persisted?.manifest_id) {
    if (attempt >= 1) throw new Error("엑셀 추출 중 문서고가 계속 변경되어 일관된 export를 만들 수 없습니다.");
    return getDocumentSnapshotExport(env, actor, attempt + 1);
  }
  return {
    schemaVersion: 2,
    baseVersion: state.currentVersion,
    currentSnapshotId: state.currentSnapshotId || null,
    exportManifestId,
    canonicalExportHash,
    exportedAt: new Date().toISOString(),
    clientSourceHashNote: "업로드 시 sourceHash는 브라우저가 계산한 원본 XLSX SHA-256이며 서버 검증 해시가 아닙니다.",
    documents,
    codes: {
      categories: (categoryResult.results ?? []).map((row) => row.name),
      tags: (tagResult.results ?? []).map((row) => row.name),
      racks: (rackResult.results ?? []).map((row) => ({
        rackNumber: Number(row.rack_number), code: row.code, singleSided: Boolean(row.is_single_sided)
      }))
    }
  };
}

export async function getDocumentSnapshotExportPage(env, manifestId, pageNumber) {
  const id = clean(manifestId);
  const page = Number(pageNumber);
  if (!/^EXP-[A-Za-z0-9-]{16,}$/.test(id) || !Number.isInteger(page) || page < 1) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "export page 요청이 올바르지 않습니다.");
  }
  const manifest = await env.DB.prepare(`
    SELECT manifest_id, base_version, current_snapshot_id, document_count, page_size
    FROM document_snapshot_export_manifests
    WHERE manifest_id = ? AND status IN ('building', 'completed')
  `).bind(id).first();
  if (!manifest) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_NOT_FOUND, "export manifest를 찾을 수 없습니다.");
  const state = await getDocumentSyncState(env);
  if (
    Number(manifest.base_version) !== state.currentVersion ||
    Number(manifest.current_snapshot_id || 0) !== state.currentSnapshotId
  ) {
    await env.DB.prepare("UPDATE document_snapshot_export_manifests SET status = 'invalidated' WHERE manifest_id = ?").bind(id).run();
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE, "export 도중 문서고가 변경되었습니다. 다시 추출하세요.", { stale: true });
  }
  const pageSize = Math.min(Number(manifest.page_size || 250), FREE_TIER_BUDGET.excelSnapshotExportPageSize);
  const expectedPages = Math.max(1, Math.ceil(Number(manifest.document_count || 0) / pageSize));
  if (page > expectedPages) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "export page 범위를 벗어났습니다.");
  }
  const offset = (page - 1) * pageSize;
  const result = await env.DB.prepare(`
    SELECT
      d.excel_row_key, d.row_version, d.document_number, d.revision_number, d.revision_date,
      d.disposal_due_year, d.document_name, c.name AS category_name,
      r.rack_number, r.code AS rack_code, r.is_single_sided,
      rs.column_number, rs.shelf_number, d.rack_face,
      GROUP_CONCAT(t.name, ';') AS tag_names,
      d.note, d.status
    FROM documents d
    JOIN categories c ON c.id = d.category_id
    JOIN rack_slots rs ON rs.id = d.rack_slot_id
    JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN document_tags dt ON dt.document_id = d.id
    LEFT JOIN tags t ON t.id = dt.tag_id
    WHERE d.sync_state = 'current'
    GROUP BY d.id
    ORDER BY r.rack_number, d.rack_face, rs.column_number, rs.shelf_number, d.document_number, d.id
    LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all();
  const documents = (result.results ?? []).map(exportDocument);
  const pageHash = await computeExportManifestHash(documents);
  await env.DB.prepare(`
    INSERT INTO document_snapshot_export_pages (
      manifest_id, page_number, row_offset, row_count, page_hash
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(manifest_id, page_number) DO UPDATE SET
      row_offset = excluded.row_offset,
      row_count = excluded.row_count,
      page_hash = excluded.page_hash
  `).bind(id, page, offset, documents.length, pageHash).run();
  return {
    ok: true,
    manifestId: id,
    page,
    pageSize,
    pageHash,
    documents,
    hasMore: offset + documents.length < Number(manifest.document_count || 0)
  };
}

export async function finalizeDocumentSnapshotExport(env, manifestId) {
  const id = clean(manifestId);
  const manifest = await env.DB.prepare(`
    SELECT manifest_id, base_version, current_snapshot_id, document_count, page_size,
           canonical_export_hash, status
    FROM document_snapshot_export_manifests
    WHERE manifest_id = ? AND status IN ('building', 'completed')
  `).bind(id).first();
  if (!manifest) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_NOT_FOUND, "완료할 export manifest를 찾을 수 없습니다.");
  const state = await getDocumentSyncState(env);
  if (
    Number(manifest.base_version) !== state.currentVersion ||
    Number(manifest.current_snapshot_id || 0) !== state.currentSnapshotId
  ) return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE, "export 도중 문서고가 변경되었습니다.", { stale: true });
  const pages = await env.DB.prepare(`
    SELECT page_number, row_offset, row_count, page_hash
    FROM document_snapshot_export_pages
    WHERE manifest_id = ?
    ORDER BY page_number
  `).bind(id).all();
  const pageRows = pages.results ?? [];
  const pageSize = Number(manifest.page_size || 250);
  const documentCount = Number(manifest.document_count || 0);
  const expectedPages = Math.max(1, Math.ceil(documentCount / pageSize));
  const validPageChain = pageRows.length === expectedPages && pageRows.every((pageRow, index) => {
    const expectedOffset = index * pageSize;
    const expectedRowCount = Math.max(0, Math.min(pageSize, documentCount - expectedOffset));
    return Number(pageRow.page_number) === index + 1 &&
      Number(pageRow.row_offset) === expectedOffset &&
      Number(pageRow.row_count) === expectedRowCount &&
      /^[a-f0-9]{64}$/i.test(clean(pageRow.page_hash));
  });
  if (!validPageChain) {
    return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_COUNT_MISMATCH, "모든 export page를 받은 뒤 완료하세요.");
  }
  const canonicalExportHash = manifest.status === "completed"
    ? clean(manifest.canonical_export_hash)
    : await computeExportPageChainHash(pageRows);
  if (manifest.status === "building") {
    const completed = await env.DB.prepare(`
      UPDATE document_snapshot_export_manifests
      SET status = 'completed',
          canonical_export_hash = ?,
          finalized_at = CURRENT_TIMESTAMP
      WHERE manifest_id = ? AND status = 'building'
      RETURNING manifest_id
    `).bind(canonicalExportHash, id).first();
    if (!completed?.manifest_id) {
      return snapshotError(SNAPSHOT_ERROR_CODES.SNAPSHOT_CONCURRENT_APPLY, "export 완료 상태가 동시에 변경되었습니다.");
    }
  }
  return {
    ok: true,
    manifestId: id,
    documentCount,
    pageCount: expectedPages,
    canonicalExportHash
  };
}

function exportDocument(row) {
  return {
    rowKey: clean(row.excel_row_key),
    baseRowVersion: Number(row.row_version || 0),
    documentNumber: clean(row.document_number),
    revisionNumber: clean(row.revision_number),
    revisionDate: clean(row.revision_date),
    disposalDueYear: row.disposal_due_year === null || row.disposal_due_year === undefined ? "" : Number(row.disposal_due_year),
    documentName: clean(row.document_name),
    category: clean(row.category_name),
    rackNumber: Number(row.rack_number),
    rackColumn: Number(row.column_number),
    shelfNumber: Number(row.shelf_number),
    rackFace: Number(row.is_single_sided) ? "단면" : row.rack_face === "B" ? "2면" : "1면",
    tags: clean(row.tag_names),
    note: clean(row.note),
    status: row.status === "disposed" ? "폐기" : "보관중"
  };
}
