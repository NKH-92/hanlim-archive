import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import {
  DOCUMENT_BASE_JOINS,
  DOCUMENT_LOCATION_COLUMNS,
  DOCUMENT_TAG_CONCAT,
  DOCUMENT_TAG_JOINS
} from "../../../data/sqlShared.js";
import { buildSearchIndexTerms, normalizeSearchText } from "../../../data/searchData.js";
import { BatchPlan } from "../../../platform/d1/batchPlan.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";

export async function processSearchOutbox(env, {
  limit = FREE_TIER_BUDGET.searchOutboxCronChunkSize,
  documentId = 0
} = {}) {
  const targetId = Number(documentId);
  const documentIds = Number.isInteger(targetId) && targetId > 0 ? [targetId] : [];
  return processSearchOutboxBatch(env, {
    limit,
    documentIds,
    maxLimit: FREE_TIER_BUDGET.searchOutboxCronChunkSize
  });
}

export function processSearchOutboxForDocument(env, documentId) {
  return processSearchOutboxForDocuments(env, [documentId]);
}

export function processSearchOutboxForDocuments(env, documentIds) {
  const ids = normalizedDocumentIds(documentIds);
  if (!ids.length) {
    return Promise.resolve({ ok: false, skipped: true, processed: 0, reason: "유효한 문서 ID가 필요합니다." });
  }
  return processSearchOutboxBatch(env, {
    limit: ids.length,
    documentIds: ids,
    maxLimit: FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems
  });
}

export function processPendingSearchOutboxImmediately(env, {
  limit = FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems
} = {}) {
  return processSearchOutboxBatch(env, {
    limit,
    documentIds: [],
    maxLimit: FREE_TIER_BUDGET.excelSnapshotDeltaMaxItems
  });
}

async function processSearchOutboxBatch(env, {
  limit,
  documentIds,
  maxLimit
}) {
  if (!env.SEARCH_DB) return { ok: false, skipped: true, reason: "SEARCH_DB binding이 없습니다." };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, maxLimit));
  const targetIds = normalizedDocumentIds(documentIds).slice(0, safeLimit);
  const outboxStatement = targetIds.length
    ? env.DB.prepare(`
      SELECT document_id, operation, event_version
      FROM search_index_outbox
      WHERE document_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        AND available_at <= CURRENT_TIMESTAMP
      ORDER BY available_at, updated_at, document_id
      LIMIT ?
    `).bind(JSON.stringify(targetIds), safeLimit)
    : env.DB.prepare(`
    SELECT document_id, operation, event_version
    FROM search_index_outbox
    WHERE available_at <= CURRENT_TIMESTAMP
    ORDER BY available_at, updated_at, document_id
    LIMIT ?
  `).bind(safeLimit);
  const outboxResult = await outboxStatement.all();
  const outbox = outboxResult.results ?? [];
  if (!outbox.length) return { ok: true, processed: 0 };

  const ids = outbox.map((item) => Number(item.document_id)).filter(Number.isInteger);
  const [documents, state] = await Promise.all([
    readSearchDocuments(env, ids),
    getCoreSearchState(env)
  ]);
  if (state.rebuildRequired) {
    return {
      ok: false,
      skipped: true,
      processed: 0,
      reason: "검색 인덱스 전체 재구축 중에는 개별 변경을 outbox에 유지합니다."
    };
  }
  const nextGeneration = state.generation + 1;
  try {
    const indexedCount = await writeSearchDocuments(env.SEARCH_DB, ids, documents, nextGeneration);
    await completeCoreOutbox(env, outbox, indexedCount, state.generation, nextGeneration);
    return { ok: true, processed: ids.length, indexed: documents.length, indexedCount, generation: nextGeneration };
  } catch (error) {
    await markSearchOutboxFailure(env, outbox, error).catch(() => {});
    throw error;
  }
}

function normalizedDocumentIds(documentIds) {
  return [...new Set((Array.isArray(documentIds) ? documentIds : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
}

export async function rebuildSearchIndexChunk(env, {
  limit = FREE_TIER_BUDGET.searchRebuildChunkSize
} = {}) {
  if (!env.SEARCH_DB) return { ok: false, skipped: true, reason: "SEARCH_DB binding이 없습니다." };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, FREE_TIER_BUDGET.searchRebuildChunkSize));
  const [coreState, searchState] = await Promise.all([
    getCoreSearchState(env),
    env.SEARCH_DB.prepare(`
      SELECT generation, rebuild_status, last_document_id
      FROM search_runtime_state
      WHERE id = 1
    `).first()
  ]);
  if (!coreState.rebuildRequired && searchState?.rebuild_status === "ready") {
    return { ok: true, completed: true, processed: 0, generation: coreState.generation };
  }

  let lastDocumentId = Number(searchState?.last_document_id || 0);
  if (
    Number(searchState?.generation || 0) !== coreState.generation ||
    searchState?.rebuild_status === "pending" ||
    searchState?.rebuild_status === "failed"
  ) {
    await env.SEARCH_DB.batch([
      env.SEARCH_DB.prepare("DELETE FROM search_documents_fts"),
      env.SEARCH_DB.prepare("DELETE FROM search_documents"),
      env.SEARCH_DB.prepare(`
        UPDATE search_runtime_state
        SET generation = ?, indexed_document_count = 0, rebuild_status = 'building',
            last_document_id = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).bind(coreState.generation)
    ]);
    lastDocumentId = 0;
  }

  const result = await env.DB.prepare(`
    SELECT
      d.id,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.updated_at,
      ${DOCUMENT_LOCATION_COLUMNS}
      ${DOCUMENT_TAG_CONCAT}
    ${DOCUMENT_BASE_JOINS}
    ${DOCUMENT_TAG_JOINS}
    WHERE d.sync_state = 'current' AND d.id > ?
    GROUP BY d.id
    ORDER BY d.id
    LIMIT ?
  `).bind(lastDocumentId, safeLimit).all();
  const documents = result.results ?? [];
  if (!documents.length) {
    const countRow = await env.SEARCH_DB.prepare("SELECT COUNT(*) AS count FROM search_documents").first();
    const indexedCount = Number(countRow?.count || 0);
    await env.SEARCH_DB.prepare(`
      UPDATE search_runtime_state
      SET rebuild_status = 'ready', indexed_document_count = ?,
          last_document_id = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND generation = ?
    `).bind(indexedCount, coreState.generation).run();
    const plan = new BatchPlan("search-rebuild-complete")
      .step("core-ready", env.DB.prepare(`
        UPDATE search_index_state
        SET rebuild_required = 0, indexed_document_count = ?,
            last_rebuilt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1 AND generation = ?
      `).bind(indexedCount, coreState.generation));
    await executeMutationBatch(env, plan);
    return { ok: true, completed: true, processed: 0, indexedCount, generation: coreState.generation };
  }

  const ids = documents.map((document) => Number(document.id));
  await writeSearchDocuments(env.SEARCH_DB, ids, documents, coreState.generation, {
    lastDocumentId: Math.max(...ids),
    rebuilding: true
  });
  return {
    ok: true,
    completed: false,
    processed: documents.length,
    lastDocumentId: Math.max(...ids),
    generation: coreState.generation
  };
}

export async function getSearchOperationalState(env) {
  const core = await getCoreSearchState(env);
  const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").first();
  let search = null;
  if (env.SEARCH_DB) {
    try {
      search = await env.SEARCH_DB.prepare(`
        SELECT generation, indexed_document_count, rebuild_status, updated_at
        FROM search_runtime_state
        WHERE id = 1
      `).first();
    } catch {
      search = null;
    }
  }
  return {
    ...core,
    pendingOutboxCount: Number(pending?.count || 0),
    searchAvailable: Boolean(search),
    searchGeneration: Number(search?.generation || 0),
    searchIndexedDocumentCount: Number(search?.indexed_document_count || 0),
    rebuildStatus: search?.rebuild_status || "unavailable",
    searchUpdatedAt: search?.updated_at || null
  };
}

async function getCoreSearchState(env) {
  const row = await env.DB.prepare(`
    SELECT generation, rebuild_required, indexed_document_count, last_rebuilt_at, updated_at
    FROM search_index_state
    WHERE id = 1
  `).first();
  return {
    generation: Math.max(1, Number(row?.generation || 1)),
    rebuildRequired: Number(row?.rebuild_required || 0) === 1,
    indexedDocumentCount: Number(row?.indexed_document_count || 0),
    lastRebuiltAt: row?.last_rebuilt_at || null,
    updatedAt: row?.updated_at || null
  };
}

async function readSearchDocuments(env, ids) {
  if (!ids.length) return [];
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      d.document_number,
      d.revision_number,
      d.document_name,
      d.updated_at,
      ${DOCUMENT_LOCATION_COLUMNS}
      ${DOCUMENT_TAG_CONCAT}
    ${DOCUMENT_BASE_JOINS}
    ${DOCUMENT_TAG_JOINS}
    WHERE d.sync_state = 'current'
      AND d.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    GROUP BY d.id
  `).bind(JSON.stringify(ids)).all();
  return result.results ?? [];
}

async function writeSearchDocuments(searchDb, processedIds, documents, generation, {
  lastDocumentId = 0,
  rebuilding = false
} = {}) {
  const idsJson = JSON.stringify(processedIds);
  const payload = JSON.stringify(documents.map((document) => searchDocumentPayload(document, generation)));
  await searchDb.batch([
    searchDb.prepare(`
      DELETE FROM search_documents_fts
      WHERE document_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    `).bind(idsJson),
    searchDb.prepare(`
      DELETE FROM search_documents
      WHERE document_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    `).bind(idsJson),
    searchDb.prepare(`
      INSERT INTO search_documents (
        document_id, generation, document_number, revision_number, document_name,
        category_name, rack_code, tag_names, normalized_text, updated_at
      )
      SELECT
        CAST(json_extract(value, '$.documentId') AS INTEGER),
        CAST(json_extract(value, '$.generation') AS INTEGER),
        json_extract(value, '$.documentNumber'),
        json_extract(value, '$.revisionNumber'),
        json_extract(value, '$.documentName'),
        json_extract(value, '$.categoryName'),
        json_extract(value, '$.rackCode'),
        json_extract(value, '$.tagNames'),
        json_extract(value, '$.normalizedText'),
        json_extract(value, '$.updatedAt')
      FROM json_each(?)
      WHERE 1
      ON CONFLICT(document_id) DO UPDATE SET
        generation = excluded.generation,
        document_number = excluded.document_number,
        revision_number = excluded.revision_number,
        document_name = excluded.document_name,
        category_name = excluded.category_name,
        rack_code = excluded.rack_code,
        tag_names = excluded.tag_names,
        normalized_text = excluded.normalized_text,
        updated_at = excluded.updated_at
    `).bind(payload),
    searchDb.prepare(`
      INSERT INTO search_documents_fts (document_id, normalized_text)
      SELECT
        CAST(json_extract(value, '$.documentId') AS INTEGER),
        json_extract(value, '$.normalizedText')
      FROM json_each(?)
    `).bind(payload),
    searchDb.prepare(`
      UPDATE search_runtime_state
      SET generation = ?,
          indexed_document_count = (SELECT COUNT(*) FROM search_documents),
          rebuild_status = ?,
          last_document_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(generation, rebuilding ? "building" : "ready", lastDocumentId)
  ]);
  const count = await searchDb.prepare("SELECT COUNT(*) AS count FROM search_documents").first();
  return Number(count?.count || 0);
}

async function completeCoreOutbox(env, outbox, indexedCount, expectedGeneration, nextGeneration) {
  const eventsJson = JSON.stringify(outbox.map((event) => ({
    documentId: Number(event.document_id),
    eventVersion: Number(event.event_version)
  })));
  const plan = new BatchPlan("search-outbox-complete")
    .step("remove-processed", env.DB.prepare(`
      DELETE FROM search_index_outbox
      WHERE EXISTS (
        SELECT 1
        FROM json_each(?) event
        WHERE CAST(json_extract(event.value, '$.documentId') AS INTEGER) = search_index_outbox.document_id
          AND CAST(json_extract(event.value, '$.eventVersion') AS INTEGER) = search_index_outbox.event_version
      )
    `).bind(eventsJson))
    .step("record-progress", env.DB.prepare(`
      UPDATE search_index_state
      SET generation = ?,
          indexed_document_count = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND generation = ?
    `).bind(nextGeneration, indexedCount, expectedGeneration))
    .expectChanged("record-progress");
  await executeMutationBatch(env, plan);
}

async function markSearchOutboxFailure(env, outbox, error) {
  const eventsJson = JSON.stringify(outbox.map((event) => ({
    documentId: Number(event.document_id),
    eventVersion: Number(event.event_version)
  })));
  const message = String(error?.message || "SEARCH_INDEX_SYNC_FAILED").slice(0, 500);
  await env.DB.prepare(`
    UPDATE search_index_outbox
    SET attempt_count = attempt_count + 1,
        available_at = datetime(CURRENT_TIMESTAMP, '+5 minutes'),
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE EXISTS (
      SELECT 1
      FROM json_each(?) event
      WHERE CAST(json_extract(event.value, '$.documentId') AS INTEGER) = search_index_outbox.document_id
        AND CAST(json_extract(event.value, '$.eventVersion') AS INTEGER) = search_index_outbox.event_version
    )
  `).bind(message, eventsJson).run();
}

function searchDocumentPayload(document, generation) {
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
    generation,
    documentNumber: String(document.document_number || ""),
    revisionNumber: String(document.revision_number || ""),
    documentName: String(document.document_name || ""),
    categoryName: String(document.category_name || ""),
    rackCode: String(document.rack_code || ""),
    tagNames: String(document.tag_names || ""),
    normalizedText: `${normalized} ${terms.join(" ")}`.trim(),
    updatedAt: String(document.updated_at || "")
  };
}
