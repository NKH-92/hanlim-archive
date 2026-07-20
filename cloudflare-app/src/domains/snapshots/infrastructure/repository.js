import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import { createBatchPlan } from "../../../platform/d1/batchPlan.js";
import { clean } from "../../../shared/text/normalize.js";
import { auditActorSnapshot } from "../../identity/index.js";

const SNAPSHOT_STATUSES = new Set(["staging", "ready", "applying", "completed", "cancelled", "failed"]);
const ROW_ACTIONS = new Set(["staged", "create", "update", "unchanged"]);

export async function getDocumentSyncState(env) {
  const row = await env.DB.prepare(`
    SELECT current_version, current_snapshot_id, updated_at
    FROM document_sync_state
    WHERE id = 1
  `).first();
  return {
    currentVersion: Number(row?.current_version || 1),
    currentSnapshotId: Number(row?.current_snapshot_id || 0),
    updatedAt: clean(row?.updated_at)
  };
}

export async function listDocumentSnapshots(env, { limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const result = await env.DB.prepare(`
    SELECT *
    FROM document_snapshots
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return result.results ?? [];
}

export async function getDocumentSnapshot(env, id) {
  return env.DB.prepare(`
    SELECT *
    FROM document_snapshots
    WHERE id = ?
  `).bind(id).first();
}

export async function getDocumentSnapshotRows(env, snapshotId, { action = "", limit = 1000 } = {}) {
  const safeAction = ROW_ACTIONS.has(action) ? action : "";
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, FREE_TIER_BUDGET.excelSnapshotMaxItems));
  const result = await env.DB.prepare(`
    SELECT id, snapshot_id, row_number, row_key, normalized_json, action, matched_document_id
    FROM document_snapshot_rows
    WHERE snapshot_id = ? AND (? = '' OR action = ?)
    ORDER BY row_number
    LIMIT ?
  `).bind(snapshotId, safeAction, safeAction, safeLimit).all();
  return result.results ?? [];
}

export async function createDocumentSnapshot(env, input, actor) {
  const sourceName = clean(input?.sourceName).slice(0, 200) || "문서고 관리대장.xlsx";
  const sourceHash = clean(input?.sourceHash).toLowerCase();
  const totalCount = Number(input?.totalCount);
  const requestedBaseVersion = optionalPositiveInteger(input?.baseVersion);
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) return { ok: false, message: "엑셀 파일 해시를 확인할 수 없습니다." };
  if (!Number.isInteger(totalCount) || totalCount < 1 || totalCount > FREE_TIER_BUDGET.excelSnapshotMaxItems) {
    return { ok: false, message: `엑셀 문서는 1~${FREE_TIER_BUDGET.excelSnapshotMaxItems}건까지 동기화할 수 있습니다.` };
  }

  const state = await getDocumentSyncState(env);
  if (requestedBaseVersion && requestedBaseVersion !== state.currentVersion) {
    return { ok: false, stale: true, message: "이 엑셀을 추출한 뒤 문서고가 변경되었습니다. 최신 엑셀을 다시 추출해 작업하세요." };
  }

  const temporaryCode = `SNP-TEMP-${crypto.randomUUID()}`;
  const actorSnapshot = auditActorSnapshot(actor);
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_snapshots (
        snapshot_code, source_name, source_hash, base_version, previous_snapshot_id, status, has_row_keys,
        total_count, created_by_user_id, created_by_name
      )
      VALUES (?, ?, ?, ?, ?, 'staging', ?, ?, ?, ?)
      RETURNING id
    `).bind(
      temporaryCode,
      sourceName,
      sourceHash,
      state.currentVersion,
      state.currentSnapshotId || null,
      input?.hasRowKeys ? 1 : 0,
      totalCount,
      actorSnapshot.userId,
      actorSnapshot.displayName
    ),
    env.DB.prepare(`
      INSERT INTO system_audit_logs (
        entity_type, entity_id, entity_reference, action, actor_user_id,
        actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
        summary, details_json
      )
      SELECT
        'document_snapshot', CAST(id AS TEXT),
        'SNP-' || strftime('%Y', 'now') || '-' || printf('%04d', id),
        'create', ?, ?, ?, ?, '엑셀 문서대장 동기화 시작',
        json_object('sourceName', source_name, 'sourceHash', source_hash, 'totalCount', total_count, 'baseVersion', base_version)
      FROM document_snapshots
      WHERE snapshot_code = ?
    `).bind(
      actorSnapshot.userId,
      actorSnapshot.username,
      actorSnapshot.displayName,
      JSON.stringify(actorSnapshot.permissions),
      temporaryCode
    ),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET snapshot_code = 'SNP-' || strftime('%Y', 'now') || '-' || printf('%04d', id),
          updated_at = CURRENT_TIMESTAMP
      WHERE snapshot_code = ?
    `).bind(temporaryCode)
  ];
  const results = await env.DB.batch(snapshotStatements("create", statements));
  const id = Number(results[0]?.results?.[0]?.id || 0);
  if (!id) throw new Error("엑셀 동기화 작업 생성 결과를 확인할 수 없습니다.");
  return { ok: true, id, baseVersion: state.currentVersion };
}

export async function stageDocumentSnapshotRows(env, snapshotId, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > FREE_TIER_BUDGET.excelSnapshotStageChunkSize) {
    return { ok: false, message: `한 번에 ${FREE_TIER_BUDGET.excelSnapshotStageChunkSize}행씩 전송해야 합니다.` };
  }
  const normalized = [];
  const seenRows = new Set();
  const seenKeys = new Set();
  for (const entry of rows) {
    const rowNumber = Number(entry?.rowNumber);
    const rowKey = clean(entry?.rowKey);
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > FREE_TIER_BUDGET.excelSnapshotMaxItems + 1) {
      return { ok: false, message: "엑셀 행 번호가 올바르지 않습니다." };
    }
    if (!isRowKey(rowKey)) return { ok: false, message: `${rowNumber}행의 숨김 관리 ID가 올바르지 않습니다.` };
    if (seenRows.has(rowNumber) || seenKeys.has(rowKey)) return { ok: false, message: "같은 행 번호 또는 관리 ID가 중복되었습니다." };
    seenRows.add(rowNumber);
    seenKeys.add(rowKey);
    normalized.push({ rowNumber, rowKey, source: normalizeSourceRow(entry?.source) });
  }

  const payload = JSON.stringify(normalized);
  const statements = [
    env.DB.prepare(`
      INSERT INTO document_snapshot_rows (snapshot_id, row_number, row_key, source_json)
      SELECT
        ?,
        CAST(json_extract(staged.value, '$.rowNumber') AS INTEGER),
        json_extract(staged.value, '$.rowKey'),
        json(json_extract(staged.value, '$.source'))
      FROM json_each(?) staged
      WHERE EXISTS (
        SELECT 1 FROM document_snapshots
        WHERE id = ? AND status = 'staging'
      )
      ON CONFLICT(snapshot_id, row_number) DO UPDATE SET
        row_key = excluded.row_key,
        source_json = excluded.source_json,
        normalized_json = NULL,
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
  const results = await env.DB.batch(snapshotStatements("stage", statements));
  const progress = results[1]?.results?.[0];
  if (!progress) return { ok: false, message: "행을 추가할 수 없는 동기화 작업입니다." };
  return { ok: true, stagedCount: Number(progress.staged_count || 0), totalCount: Number(progress.total_count || 0) };
}

export async function prepareDocumentSnapshot(env, snapshotId, options, prepareRows, actor) {
  const snapshot = await getDocumentSnapshot(env, snapshotId);
  if (!snapshot) return { ok: false, message: "엑셀 동기화 작업을 찾을 수 없습니다." };
  if (snapshot.status === "ready" || snapshot.status === "completed") return { ok: true, snapshot };
  if (snapshot.status !== "staging") return { ok: false, message: "검증할 수 없는 동기화 작업 상태입니다." };

  const [rowResult, documentResult, state] = await Promise.all([
    env.DB.prepare(`
      SELECT row_number, row_key, source_json
      FROM document_snapshot_rows
      WHERE snapshot_id = ?
      ORDER BY row_number
    `).bind(snapshotId).all(),
    env.DB.prepare(`
      SELECT
        d.id, d.excel_row_key, d.sync_state, d.category_id, d.document_number,
        d.revision_number, d.revision_date, d.disposal_due_year, d.document_name,
        d.note, d.rack_slot_id, d.rack_face, d.status,
        GROUP_CONCAT(dt.tag_id, ',') AS tag_ids
      FROM documents d
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      GROUP BY d.id
      ORDER BY d.id
    `).all(),
    getDocumentSyncState(env)
  ]);
  const stagedRows = rowResult.results ?? [];
  if (stagedRows.length !== Number(snapshot.total_count) || stagedRows.length !== Number(snapshot.staged_count)) {
    return { ok: false, message: `전체 ${snapshot.total_count}행 중 ${stagedRows.length}행만 전송되었습니다.` };
  }
  if (state.currentVersion !== Number(snapshot.base_version)) {
    return failSnapshotValidation(env, snapshotId, "검증 중 문서고가 변경되었습니다. 최신 엑셀로 다시 시작하세요.", actor, true);
  }

  let sourceRows;
  try {
    sourceRows = stagedRows.map((row) => ({
      ...JSON.parse(row.source_json),
      rowNumber: Number(row.row_number),
      rowKey: clean(row.row_key)
    }));
  } catch {
    return failSnapshotValidation(env, snapshotId, "저장된 엑셀 행을 읽을 수 없습니다.", actor);
  }

  const prepared = prepareRows(sourceRows, options);
  const keyErrors = validatePreparedRowKeys(prepared.items);
  const errors = [...prepared.errors, ...keyErrors];
  if (errors.length) {
    const message = `${errors.slice(0, 20).join(" / ")}${errors.length > 20 ? ` / 외 ${errors.length - 20}건` : ""}`;
    return failSnapshotValidation(env, snapshotId, message, actor);
  }

  const documents = documentResult.results ?? [];
  const match = matchPreparedRows(prepared.items, documents, Boolean(snapshot.has_row_keys));
  const changes = {};
  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  for (const item of match.items) {
    if (item.action === "create") createCount += 1;
    else if (item.action === "update") updateCount += 1;
    else unchangedCount += 1;
    changes[String(item.rowNumber)] = {
      action: item.action,
      matchedDocumentId: item.matchedDocumentId || null,
      normalizedJson: JSON.stringify({ rowKey: item.rowKey, values: item.values, status: item.status })
    };
  }

  const excludeCount = documents.filter((document) => document.sync_state === "current" && !match.matchedIds.has(Number(document.id))).length;
  const actorSnapshot = auditActorSnapshot(actor);
  const changePayload = JSON.stringify(changes);
  const statements = [
    env.DB.prepare(`
      UPDATE document_snapshot_rows AS row
      SET normalized_json = json_extract(change.value, '$.normalizedJson'),
          action = json_extract(change.value, '$.action'),
          matched_document_id = CAST(json_extract(change.value, '$.matchedDocumentId') AS INTEGER)
      FROM json_each(?) change
      WHERE row.snapshot_id = ?
        AND row.row_number = CAST(change.key AS INTEGER)
        AND EXISTS (SELECT 1 FROM document_snapshots WHERE id = ? AND status = 'staging')
    `).bind(changePayload, snapshotId, snapshotId),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'ready', create_count = ?, update_count = ?, unchanged_count = ?, exclude_count = ?,
          error_summary = NULL, prepared_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'staging' AND base_version = (
        SELECT current_version FROM document_sync_state WHERE id = 1
      )
      RETURNING *
    `).bind(createCount, updateCount, unchangedCount, excludeCount, snapshotId),
    systemSnapshotAuditStatement(env, snapshotId, "prepare", "엑셀 문서대장 변경 검토 완료", actorSnapshot, {
      createCount, updateCount, unchangedCount, excludeCount
    }, "ready")
  ];
  const results = await env.DB.batch(snapshotStatements("prepare", statements));
  const ready = results[1]?.results?.[0];
  if (!ready) return { ok: false, stale: true, message: "검증 중 문서고가 변경되었습니다. 최신 엑셀로 다시 시작하세요." };
  return { ok: true, snapshot: ready };
}

export async function applyDocumentSnapshot(env, snapshotId, actor) {
  const snapshot = await getDocumentSnapshot(env, snapshotId);
  if (!snapshot) return { ok: false, message: "엑셀 동기화 작업을 찾을 수 없습니다." };
  if (snapshot.status === "completed") return { ok: true, snapshot, alreadyApplied: true };
  if (snapshot.status !== "ready") return { ok: false, message: "검증이 완료된 동기화 작업만 반영할 수 있습니다." };

  const actorSnapshot = auditActorSnapshot(actor);
  const role = clean(actor?.role) || "User";
  const guard = `EXISTS (SELECT 1 FROM document_snapshots WHERE id = ${Number(snapshotId)} AND status = 'applying')`;
  const statements = [
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'applying', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'ready' AND base_version = (
        SELECT current_version FROM document_sync_state WHERE id = 1
      )
    `).bind(snapshotId),
    env.DB.prepare(`
      INSERT INTO document_audit_logs (
        document_id, storage_code, document_number, action, actor, actor_role,
        actor_user_id, actor_username, summary, details
      )
      SELECT
        d.id, d.storage_code, d.document_number, 'excel_sync_update', ?, ?, ?, ?,
        '엑셀 문서대장 기준 정보 변경',
        json_object(
          'snapshotCode', s.snapshot_code,
          'before', json_object(
            'documentNumber', d.document_number, 'revisionNumber', d.revision_number,
            'revisionDate', IFNULL(d.revision_date, ''), 'disposalDueYear', d.disposal_due_year,
            'documentName', d.document_name, 'categoryId', d.category_id,
            'rackSlotId', d.rack_slot_id, 'rackFace', d.rack_face,
            'status', d.status, 'note', IFNULL(d.note, ''), 'syncState', d.sync_state
          ),
          'after', json(row.normalized_json)
        )
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.id = row.matched_document_id
      WHERE row.snapshot_id = ? AND row.action = 'update'
    `).bind(actorSnapshot.displayName, role, actorSnapshot.userId, actorSnapshot.username, snapshotId),
    env.DB.prepare(`
      INSERT INTO document_audit_logs (
        document_id, storage_code, document_number, action, actor, actor_role,
        actor_user_id, actor_username, summary, details
      )
      SELECT
        d.id, d.storage_code, d.document_number, 'excel_sync_exclude', ?, ?, ?, ?,
        '새 엑셀 문서대장에서 제외',
        json_object('snapshotCode', s.snapshot_code, 'before', json_object('syncState', d.sync_state), 'after', json_object('syncState', 'excluded'))
      FROM documents d
      JOIN document_snapshots s ON s.id = ? AND s.status = 'applying'
      WHERE d.sync_state = 'current'
        AND NOT EXISTS (
          SELECT 1 FROM document_snapshot_rows row
          WHERE row.snapshot_id = s.id AND json_extract(row.normalized_json, '$.rowKey') = d.excel_row_key
        )
    `).bind(actorSnapshot.displayName, role, actorSnapshot.userId, actorSnapshot.username, snapshotId),
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason)
      SELECT
        d.id,
        CASE WHEN json_extract(row.normalized_json, '$.status') = 'disposed' THEN 'disposed' ELSE 'restored' END,
        ?, '엑셀 문서대장 상태 동기화'
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.id = row.matched_document_id
      WHERE row.snapshot_id = ? AND row.action = 'update'
        AND d.status <> json_extract(row.normalized_json, '$.status')
    `).bind(actorSnapshot.displayName, snapshotId),
    env.DB.prepare(`
      UPDATE documents AS d
      SET excel_row_key = json_extract(row.normalized_json, '$.rowKey'),
          category_id = CAST(json_extract(row.normalized_json, '$.values.categoryId') AS INTEGER),
          document_number = json_extract(row.normalized_json, '$.values.documentNumber'),
          revision_number = json_extract(row.normalized_json, '$.values.revisionNumber'),
          revision_date = NULLIF(json_extract(row.normalized_json, '$.values.revisionDate'), ''),
          disposal_due_year = CAST(NULLIF(json_extract(row.normalized_json, '$.values.disposalDueYear'), '') AS INTEGER),
          document_name = json_extract(row.normalized_json, '$.values.documentName'),
          note = NULLIF(json_extract(row.normalized_json, '$.values.note'), ''),
          rack_slot_id = CAST(json_extract(row.normalized_json, '$.values.rackSlotId') AS INTEGER),
          rack_face = json_extract(row.normalized_json, '$.values.rackFace'),
          status = json_extract(row.normalized_json, '$.status'),
          sync_state = 'current', last_snapshot_id = ?, row_version = row_version + 1,
          updated_at = CURRENT_TIMESTAMP
      FROM document_snapshot_rows row
      WHERE d.id = row.matched_document_id
        AND row.snapshot_id = ? AND row.action = 'update' AND ${guard}
    `).bind(snapshotId, snapshotId),
    env.DB.prepare(`
      INSERT INTO documents (
        storage_code, excel_row_key, category_id, document_number, revision_number,
        revision_date, disposal_due_year, document_name, note, rack_slot_id, rack_face,
        status, sync_state, last_snapshot_id, updated_at
      )
      SELECT
        'SNP-' || row.snapshot_id || '-' || row.row_number,
        json_extract(row.normalized_json, '$.rowKey'),
        CAST(json_extract(row.normalized_json, '$.values.categoryId') AS INTEGER),
        json_extract(row.normalized_json, '$.values.documentNumber'),
        json_extract(row.normalized_json, '$.values.revisionNumber'),
        NULLIF(json_extract(row.normalized_json, '$.values.revisionDate'), ''),
        CAST(NULLIF(json_extract(row.normalized_json, '$.values.disposalDueYear'), '') AS INTEGER),
        json_extract(row.normalized_json, '$.values.documentName'),
        NULLIF(json_extract(row.normalized_json, '$.values.note'), ''),
        CAST(json_extract(row.normalized_json, '$.values.rackSlotId') AS INTEGER),
        json_extract(row.normalized_json, '$.values.rackFace'),
        json_extract(row.normalized_json, '$.status'),
        'current', row.snapshot_id, CURRENT_TIMESTAMP
      FROM document_snapshot_rows row
      WHERE row.snapshot_id = ? AND row.action = 'create' AND ${guard}
    `).bind(snapshotId),
    env.DB.prepare(`
      UPDATE documents
      SET storage_code = 'ARC-' || printf('%06d', id)
      WHERE last_snapshot_id = ? AND storage_code LIKE 'SNP-%' AND ${guard}
    `).bind(snapshotId),
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason)
      SELECT d.id, 'disposed', ?, '엑셀 문서대장 최초 동기화'
      FROM documents d
      WHERE d.last_snapshot_id = ? AND d.status = 'disposed' AND ${guard}
        AND NOT EXISTS (SELECT 1 FROM disposal_logs log WHERE log.document_id = d.id)
    `).bind(actorSnapshot.displayName, snapshotId),
    env.DB.prepare(`
      DELETE FROM document_tags
      WHERE document_id IN (
        SELECT matched_document_id FROM document_snapshot_rows
        WHERE snapshot_id = ? AND action = 'update'
      ) AND ${guard}
    `).bind(snapshotId),
    env.DB.prepare(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      SELECT d.id, CAST(tag.value AS INTEGER)
      FROM document_snapshot_rows row
      JOIN documents d ON d.excel_row_key = json_extract(row.normalized_json, '$.rowKey')
      CROSS JOIN json_each(json_extract(row.normalized_json, '$.values.tagIds')) tag
      JOIN tags t ON t.id = CAST(tag.value AS INTEGER) AND t.is_active = 1
      WHERE row.snapshot_id = ? AND row.action IN ('create', 'update') AND ${guard}
    `).bind(snapshotId),
    env.DB.prepare(`
      INSERT INTO document_audit_logs (
        document_id, storage_code, document_number, action, actor, actor_role,
        actor_user_id, actor_username, summary, details
      )
      SELECT
        d.id, d.storage_code, d.document_number, 'excel_sync_create', ?, ?, ?, ?,
        '엑셀 문서대장 기준 문서 등록',
        json_object('snapshotCode', s.snapshot_code, 'after', json(row.normalized_json))
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.excel_row_key = json_extract(row.normalized_json, '$.rowKey')
      WHERE row.snapshot_id = ? AND row.action = 'create'
    `).bind(actorSnapshot.displayName, role, actorSnapshot.userId, actorSnapshot.username, snapshotId),
    env.DB.prepare(`
      UPDATE documents
      SET sync_state = 'excluded', row_version = row_version + 1,
          last_snapshot_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE sync_state = 'current' AND ${guard}
        AND NOT EXISTS (
          SELECT 1 FROM document_snapshot_rows row
          WHERE row.snapshot_id = ? AND json_extract(row.normalized_json, '$.rowKey') = documents.excel_row_key
        )
    `).bind(snapshotId, snapshotId),
    systemSnapshotAuditStatement(env, snapshotId, "apply", "엑셀 문서대장 전체 동기화 반영", actorSnapshot, {
      createCount: Number(snapshot.create_count || 0),
      updateCount: Number(snapshot.update_count || 0),
      unchangedCount: Number(snapshot.unchanged_count || 0),
      excludeCount: Number(snapshot.exclude_count || 0)
    }, "applying"),
    env.DB.prepare(`
      UPDATE document_sync_state
      SET current_version = (SELECT base_version + 1 FROM document_snapshots WHERE id = ? AND status = 'applying'),
          current_snapshot_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND ${guard}
    `).bind(snapshotId, snapshotId),
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'completed', applied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'applying'
      RETURNING *
    `).bind(snapshotId)
  ];
  const results = await env.DB.batch(snapshotStatements("apply", statements));
  if (!Number(results[0]?.meta?.changes || 0)) {
    return { ok: false, stale: true, message: "미리보기 이후 문서고가 변경되었습니다. 최신 엑셀로 다시 시작하세요." };
  }
  const completed = results.at(-1)?.results?.[0];
  if (!completed) throw new Error("엑셀 문서대장 반영 결과를 확인할 수 없습니다.");
  return { ok: true, snapshot: completed, statementCount: statements.length };
}

export async function getDocumentSnapshotExport(env) {
  const [state, result, categoryResult, tagResult, rackResult] = await Promise.all([
    getDocumentSyncState(env),
    env.DB.prepare(`
      SELECT
        d.excel_row_key, d.document_number, d.revision_number, d.revision_date,
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
  return {
    schemaVersion: 1,
    baseVersion: state.currentVersion,
    currentSnapshotId: state.currentSnapshotId || null,
    exportedAt: new Date().toISOString(),
    documents: (result.results ?? []).map(exportDocument),
    codes: {
      categories: (categoryResult.results ?? []).map((row) => row.name),
      tags: (tagResult.results ?? []).map((row) => row.name),
      racks: (rackResult.results ?? []).map((row) => ({
        rackNumber: Number(row.rack_number), code: row.code, singleSided: Boolean(row.is_single_sided)
      }))
    }
  };
}

async function failSnapshotValidation(env, snapshotId, message, actor, stale = false) {
  const summary = clean(message).slice(0, 2000) || "엑셀 검증에 실패했습니다.";
  const actorSnapshot = auditActorSnapshot(actor);
  const statements = [
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'failed', error_summary = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'staging'
    `).bind(summary, snapshotId),
    systemSnapshotAuditStatement(env, snapshotId, "validation_failed", "엑셀 문서대장 검증 실패", actorSnapshot, { message: summary }, "failed")
  ];
  await env.DB.batch(snapshotStatements("validation-failed", statements));
  return { ok: false, stale, message: summary };
}

function matchPreparedRows(items, documents, hasRowKeys) {
  const byKey = new Map(documents.map((document) => [clean(document.excel_row_key), document]));
  const byIdentity = new Map();
  for (const document of documents) {
    const key = documentIdentity(document.document_number, document.revision_number);
    const list = byIdentity.get(key) || [];
    list.push(document);
    byIdentity.set(key, list);
  }
  const matchedIds = new Set();
  const matchedItems = items.map((item) => {
    let document = byKey.get(item.rowKey) || null;
    if (!document && !hasRowKeys) {
      const candidates = byIdentity.get(documentIdentity(item.values.documentNumber, item.values.revisionNumber)) || [];
      if (candidates.length === 1 && !matchedIds.has(Number(candidates[0].id))) document = candidates[0];
    }
    if (!document) return { ...item, action: "create", matchedDocumentId: 0 };
    matchedIds.add(Number(document.id));
    return {
      ...item,
      action: documentMatches(document, item) ? "unchanged" : "update",
      matchedDocumentId: Number(document.id)
    };
  });
  return { items: matchedItems, matchedIds };
}

function documentMatches(document, item) {
  const values = item.values;
  return clean(document.excel_row_key) === item.rowKey &&
    document.sync_state === "current" &&
    Number(document.category_id) === values.categoryId &&
    clean(document.document_number) === values.documentNumber &&
    clean(document.revision_number) === values.revisionNumber &&
    clean(document.revision_date) === values.revisionDate &&
    nullableNumber(document.disposal_due_year) === nullableNumber(values.disposalDueYear) &&
    clean(document.document_name) === values.documentName &&
    clean(document.note) === values.note &&
    Number(document.rack_slot_id) === values.rackSlotId &&
    clean(document.rack_face) === values.rackFace &&
    clean(document.status) === item.status &&
    sameNumbers(parseIdList(document.tag_ids), values.tagIds);
}

function exportDocument(row) {
  return {
    rowKey: clean(row.excel_row_key),
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

function validatePreparedRowKeys(items) {
  const seen = new Set();
  const errors = [];
  for (const item of items) {
    if (!isRowKey(item.rowKey)) errors.push(`${item.rowNumber}행: 숨김 관리 ID가 올바르지 않습니다.`);
    else if (seen.has(item.rowKey)) errors.push(`${item.rowNumber}행: 숨김 관리 ID가 중복되었습니다.`);
    seen.add(item.rowKey);
  }
  return errors;
}

function isRowKey(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(clean(value));
}

function documentIdentity(number, revision) {
  return `${clean(number).toUpperCase()}\u0000${clean(revision).toUpperCase()}`;
}

function parseIdList(value) {
  return clean(value).split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

function sameNumbers(left, right) {
  const a = [...new Set(left)].sort((x, y) => x - y);
  const b = [...new Set(right)].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalPositiveInteger(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function systemSnapshotAuditStatement(env, snapshotId, action, summary, actor, details, requiredStatus) {
  return env.DB.prepare(`
    INSERT INTO system_audit_logs (
      entity_type, entity_id, entity_reference, action, actor_user_id,
      actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
      summary, details_json
    )
    SELECT 'document_snapshot', CAST(id AS TEXT), snapshot_code, ?, ?, ?, ?, ?, ?, ?
    FROM document_snapshots
    WHERE id = ? AND status = ?
  `).bind(
    action,
    actor.userId,
    actor.username,
    actor.displayName,
    JSON.stringify(actor.permissions),
    summary,
    JSON.stringify(details),
    snapshotId,
    requiredStatus
  );
}

function snapshotStatements(action, statements) {
  const plan = createBatchPlan(`snapshots.${action}`).withBudget(FREE_TIER_BUDGET.maxD1StatementsPerRequest);
  statements.forEach((statement, index) => plan.step(`${action}.${index + 1}`, statement, { guard: "snapshot-state" }));
  return plan.execution().statements;
}

export { SNAPSHOT_STATUSES };
