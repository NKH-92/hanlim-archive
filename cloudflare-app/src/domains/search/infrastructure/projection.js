// Core D1 안의 검색 projection 유지보수.
//
// 크로스 DB 보상 계층(outbox lease, processor lease, source watermark, 삭제 tombstone,
// shadow generation, cutover, rollback)이 없다. projection 쓰기와 dirty 큐 삭제가 같은
// env.DB.batch() 안에서 끝나므로 "projection 최신 OR 문서가 dirty"가 트랜잭션으로 보장된다.
//
// 경합 처리는 lease가 아니라 (document_id, event_version) CAS 하나로 끝난다. 읽어둔 dirty 행의
// event_version이 배치 시점에 바뀌어 있으면 삭제 건수 assertion이 batch 전체를 rollback하므로,
// 오래된 내용이 최신 projection을 덮어쓸 수 없다.
import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import {
  DOCUMENT_BASE_JOINS,
  DOCUMENT_LOCATION_COLUMNS,
  DOCUMENT_TAG_CONCAT,
  DOCUMENT_TAG_JOINS
} from "./sql.js";
import { buildSearchIndexTerms, normalizeSearchText } from "../domain/indexTerms.js";
import { BatchPlan } from "../../../platform/d1/batchPlan.js";
import {
  exactChangeCountAssertionSql,
  isExpectedChangeAbort
} from "../../../platform/d1/expectedChange.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";
import { isD1ValuePayloadWithinLimit } from "../../../platform/d1/valueSize.js";

const PROJECTION_COLUMNS = `document_id, document_number, revision_number, document_name,
      category_id, category_name, status, rack_id, rack_code, zone_number,
      rack_face, column_number, shelf_number, tags_json, tag_names,
      normalized_text, document_updated_at, indexed_at`;

const PROJECTION_VALUES = `CAST(json_extract(value, '$.documentId') AS INTEGER),
      json_extract(value, '$.documentNumber'),
      json_extract(value, '$.revisionNumber'),
      json_extract(value, '$.documentName'),
      CAST(json_extract(value, '$.categoryId') AS INTEGER),
      json_extract(value, '$.categoryName'),
      json_extract(value, '$.status'),
      CAST(json_extract(value, '$.rackId') AS INTEGER),
      json_extract(value, '$.rackCode'),
      CAST(json_extract(value, '$.zoneNumber') AS INTEGER),
      json_extract(value, '$.rackFace'),
      CAST(json_extract(value, '$.columnNumber') AS INTEGER),
      CAST(json_extract(value, '$.shelfNumber') AS INTEGER),
      json_extract(value, '$.tagsJson'),
      json_extract(value, '$.tagNames'),
      json_extract(value, '$.normalizedText'),
      json_extract(value, '$.updatedAt'),
      CURRENT_TIMESTAMP`;

const PROJECTION_UPDATE_SET = `document_number = excluded.document_number,
      revision_number = excluded.revision_number,
      document_name = excluded.document_name,
      category_id = excluded.category_id,
      category_name = excluded.category_name,
      status = excluded.status,
      rack_id = excluded.rack_id,
      rack_code = excluded.rack_code,
      zone_number = excluded.zone_number,
      rack_face = excluded.rack_face,
      column_number = excluded.column_number,
      shelf_number = excluded.shelf_number,
      tags_json = excluded.tags_json,
      tag_names = excluded.tag_names,
      normalized_text = excluded.normalized_text,
      document_updated_at = excluded.document_updated_at,
      indexed_at = CURRENT_TIMESTAMP`;

export function projectionSourceSelect({ after = false } = {}) {
  return `
    SELECT
      d.id,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.updated_at,
      d.category_id,
      d.status,
      d.rack_face,
      rs.rack_id,
      rs.column_number,
      rs.shelf_number,
      ${DOCUMENT_LOCATION_COLUMNS}
      ${DOCUMENT_TAG_CONCAT},
      COALESCE((
        SELECT json_group_array(json_object('id', tag.id, 'name', tag.name))
        FROM document_tags tagged
        JOIN tags tag ON tag.id = tagged.tag_id
        WHERE tagged.document_id = d.id
      ), '[]') AS tags_json
    ${DOCUMENT_BASE_JOINS}
    ${DOCUMENT_TAG_JOINS}
    WHERE d.sync_state = 'current'
      ${after ? "AND d.id > ?" : "AND d.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))"}
    GROUP BY d.id
    ${after ? "ORDER BY d.id LIMIT ?" : ""}
  `;
}

export function projectionRowPayload(document) {
  const sourceText = [
    document.document_number,
    document.revision_number,
    document.document_name,
    document.category_name,
    document.rack_code,
    document.tag_names
  ].filter(Boolean).join(" ");
  const normalized = normalizeSearchText(sourceText);
  const terms = buildSearchIndexTerms(sourceText);
  return {
    documentId: Number(document.id),
    present: 1,
    documentNumber: String(document.document_number || ""),
    revisionNumber: String(document.revision_number || ""),
    documentName: String(document.document_name || ""),
    categoryId: Number(document.category_id || 0),
    categoryName: String(document.category_name || ""),
    status: document.status === "disposed" ? "disposed" : "active",
    rackId: Number(document.rack_id || 0),
    rackCode: String(document.rack_code || ""),
    zoneNumber: Number(document.zone_number || 0),
    rackFace: String(document.rack_face || ""),
    columnNumber: Number(document.column_number || 0),
    shelfNumber: Number(document.shelf_number || 0),
    tagsJson: String(document.tags_json || "[]"),
    tagNames: String(document.tag_names || ""),
    normalizedText: `${normalized} ${terms.join(" ")}`.trim(),
    updatedAt: String(document.updated_at || "")
  };
}

export async function getSearchProjectionState(env) {
  const row = await env.DB.prepare(`
    SELECT generation, indexed_document_count, reindex_status, reindex_cursor, last_reindexed_at, updated_at
    FROM search_projection_state
    WHERE id = 1
  `).first();
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM search_projection_dirty"
  ).first();
  return {
    available: Boolean(row),
    generation: Math.max(1, Number(row?.generation || 1)),
    indexedDocumentCount: Number(row?.indexed_document_count || 0),
    reindexStatus: row?.reindex_status || "unavailable",
    reindexCursor: Number(row?.reindex_cursor || 0),
    lastReindexedAt: row?.last_reindexed_at || null,
    updatedAt: row?.updated_at || null,
    pendingDirtyCount: Number(pending?.count || 0),
    ready: row?.reindex_status === "ready"
  };
}

/** 대량 반영·bootstrap 뒤 projection 전체 재색인을 예약하는 statement. */
export function markProjectionReindexRequiredStatement(database) {
  return database.prepare(`
    UPDATE search_projection_state
    SET reindex_status = 'pending',
        reindex_cursor = 0,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `);
}

export async function markSearchProjectionReindexRequired(env) {
  const plan = new BatchPlan("search-projection-reindex-required")
    .step("state.pending", markProjectionReindexRequiredStatement(env.DB))
    .withBudget(1);
  await executeMutationBatch(env, plan);
  return { ok: true };
}

export function drainSearchProjectionDirtyForDocuments(env, documentIds) {
  const ids = normalizedIds(documentIds);
  if (!ids.length) {
    return Promise.resolve({ ok: false, skipped: true, processed: 0, reason: "유효한 문서 ID가 필요합니다." });
  }
  return drainSearchProjectionDirty(env, { limit: ids.length, documentIds: ids });
}

export async function drainSearchProjectionDirty(env, {
  limit = FREE_TIER_BUDGET.searchOutboxCronChunkSize,
  documentIds = []
} = {}) {
  const targetIds = normalizedIds(documentIds);
  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || 1, FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems)
  );
  let entries;
  try {
    entries = await readDirtyEntries(env, targetIds, safeLimit);
  } catch (error) {
    if (isMissingProjectionSchema(error)) {
      return { ok: false, skipped: true, processed: 0, reason: "PROJECTION_SCHEMA_MISSING" };
    }
    throw error;
  }
  if (!entries.length) return { ok: true, processed: 0 };

  try {
    const written = await writeProjectionForEntries(env, entries);
    return { ok: true, processed: written, dirtyRemaining: entries.length - written };
  } catch (error) {
    if (isExpectedChangeAbort(error)) {
      return { ok: false, retryable: true, processed: 0, reason: "SEARCH_PROJECTION_DIRTY_CHANGED" };
    }
    await markDirtyFailure(env, entries, error).catch(() => {});
    throw error;
  }
}

async function readDirtyEntries(env, targetIds, limit) {
  const statement = targetIds.length
    ? env.DB.prepare(`
      SELECT document_id, event_version
      FROM search_projection_dirty
      WHERE document_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        AND available_at <= CURRENT_TIMESTAMP
      ORDER BY available_at, updated_at, document_id
      LIMIT ?
    `).bind(JSON.stringify(targetIds), limit)
    : env.DB.prepare(`
      SELECT document_id, event_version
      FROM search_projection_dirty
      WHERE available_at <= CURRENT_TIMESTAMP
      ORDER BY available_at, updated_at, document_id
      LIMIT ?
    `).bind(limit);
  const result = await statement.all();
  return (result.results ?? []).map((row) => ({
    documentId: Number(row.document_id),
    eventVersion: Number(row.event_version)
  }));
}

async function writeProjectionForEntries(env, entries) {
  const ids = entries.map((entry) => entry.documentId);
  const documents = await readProjectionSourceDocuments(env, ids);
  const payloads = buildPayloads(ids, documents);
  const chunks = splitPayloadChunks(entries, payloads);
  let written = 0;
  for (const chunk of chunks) {
    await executeMutationBatch(env, projectionWritePlan(env, chunk.entries, chunk.payloads));
    written += chunk.entries.length;
  }
  return written;
}

export async function readProjectionSourceDocuments(env, ids) {
  if (!ids.length) return [];
  const result = await env.DB.prepare(projectionSourceSelect())
    .bind(JSON.stringify(ids))
    .all();
  return result.results ?? [];
}

function buildPayloads(ids, documents) {
  const byId = new Map(documents.map((document) => [Number(document.id), document]));
  return ids.map((id) => {
    const document = byId.get(Number(id));
    return document ? projectionRowPayload(document) : { documentId: Number(id), present: 0 };
  });
}

/** JSON bind 상한을 넘지 않도록 entry/payload를 짝지어 분할한다. */
function splitPayloadChunks(entries, payloads) {
  if (isD1ValuePayloadWithinLimit(JSON.stringify(payloads)) || entries.length < 2) {
    return [{ entries, payloads }];
  }
  const splitAt = Math.ceil(entries.length / 2);
  return [
    ...splitPayloadChunks(entries.slice(0, splitAt), payloads.slice(0, splitAt)),
    ...splitPayloadChunks(entries.slice(splitAt), payloads.slice(splitAt))
  ];
}

function projectionWritePlan(env, entries, payloads) {
  const documentsJson = JSON.stringify(payloads);
  const idsJson = JSON.stringify(payloads.map((payload) => payload.documentId));
  const absentIds = payloads.filter((payload) => payload.present !== 1).map((payload) => payload.documentId);
  const hasPresent = payloads.some((payload) => payload.present === 1);
  const plan = new BatchPlan("search-projection-write")
    // external content FTS는 예전 값으로 색인을 지운 뒤 새 값을 넣는다.
    .step("fts.delete", env.DB.prepare(`
      INSERT INTO search_projection_fts(search_projection_fts, rowid, normalized_text)
      SELECT 'delete', p.document_id, p.normalized_text
      FROM search_projection_documents p
      WHERE p.document_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    `).bind(idsJson));
  if (absentIds.length) {
    plan.step("projection.remove", env.DB.prepare(`
      DELETE FROM search_projection_documents
      WHERE document_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    `).bind(JSON.stringify(absentIds)));
  }
  if (hasPresent) {
    plan.step("projection.upsert", env.DB.prepare(`
      INSERT INTO search_projection_documents (
        ${PROJECTION_COLUMNS}
      )
      SELECT
        ${PROJECTION_VALUES}
      FROM json_each(?)
      WHERE CAST(json_extract(value, '$.present') AS INTEGER) = 1
      ON CONFLICT(document_id) DO UPDATE SET
        ${PROJECTION_UPDATE_SET}
    `).bind(documentsJson));
    plan.step("fts.insert", env.DB.prepare(`
      INSERT INTO search_projection_fts(rowid, normalized_text)
      SELECT p.document_id, p.normalized_text
      FROM search_projection_documents p
      WHERE p.document_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    `).bind(idsJson));
  }
  if (entries.length) {
    plan.step("dirty.clear", env.DB.prepare(`
      DELETE FROM search_projection_dirty
      WHERE EXISTS (
        SELECT 1
        FROM json_each(?) event
        WHERE CAST(json_extract(event.value, '$.documentId') AS INTEGER) = search_projection_dirty.document_id
          AND CAST(json_extract(event.value, '$.eventVersion') AS INTEGER) = search_projection_dirty.event_version
      )
    `).bind(JSON.stringify(entries)));
    plan.step(
      "dirty.clear-count",
      env.DB.prepare(exactChangeCountAssertionSql(String(entries.length)))
    );
  }
  return plan.withBudget(6);
}

async function markDirtyFailure(env, entries, error) {
  const message = String(error?.message || "SEARCH_PROJECTION_WRITE_FAILED").slice(0, 500);
  const plan = new BatchPlan("search-projection-dirty-failure")
    .step("dirty.backoff", env.DB.prepare(`
      UPDATE search_projection_dirty
      SET attempt_count = attempt_count + 1,
          available_at = datetime(CURRENT_TIMESTAMP, '+5 minutes'),
          last_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE EXISTS (
        SELECT 1
        FROM json_each(?) event
        WHERE CAST(json_extract(event.value, '$.documentId') AS INTEGER) = search_projection_dirty.document_id
          AND CAST(json_extract(event.value, '$.eventVersion') AS INTEGER) = search_projection_dirty.event_version
      )
    `).bind(message, JSON.stringify(entries)))
    .withBudget(1);
  await executeMutationBatch(env, plan);
}

/**
 * 전체 재색인. shadow generation 없이 in-place upsert로 진행하므로 재색인 중에도
 * 기존 검색 결과가 사라지지 않는다.
 */
export async function reindexSearchProjectionChunk(env, {
  limit = FREE_TIER_BUDGET.searchRebuildChunkSize
} = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, FREE_TIER_BUDGET.searchRebuildChunkSize));
  let state;
  try {
    state = await getSearchProjectionState(env);
  } catch (error) {
    if (isMissingProjectionSchema(error)) {
      return { ok: false, skipped: true, processed: 0, reason: "PROJECTION_SCHEMA_MISSING" };
    }
    throw error;
  }
  if (!state.available) {
    return { ok: false, skipped: true, processed: 0, reason: "PROJECTION_STATE_MISSING" };
  }
  if (state.reindexStatus === "ready") {
    return { ok: true, completed: true, processed: 0, indexedDocumentCount: state.indexedDocumentCount };
  }

  let cursor = state.reindexCursor;
  if (state.reindexStatus === "pending") {
    const claimed = await claimProjectionReindex(env, cursor);
    if (!claimed) {
      const latest = await getSearchProjectionState(env);
      return { ok: true, completed: false, processed: 0, reindexCursor: latest.reindexCursor };
    }
    cursor = 0;
  }

  const result = await env.DB.prepare(projectionSourceSelect({ after: true }))
    .bind(cursor, safeLimit)
    .all();
  const documents = result.results ?? [];
  if (!documents.length) return finalizeProjectionReindex(env, cursor);

  const payloads = documents.map((document) => projectionRowPayload(document));
  const nextCursor = Math.max(...payloads.map((payload) => payload.documentId));
  for (const chunk of splitPayloadChunks([], payloads)) {
    await executeMutationBatch(env, projectionWritePlan(env, [], chunk.payloads));
  }
  const advanced = await advanceProjectionReindexCursor(env, cursor, nextCursor);
  return {
    ok: true,
    completed: false,
    processed: documents.length,
    reindexCursor: advanced ? nextCursor : cursor,
    cursorConflict: !advanced
  };
}

async function claimProjectionReindex(env, expectedCursor) {
  const plan = new BatchPlan("search-projection-reindex-claim")
    .step("state.building", env.DB.prepare(`
      UPDATE search_projection_state
      SET reindex_status = 'building',
          reindex_cursor = 0,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND reindex_status = 'pending' AND reindex_cursor = ?
    `).bind(expectedCursor))
    .expectChanged("state.building")
    .withBudget(1);
  try {
    await executeMutationBatch(env, plan);
    return true;
  } catch (error) {
    if (isExpectedChangeAbort(error)) return false;
    throw error;
  }
}

async function advanceProjectionReindexCursor(env, expectedCursor, nextCursor) {
  const plan = new BatchPlan("search-projection-reindex-advance")
    .step("state.cursor", env.DB.prepare(`
      UPDATE search_projection_state
      SET reindex_cursor = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND reindex_status = 'building' AND reindex_cursor = ?
    `).bind(nextCursor, expectedCursor))
    .expectChanged("state.cursor")
    .withBudget(1);
  try {
    await executeMutationBatch(env, plan);
    return true;
  } catch (error) {
    if (isExpectedChangeAbort(error)) return false;
    throw error;
  }
}

async function finalizeProjectionReindex(env, expectedCursor) {
  const plan = new BatchPlan("search-projection-reindex-finalize")
    // 재색인 시작 이후 current가 아니게 된 문서를 색인에서 제거한다.
    .step("fts.sweep", env.DB.prepare(`
      INSERT INTO search_projection_fts(search_projection_fts, rowid, normalized_text)
      SELECT 'delete', p.document_id, p.normalized_text
      FROM search_projection_documents p
      WHERE NOT EXISTS (
        SELECT 1 FROM documents d WHERE d.id = p.document_id AND d.sync_state = 'current'
      )
    `))
    .step("projection.sweep", env.DB.prepare(`
      DELETE FROM search_projection_documents
      WHERE NOT EXISTS (
        SELECT 1 FROM documents d WHERE d.id = search_projection_documents.document_id AND d.sync_state = 'current'
      )
    `))
    .step("state.ready", env.DB.prepare(`
      UPDATE search_projection_state
      SET reindex_status = 'ready',
          reindex_cursor = 0,
          indexed_document_count = (SELECT COUNT(*) FROM search_projection_documents),
          last_reindexed_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND reindex_status = 'building' AND reindex_cursor = ?
    `).bind(expectedCursor))
    .expectChanged("state.ready")
    .withBudget(3);
  try {
    await executeMutationBatch(env, plan);
  } catch (error) {
    if (isExpectedChangeAbort(error)) {
      return { ok: true, completed: false, processed: 0, cursorConflict: true };
    }
    throw error;
  }
  const state = await getSearchProjectionState(env);
  return {
    ok: true,
    completed: true,
    processed: 0,
    indexedDocumentCount: state.indexedDocumentCount
  };
}

function normalizedIds(documentIds) {
  return [...new Set((Array.isArray(documentIds) ? documentIds : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
}

export function isMissingProjectionSchema(error) {
  const message = String(error?.message || error || "");
  return /no such (?:table|column):\s*(?:main\.)?search_projection/i.test(message);
}
