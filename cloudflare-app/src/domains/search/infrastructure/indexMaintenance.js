import { FREE_TIER_BUDGET } from "../../../freeTierBudget.js";
import {
  DOCUMENT_BASE_JOINS,
  DOCUMENT_LOCATION_COLUMNS,
  DOCUMENT_TAG_CONCAT,
  DOCUMENT_TAG_JOINS
} from "../../../data/sqlShared.js";
import { buildSearchIndexTerms, normalizeSearchText } from "../../../data/searchData.js";
import { BatchPlan } from "../../../platform/d1/batchPlan.js";
import {
  exactChangeCountAssertionSql,
  expectedChangeAssertionSql,
  isExpectedChangeAbort
} from "../../../platform/d1/expectedChange.js";
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
      SELECT document_id, operation, event_version, source_version
      FROM search_index_outbox
      WHERE document_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        AND available_at <= CURRENT_TIMESTAMP
      ORDER BY available_at, updated_at, document_id
      LIMIT ?
    `).bind(JSON.stringify(targetIds), safeLimit)
    : env.DB.prepare(`
    SELECT document_id, operation, event_version, source_version
    FROM search_index_outbox
    WHERE available_at <= CURRENT_TIMESTAMP
    ORDER BY available_at, updated_at, document_id
    LIMIT ?
  `).bind(safeLimit);
  const outboxResult = await outboxStatement.all();
  const candidates = outboxResult.results ?? [];
  if (!candidates.length) return { ok: true, processed: 0 };

  const leaseOwner = crypto.randomUUID();
  if (!await claimSearchOutboxProcessor(env, leaseOwner)) {
    return { ok: true, skipped: true, processed: 0, reason: "SEARCH_OUTBOX_PROCESSOR_BUSY" };
  }
  let searchWriteStarted = false;
  try {
    const outbox = await claimSearchOutboxRows(env, candidates, leaseOwner, safeLimit);
    if (!outbox.length) return { ok: true, processed: 0 };
    const ids = outbox.map((item) => Number(item.document_id)).filter(Number.isInteger);
    const [documents, state] = await Promise.all([
      readSearchDocuments(env, ids),
      getCoreSearchState(env)
    ]);
    const v2State = await getSearchV2State(env.SEARCH_DB);
    if (state.rebuildRequired && !v2State) {
      await releaseSearchOutboxRows(env, outbox, leaseOwner);
      return {
        ok: false,
        skipped: true,
        processed: 0,
        reason: "검색 인덱스 전체 재구축 중에는 개별 변경을 outbox에 유지합니다."
      };
    }
    const nextGeneration = state.generation + 1;
    searchWriteStarted = true;
    const indexedCount = v2State
      ? await writeSearchOutboxDocumentsV2(
        env.SEARCH_DB,
        ids,
        documents,
        nextGeneration,
        outbox,
        v2State
      )
      : await writeSearchDocuments(env.SEARCH_DB, ids, documents, nextGeneration);
    await completeCoreOutbox(env, outbox, indexedCount, state.generation, nextGeneration, leaseOwner);
    return { ok: true, processed: ids.length, indexed: documents.length, indexedCount, generation: nextGeneration };
  } catch (error) {
    const owned = await readOwnedSearchOutboxRows(env, leaseOwner, safeLimit).catch(() => []);
    if (!searchWriteStarted) {
      await releaseSearchOutboxRows(env, owned, leaseOwner).catch(() => {});
      throw error;
    }
    if (error?.code === "STALE_VERSION") {
      await releaseSearchOutboxRows(env, owned, leaseOwner).catch(() => {});
      return { ok: false, retryable: true, processed: 0, reason: "SEARCH_OUTBOX_GENERATION_CHANGED" };
    }
    await markSearchOutboxFailure(env, owned, error, leaseOwner).catch(() => {});
    throw error;
  } finally {
    await releaseSearchOutboxProcessor(env, leaseOwner).catch(() => {});
  }
}

async function claimSearchOutboxProcessor(env, leaseOwner) {
  const plan = new BatchPlan("search-outbox-processor-claim")
    .step("processor.claim", env.DB.prepare(`
      UPDATE search_index_state
      SET processor_lease_owner = ?,
          processor_lease_expires_at = datetime(CURRENT_TIMESTAMP, '+2 minutes'),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
        AND (
          processor_lease_owner IS NULL
          OR processor_lease_expires_at IS NULL
          OR processor_lease_expires_at <= CURRENT_TIMESTAMP
          OR NOT EXISTS (
            SELECT 1
            FROM search_index_outbox claimed
            WHERE claimed.lease_owner = search_index_state.processor_lease_owner
              AND claimed.lease_event_version = claimed.event_version
              AND claimed.lease_expires_at > CURRENT_TIMESTAMP
          )
        )
    `).bind(leaseOwner))
    .expectChanged("processor.claim")
    .withBudget(1);
  try {
    await executeMutationBatch(env, plan);
    return true;
  } catch (error) {
    if (error?.code === "STALE_VERSION") return false;
    throw error;
  }
}

async function claimSearchOutboxRows(env, candidates, leaseOwner, limit) {
  const eventsJson = JSON.stringify(candidates.map((event) => ({
    documentId: Number(event.document_id),
    eventVersion: Number(event.event_version)
  })));
  const plan = new BatchPlan("search-outbox-row-claim")
    .step("rows.claim", env.DB.prepare(`
      UPDATE search_index_outbox
      SET lease_owner = ?,
          lease_event_version = event_version,
          lease_expires_at = datetime(CURRENT_TIMESTAMP, '+2 minutes'),
          updated_at = CURRENT_TIMESTAMP
      WHERE available_at <= CURRENT_TIMESTAMP
        AND (
          lease_expires_at IS NULL
          OR lease_expires_at <= CURRENT_TIMESTAMP
          OR lease_event_version IS NOT event_version
        )
        AND EXISTS (
          SELECT 1
          FROM json_each(?) event
          WHERE CAST(json_extract(event.value, '$.documentId') AS INTEGER) = search_index_outbox.document_id
            AND CAST(json_extract(event.value, '$.eventVersion') AS INTEGER) = search_index_outbox.event_version
        )
    `).bind(leaseOwner, eventsJson))
    .withBudget(1);
  await executeMutationBatch(env, plan);
  return readOwnedSearchOutboxRows(env, leaseOwner, limit);
}

async function readOwnedSearchOutboxRows(env, leaseOwner, limit) {
  const result = await env.DB.prepare(`
    SELECT document_id, operation, event_version, source_version
    FROM search_index_outbox
    WHERE lease_owner = ?
      AND lease_event_version = event_version
      AND lease_expires_at > CURRENT_TIMESTAMP
    ORDER BY available_at, updated_at, document_id
    LIMIT ?
  `).bind(leaseOwner, limit).all();
  return result.results ?? [];
}

async function releaseSearchOutboxRows(env, outbox, leaseOwner) {
  if (!outbox.length) return;
  const eventsJson = JSON.stringify(outbox.map((event) => ({
    documentId: Number(event.document_id),
    eventVersion: Number(event.event_version)
  })));
  const plan = new BatchPlan("search-outbox-row-release")
    .step("rows.release", env.DB.prepare(`
      UPDATE search_index_outbox
      SET lease_owner = NULL,
          lease_event_version = NULL,
          lease_expires_at = NULL,
          available_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE lease_owner = ?
        AND EXISTS (
          SELECT 1
          FROM json_each(?) event
          WHERE CAST(json_extract(event.value, '$.documentId') AS INTEGER) = search_index_outbox.document_id
            AND CAST(json_extract(event.value, '$.eventVersion') AS INTEGER) = search_index_outbox.event_version
        )
    `).bind(leaseOwner, eventsJson))
    .withBudget(1);
  await executeMutationBatch(env, plan);
}

async function releaseSearchOutboxProcessor(env, leaseOwner) {
  const plan = new BatchPlan("search-outbox-processor-release")
    .step("processor.release", env.DB.prepare(`
      UPDATE search_index_state
      SET processor_lease_owner = NULL,
          processor_lease_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND processor_lease_owner = ?
    `).bind(leaseOwner))
    .withBudget(1);
  await executeMutationBatch(env, plan);
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
  const [coreState, v2State] = await Promise.all([
    getCoreSearchState(env),
    getSearchV2State(env.SEARCH_DB)
  ]);
  if (v2State) {
    return rebuildSearchIndexV2Chunk(env, coreState, v2State, safeLimit);
  }
  const searchState = await env.SEARCH_DB.prepare(`
    SELECT generation, rebuild_status, last_document_id
    FROM search_runtime_state
    WHERE id = 1
  `).first();
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

async function rebuildSearchIndexV2Chunk(env, coreState, initialState, safeLimit) {
  let state = initialState;
  if (Number(state.cutover_generation || 0) > 0) {
    return reconcileSearchCutover(env, coreState, state);
  }
  if (!coreState.rebuildRequired && state.rebuild_status === "ready" && Number(state.v2_ready || 0) === 1) {
    await cleanupRetiredSearchGenerations(env.SEARCH_DB, state).catch(() => {});
    return {
      ok: true,
      completed: true,
      processed: 0,
      generation: coreState.generation,
      activeGeneration: Number(state.active_generation || 1)
    };
  }

  let buildingGeneration = Number(state.building_generation || 0);
  let lastDocumentId = Number(state.building_last_document_id || 0);
  if (!buildingGeneration || state.rebuild_status === "pending" || state.rebuild_status === "failed") {
    const claim = await claimSearchRebuild(env.SEARCH_DB, coreState, state);
    if (!claim.claimed) {
      return {
        ok: true,
        completed: false,
        processed: 0,
        leaseHeld: true,
        activeGeneration: Number(claim.state?.active_generation || state.active_generation || 1),
        buildingGeneration: Number(claim.state?.building_generation || 0)
      };
    }
    state = claim.state;
    buildingGeneration = Number(state.building_generation);
    lastDocumentId = 0;
  }

  const documents = await readSearchDocumentsAfter(env, lastDocumentId, safeLimit);
  if (documents.length) {
    const ids = documents.map((document) => Number(document.id));
    const nextDocumentId = Math.max(...ids);
    const sourceVersion = Number(state.building_source_version || coreState.sourceVersion);
    try {
      await writeSearchDocumentsV2(
        env.SEARCH_DB,
        ids,
        documents,
        [buildingGeneration],
        sourceVersion,
        {
          checkpoint: {
            token: state.rebuild_token,
            expectedLastDocumentId: lastDocumentId,
            nextDocumentId
          }
        }
      );
    } catch (error) {
      if (isExpectedChangeAbort(error)) {
        return {
          ok: true,
          completed: false,
          processed: 0,
          leaseHeld: true,
          activeGeneration: Number(state.active_generation || 1),
          buildingGeneration
        };
      }
      throw error;
    }
    return {
      ok: true,
      completed: false,
      processed: documents.length,
      lastDocumentId: nextDocumentId,
      generation: coreState.generation,
      activeGeneration: Number(state.active_generation || 1),
      buildingGeneration
    };
  }

  const [latestCoreState, pending, expected, indexed, latestSearchState] = await Promise.all([
    getCoreSearchState(env),
    env.DB.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").first(),
    env.SEARCH_DB.prepare(
      "SELECT COUNT(*) AS count FROM search_documents_v2 WHERE generation = ?"
    ).bind(buildingGeneration).first(),
    getSearchV2State(env.SEARCH_DB)
  ]);
  const pendingCount = Number(pending?.count || 0);
  const expectedCount = Number(expected?.count || 0);
  const indexedCount = Number(indexed?.count || 0);
  const sourceGeneration = Number(latestSearchState?.building_source_generation || 0);
  const sourceVersion = Number(latestSearchState?.building_source_version || 0);
  const tokenMatches = latestSearchState?.rebuild_token === state.rebuild_token
    && Number(latestSearchState?.building_generation || 0) === buildingGeneration;
  if (
    pendingCount > 0
    || latestCoreState.generation !== sourceGeneration
    || latestCoreState.sourceVersion !== sourceVersion
    || latestCoreState.generation !== Number(latestSearchState?.generation || 0)
  ) {
    if (pendingCount === 0) {
      await abandonSearchRebuild(env.SEARCH_DB, {
        buildingGeneration,
        token: state.rebuild_token
      });
    }
    return {
      ok: pendingCount > 0,
      completed: false,
      processed: 0,
      awaitingOutbox: pendingCount > 0,
      awaitingGenerationFence: false,
      reason: pendingCount > 0 ? undefined : "SEARCH_REBUILD_SOURCE_GENERATION_STALE",
      pendingOutboxCount: pendingCount,
      sourceGeneration,
      sourceVersion,
      coreGeneration: latestCoreState.generation,
      coreSourceVersion: latestCoreState.sourceVersion,
      activeGeneration: Number(state.active_generation || 1),
      buildingGeneration
    };
  }
  if (!tokenMatches || indexedCount !== expectedCount) {
    await env.SEARCH_DB.prepare(`
      UPDATE search_runtime_state
      SET rebuild_status = 'failed', updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND building_generation = ? AND rebuild_token = ?
    `).bind(buildingGeneration, state.rebuild_token).run();
    return {
      ok: false,
      completed: false,
      processed: 0,
      reason: tokenMatches ? "SEARCH_INDEX_COUNT_MISMATCH" : "SEARCH_REBUILD_LEASE_LOST",
      expectedCount,
      indexedCount,
      activeGeneration: Number(state.active_generation || 1),
      buildingGeneration
    };
  }

  const previousActiveGeneration = Number(latestSearchState.active_generation || 1);
  try {
    await env.SEARCH_DB.batch([
      env.SEARCH_DB.prepare(`
        UPDATE search_runtime_state
        SET previous_active_generation = active_generation,
            cutover_generation = ?,
            indexed_document_count = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
          AND active_generation = ?
          AND building_generation = ?
          AND building_source_generation = ?
          AND building_source_version = ?
          AND generation = ?
          AND rebuild_token = ?
          AND rebuild_status = 'building'
      `).bind(
        latestCoreState.generation,
        indexedCount,
        previousActiveGeneration,
        buildingGeneration,
        latestCoreState.generation,
        latestCoreState.sourceVersion,
        latestCoreState.generation,
        state.rebuild_token
      ),
      env.SEARCH_DB.prepare(expectedChangeAssertionSql())
    ]);
  } catch (error) {
    if (isExpectedChangeAbort(error)) {
      return {
        ok: true,
        completed: false,
        processed: 0,
        leaseHeld: true,
        activeGeneration: previousActiveGeneration,
        buildingGeneration
      };
    }
    throw error;
  }

  const plan = new BatchPlan("search-rebuild-v2-complete")
    .step("core-ready", env.DB.prepare(`
      UPDATE search_index_state
      SET rebuild_required = 0,
          indexed_document_count = ?,
          last_rebuilt_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
        AND generation = ?
        AND rebuild_required = 1
        AND NOT EXISTS (SELECT 1 FROM search_index_outbox)
        AND (SELECT current_version FROM search_event_clock WHERE id = 1) = ?
    `).bind(indexedCount, latestCoreState.generation, latestCoreState.sourceVersion))
    .expectChanged("core-ready");
  try {
    await executeMutationBatch(env, plan);
  } catch (error) {
    const observedCore = await getCoreSearchState(env).catch(() => null);
    if (observedCore && !observedCore.rebuildRequired) {
      return finalizeSearchCutover(env, {
        state: latestSearchState,
        buildingGeneration,
        cutoverGeneration: latestCoreState.generation,
        contentGeneration: observedCore.generation,
        sourceVersion: observedCore.sourceVersion,
        indexedCount
      });
    }
    if (!observedCore) throw error;
    await rollbackSearchCutover(env.SEARCH_DB, {
      previousActiveGeneration,
      buildingGeneration,
      contentGeneration: latestCoreState.generation,
      token: state.rebuild_token
    });
    return {
      ok: false,
      completed: false,
      processed: 0,
      reason: "CORE_READY_FENCE_CONFLICT",
      activeGeneration: previousActiveGeneration,
      buildingGeneration,
      generation: observedCore.generation,
      pendingOutboxCount: await readPendingOutboxCount(env)
    };
  }

  return finalizeSearchCutover(env, {
    state: latestSearchState,
    buildingGeneration,
    cutoverGeneration: latestCoreState.generation,
    contentGeneration: latestCoreState.generation,
    sourceVersion: latestCoreState.sourceVersion,
    indexedCount
  });
}

async function abandonSearchRebuild(searchDb, { buildingGeneration, token }) {
  await searchDb.prepare(`
    UPDATE search_runtime_state
    SET building_generation = NULL,
        building_last_document_id = 0,
        building_source_generation = NULL,
        building_source_version = NULL,
        rebuild_token = NULL,
        cutover_generation = NULL,
        rebuild_status = 'failed',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
      AND building_generation = ?
      AND rebuild_token = ?
      AND cutover_generation IS NULL
  `).bind(buildingGeneration, token).run();
}

async function claimSearchRebuild(searchDb, coreState, state) {
  const maxGeneration = await searchDb.prepare(`
    SELECT MAX(value) AS generation
    FROM (
      SELECT active_generation AS value FROM search_runtime_state WHERE id = 1
      UNION ALL
      SELECT previous_active_generation FROM search_runtime_state WHERE id = 1
      UNION ALL
      SELECT building_generation FROM search_runtime_state WHERE id = 1
      UNION ALL
      SELECT MAX(generation) FROM search_documents_v2
      UNION ALL
      SELECT MAX(physical_generation) FROM search_document_watermarks
    )
  `).first();
  const buildingGeneration = Math.max(1, Number(maxGeneration?.generation || 0) + 1);
  const token = crypto.randomUUID();
  try {
    await searchDb.batch([
      searchDb.prepare(`
        UPDATE search_runtime_state
        SET building_generation = ?,
            building_last_document_id = 0,
            building_source_generation = ?,
            building_source_version = ?,
            rebuild_token = ?,
            cutover_generation = NULL,
            rebuild_status = 'building',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
          AND active_generation = ?
          AND building_generation IS NULL
          AND rebuild_status IN ('pending', 'failed', 'ready')
      `).bind(
        buildingGeneration,
        coreState.generation,
        coreState.sourceVersion,
        token,
        Number(state.active_generation || 1)
      ),
      searchDb.prepare(expectedChangeAssertionSql()),
      searchDb.prepare("DELETE FROM search_documents_fts_v2 WHERE generation = ?").bind(buildingGeneration),
      searchDb.prepare("DELETE FROM search_documents_v2 WHERE generation = ?").bind(buildingGeneration),
      searchDb.prepare(
        "DELETE FROM search_document_watermarks WHERE physical_generation = ?"
      ).bind(buildingGeneration)
    ]);
  } catch (error) {
    if (!isExpectedChangeAbort(error)) throw error;
    return { claimed: false, state: await getSearchV2State(searchDb) };
  }
  return {
    claimed: true,
    state: {
      ...state,
      building_generation: buildingGeneration,
      building_last_document_id: 0,
      building_source_generation: coreState.generation,
      building_source_version: coreState.sourceVersion,
      rebuild_token: token,
      cutover_generation: null,
      rebuild_status: "building"
    }
  };
}

async function reconcileSearchCutover(env, coreState, state) {
  const buildingGeneration = Number(state.building_generation || 0);
  const cutoverGeneration = Number(state.cutover_generation || 0);
  if (
    buildingGeneration > 0
    && !coreState.rebuildRequired
  ) {
    return finalizeSearchCutover(env, {
      state,
      buildingGeneration,
      cutoverGeneration,
      contentGeneration: coreState.generation,
      sourceVersion: coreState.sourceVersion,
      indexedCount: Number(state.indexed_document_count || 0)
    });
  }

  const previousActiveGeneration = Number(state.previous_active_generation || 0);
  if (previousActiveGeneration > 0) {
    await rollbackSearchCutover(env.SEARCH_DB, {
      previousActiveGeneration,
      buildingGeneration,
      contentGeneration: cutoverGeneration,
      token: state.rebuild_token
    });
  }
  return {
    failed: true,
    ok: false,
    completed: false,
    processed: 0,
    reason: "SEARCH_CUTOVER_RECOVERY_ROLLBACK",
    activeGeneration: previousActiveGeneration || Number(state.active_generation || 1),
    buildingGeneration,
    generation: coreState.generation
  };
}

async function rollbackSearchCutover(searchDb, {
  previousActiveGeneration,
  buildingGeneration,
  contentGeneration,
  token
}) {
  await searchDb.prepare(`
    UPDATE search_runtime_state
    SET previous_active_generation = active_generation,
        building_generation = NULL,
        building_last_document_id = 0,
        building_source_generation = NULL,
        building_source_version = NULL,
        rebuild_token = NULL,
        cutover_generation = NULL,
        rebuild_status = 'failed',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
      AND active_generation = ?
      AND building_generation = ?
      AND cutover_generation = ?
      AND rebuild_token = ?
  `).bind(
    previousActiveGeneration,
    buildingGeneration,
    contentGeneration,
    token
  ).run();
}

async function finalizeSearchCutover(env, {
  state,
  buildingGeneration,
  cutoverGeneration,
  contentGeneration,
  sourceVersion,
  indexedCount
}) {
  const first = await tryFinalizeSearchCutover(env.SEARCH_DB, {
    state,
    buildingGeneration,
    cutoverGeneration,
    contentGeneration,
    sourceVersion,
    indexedCount
  });
  if (first.completed) return first;

  const [latest, latestCore, pending, expected, indexed] = await Promise.all([
    getSearchV2State(env.SEARCH_DB),
    getCoreSearchState(env),
    env.DB.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE sync_state = 'current'").first(),
    env.SEARCH_DB.prepare(
      "SELECT COUNT(*) AS count FROM search_documents_v2 WHERE generation = ?"
    ).bind(buildingGeneration).first()
  ]);
  const pendingCount = Number(pending?.count || 0);
  const expectedCount = Number(expected?.count || 0);
  const latestIndexedCount = Number(indexed?.count || 0);
  const safeLatestFence = latest
    && latest.rebuild_status === "building"
    && latest.rebuild_token === state.rebuild_token
    && Number(latest.active_generation || 0) ===
      Number(state.active_generation || state.previous_active_generation || 1)
    && Number(latest.building_generation || 0) === buildingGeneration
    && Number(latest.cutover_generation || 0) === cutoverGeneration
    && Number(latest.generation || 0) === latestCore.generation
    && Number(latest.building_source_generation || 0) === latestCore.generation
    && Number(latest.building_source_version || 0) === latestCore.sourceVersion
    && !latestCore.rebuildRequired
    && pendingCount === 0
    && latestIndexedCount === expectedCount;
  if (safeLatestFence) {
    const retried = await tryFinalizeSearchCutover(env.SEARCH_DB, {
      state: latest,
      buildingGeneration,
      cutoverGeneration,
      contentGeneration: latestCore.generation,
      sourceVersion: latestCore.sourceVersion,
      indexedCount: latestIndexedCount
    });
    if (retried.completed) return retried;
  }

  return {
    ok: true,
    completed: false,
    processed: 0,
    awaitingCutoverFence: true,
    pendingOutboxCount: pendingCount,
    generation: latestCore.generation,
    activeGeneration: Number(latest?.active_generation || state.active_generation || 1),
    buildingGeneration
  };
}

async function tryFinalizeSearchCutover(searchDb, {
  state,
  buildingGeneration,
  cutoverGeneration,
  contentGeneration,
  sourceVersion,
  indexedCount
}) {
  const token = state.rebuild_token;
  try {
    await searchDb.batch([
      searchDb.prepare(`
        UPDATE search_runtime_state
        SET active_generation = building_generation,
            building_generation = NULL,
            building_last_document_id = 0,
            building_source_generation = NULL,
            building_source_version = NULL,
            rebuild_token = NULL,
            cutover_generation = NULL,
            generation = ?,
            indexed_document_count = ?,
            rebuild_status = 'ready',
            v2_ready = 1,
            last_document_id = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
          AND active_generation = ?
          AND building_generation = ?
          AND cutover_generation = ?
          AND generation = ?
          AND building_source_generation = ?
          AND building_source_version = ?
          AND rebuild_token = ?
          AND rebuild_status = 'building'
      `).bind(
        contentGeneration,
        indexedCount,
        Number(state.active_generation || state.previous_active_generation || 1),
        buildingGeneration,
        cutoverGeneration,
        contentGeneration,
        contentGeneration,
        sourceVersion,
        token
      ),
      searchDb.prepare(expectedChangeAssertionSql())
    ]);
  } catch (error) {
    if (!isExpectedChangeAbort(error)) throw error;
    const latest = await getSearchV2State(searchDb);
    if (
      latest?.rebuild_status !== "ready"
      || Number(latest?.active_generation || 0) !== buildingGeneration
      || Number(latest?.generation || 0) < contentGeneration
    ) {
      return { completed: false };
    }
  }
  const readyState = await getSearchV2State(searchDb);
  await cleanupRetiredSearchGenerations(searchDb, readyState).catch(() => {});
  return {
    ok: true,
    completed: true,
    processed: 0,
    indexedCount,
    generation: contentGeneration,
    activeGeneration: buildingGeneration
  };
}

async function readPendingOutboxCount(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").first();
  return Number(row?.count || 0);
}

export async function cleanupRetiredSearchGenerations(searchDb, state = null) {
  if (!searchDb) return { ok: false, skipped: true };
  const runtime = state || await getSearchV2State(searchDb);
  if (!runtime) return { ok: false, skipped: true };
  const activeGeneration = Number(runtime.active_generation || 0);
  if (!activeGeneration) return { ok: false, skipped: true };
  const statements = [
    searchDb.prepare(`
      DELETE FROM search_documents_fts_v2
      WHERE CAST(generation AS INTEGER) NOT IN (
        SELECT CAST(active_generation AS INTEGER)
        FROM search_runtime_state
        WHERE id = 1
        UNION
        SELECT CAST(previous_active_generation AS INTEGER)
        FROM search_runtime_state
        WHERE id = 1 AND previous_active_generation IS NOT NULL
        UNION
        SELECT CAST(building_generation AS INTEGER)
        FROM search_runtime_state
        WHERE id = 1 AND building_generation IS NOT NULL
      )
    `),
    searchDb.prepare(`
      DELETE FROM search_documents_v2
      WHERE generation NOT IN (
        SELECT active_generation
        FROM search_runtime_state
        WHERE id = 1
        UNION
        SELECT previous_active_generation
        FROM search_runtime_state
        WHERE id = 1 AND previous_active_generation IS NOT NULL
        UNION
        SELECT building_generation
        FROM search_runtime_state
        WHERE id = 1 AND building_generation IS NOT NULL
      )
    `),
    searchDb.prepare(`
      DELETE FROM search_document_watermarks
      WHERE physical_generation NOT IN (
        SELECT active_generation
        FROM search_runtime_state
        WHERE id = 1
        UNION
        SELECT previous_active_generation
        FROM search_runtime_state
        WHERE id = 1 AND previous_active_generation IS NOT NULL
        UNION
        SELECT building_generation
        FROM search_runtime_state
        WHERE id = 1 AND building_generation IS NOT NULL
      )
    `)
  ];
  await searchDb.batch(statements);
  const latest = await getSearchV2State(searchDb);
  const retainedGenerations = [
    Number(latest?.active_generation || 0),
    Number(latest?.previous_active_generation || 0),
    Number(latest?.building_generation || 0)
  ].filter((value, index, values) => value > 0 && values.indexOf(value) === index);
  return { ok: true, retainedGenerations };
}

export async function getSearchOperationalState(env) {
  const core = await getCoreSearchState(env);
  const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM search_index_outbox").first();
  let search = null;
  if (env.SEARCH_DB) {
    try {
      search = await getSearchV2State(env.SEARCH_DB)
        || await env.SEARCH_DB.prepare(`
          SELECT generation, indexed_document_count, rebuild_status, updated_at
          FROM search_runtime_state
          WHERE id = 1
        `).first();
    } catch (error) {
      if (!isLegacySearchSchemaError(error)) throw error;
      search = null;
    }
  }
  return {
    ...core,
    pendingOutboxCount: Number(pending?.count || 0),
    searchAvailable: Boolean(search),
    searchGeneration: Number(search?.generation || 0),
    activeGeneration: Number(search?.active_generation || search?.generation || 0),
    buildingGeneration: Number(search?.building_generation || 0),
    previousActiveGeneration: Number(search?.previous_active_generation || 0),
    buildingSourceGeneration: Number(search?.building_source_generation || 0),
    buildingSourceVersion: Number(search?.building_source_version || 0),
    cutoverGeneration: Number(search?.cutover_generation || 0),
    v2Ready: Number(search?.v2_ready || 0) === 1,
    searchIndexedDocumentCount: Number(search?.indexed_document_count || 0),
    rebuildStatus: search?.rebuild_status || "unavailable",
    searchUpdatedAt: search?.updated_at || null
  };
}

async function getCoreSearchState(env) {
  const row = await env.DB.prepare(`
    SELECT
      generation,
      rebuild_required,
      indexed_document_count,
      last_rebuilt_at,
      updated_at,
      (SELECT current_version FROM search_event_clock WHERE id = 1) AS source_version
    FROM search_index_state
    WHERE id = 1
  `).first();
  return {
    generation: Math.max(1, Number(row?.generation || 1)),
    sourceVersion: Math.max(1, Number(row?.source_version || 1)),
    rebuildRequired: Number(row?.rebuild_required || 0) === 1,
    indexedDocumentCount: Number(row?.indexed_document_count || 0),
    lastRebuiltAt: row?.last_rebuilt_at || null,
    updatedAt: row?.updated_at || null
  };
}

async function getSearchV2State(searchDb) {
  try {
    return await searchDb.prepare(`
      SELECT
        generation,
        indexed_document_count,
        rebuild_status,
        updated_at,
        active_generation,
        building_generation,
        building_last_document_id,
        v2_ready,
        previous_active_generation,
        building_source_generation,
        building_source_version,
        rebuild_token,
        cutover_generation
      FROM search_runtime_state
      WHERE id = 1
    `).first();
  } catch (error) {
    if (isLegacySearchSchemaError(error)) return null;
    throw error;
  }
}

function isLegacySearchSchemaError(error) {
  const message = String(error?.message || error || "");
  return /no such (?:table|column):/i.test(message)
    || /has no column named/i.test(message);
}

function searchDocumentSelect({ after = false } = {}) {
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

async function readSearchDocumentsAfter(env, lastDocumentId, limit) {
  const result = await env.DB.prepare(searchDocumentSelect({ after: true }))
    .bind(lastDocumentId, limit)
    .all();
  return result.results ?? [];
}

async function readSearchDocuments(env, ids) {
  if (!ids.length) return [];
  const result = await env.DB.prepare(searchDocumentSelect())
    .bind(JSON.stringify(ids))
    .all();
  return result.results ?? [];
}

async function writeSearchOutboxDocumentsV2(
  searchDb,
  ids,
  documents,
  contentGeneration,
  outbox,
  state
) {
  const sourceVersions = new Map(outbox.map((event) => [
    Number(event.document_id),
    {
      sourceEventVersion: Number(event.source_version),
      sourceOutboxVersion: Number(event.event_version)
    }
  ]));
  const generations = [
    Number(state.active_generation || 1),
    Number(state.building_generation || 0)
  ].filter((value, index, values) => value > 0 && values.indexOf(value) === index);
  await writeSearchDocumentsV2(searchDb, ids, documents, generations, 0, {
    sourceVersions
  });
  await writeLegacySearchMirrorFromV2(searchDb, ids);
  const activeGeneration = Number(state.active_generation || 1);
  const count = await searchDb.prepare(
    "SELECT COUNT(*) AS count FROM search_documents_v2 WHERE generation = ?"
  ).bind(activeGeneration).first();
  const indexedCount = Number(count?.count || 0);
  const latestSourceVersion = Math.max(
    1,
    ...outbox.map((event) => Number(event.source_version) || 0)
  );
  await searchDb.prepare(`
    UPDATE search_runtime_state
    SET generation = MAX(generation, ?),
        building_source_generation = CASE
          WHEN building_generation IS NULL THEN building_source_generation
          ELSE MAX(COALESCE(building_source_generation, 0), ?)
        END,
        building_source_version = CASE
          WHEN building_generation IS NULL THEN building_source_version
          ELSE MAX(COALESCE(building_source_version, 0), ?)
        END,
        indexed_document_count = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).bind(
    contentGeneration,
    contentGeneration,
    latestSourceVersion,
    indexedCount
  ).run();
  return indexedCount;
}

async function writeSearchDocumentsV2(
  searchDb,
  processedIds,
  documents,
  generations,
  sourceEventVersion,
  {
    checkpoint = null,
    sourceVersions = null
  } = {}
) {
  const documentsById = new Map(documents.map((document) => [Number(document.id), document]));
  const writeToken = crypto.randomUUID();
  const payload = JSON.stringify(generations.flatMap((generation) =>
    processedIds.map((documentId) => {
      const document = documentsById.get(Number(documentId));
      const eventVersion = sourceVersions?.get(Number(documentId)) || {
        sourceEventVersion,
        sourceOutboxVersion: 0
      };
      return document
        ? {
            ...searchDocumentPayload(
              document,
              generation,
              eventVersion.sourceEventVersion,
              eventVersion.sourceOutboxVersion
            ),
            writeToken,
            isDeleted: 0
          }
        : {
            generation,
            documentId: Number(documentId),
            sourceEventVersion: Math.max(0, Number(eventVersion.sourceEventVersion) || 0),
            sourceOutboxVersion: Math.max(0, Number(eventVersion.sourceOutboxVersion) || 0),
            writeToken,
            isDeleted: 1
          };
    })
  ));
  const statements = [
    searchDb.prepare(`
      INSERT INTO search_document_watermarks (
        physical_generation, document_id, source_event_version,
        source_outbox_version, write_token, is_deleted, updated_at
      )
      SELECT
        CAST(json_extract(value, '$.generation') AS INTEGER),
        CAST(json_extract(value, '$.documentId') AS INTEGER),
        CAST(json_extract(value, '$.sourceEventVersion') AS INTEGER),
        CAST(json_extract(value, '$.sourceOutboxVersion') AS INTEGER),
        json_extract(value, '$.writeToken'),
        CAST(json_extract(value, '$.isDeleted') AS INTEGER),
        CURRENT_TIMESTAMP
      FROM json_each(?)
      WHERE 1
      ON CONFLICT(physical_generation, document_id) DO UPDATE SET
        source_event_version = excluded.source_event_version,
        source_outbox_version = excluded.source_outbox_version,
        write_token = excluded.write_token,
        is_deleted = excluded.is_deleted,
        updated_at = CURRENT_TIMESTAMP
      WHERE excluded.source_event_version > search_document_watermarks.source_event_version
    `).bind(payload),
    searchDb.prepare(`
      DELETE FROM search_documents_fts_v2
      WHERE EXISTS (
        SELECT 1
        FROM json_each(?) event
        JOIN search_document_watermarks watermark
          ON watermark.physical_generation = CAST(json_extract(event.value, '$.generation') AS INTEGER)
         AND watermark.document_id = CAST(json_extract(event.value, '$.documentId') AS INTEGER)
         AND watermark.source_event_version = CAST(json_extract(event.value, '$.sourceEventVersion') AS INTEGER)
         AND watermark.source_outbox_version = CAST(json_extract(event.value, '$.sourceOutboxVersion') AS INTEGER)
         AND watermark.write_token = json_extract(event.value, '$.writeToken')
        WHERE CAST(search_documents_fts_v2.generation AS INTEGER) = watermark.physical_generation
          AND search_documents_fts_v2.document_id = watermark.document_id
      )
    `).bind(payload),
    searchDb.prepare(`
      DELETE FROM search_documents_v2
      WHERE EXISTS (
        SELECT 1
        FROM json_each(?) event
        JOIN search_document_watermarks watermark
          ON watermark.physical_generation = CAST(json_extract(event.value, '$.generation') AS INTEGER)
         AND watermark.document_id = CAST(json_extract(event.value, '$.documentId') AS INTEGER)
         AND watermark.source_event_version = CAST(json_extract(event.value, '$.sourceEventVersion') AS INTEGER)
         AND watermark.source_outbox_version = CAST(json_extract(event.value, '$.sourceOutboxVersion') AS INTEGER)
         AND watermark.write_token = json_extract(event.value, '$.writeToken')
        WHERE search_documents_v2.generation = watermark.physical_generation
          AND search_documents_v2.document_id = watermark.document_id
          AND search_documents_v2.source_event_version <= watermark.source_event_version
      )
    `).bind(payload),
    searchDb.prepare(`
      INSERT INTO search_documents_v2 (
        generation, document_id, document_number, revision_number, document_name,
        category_id, category_name, status, rack_id, rack_code, zone_number,
        rack_face, column_number, shelf_number, tags_json, tag_names,
        normalized_text, updated_at, source_event_version
        , source_outbox_version
      )
      SELECT
        CAST(json_extract(value, '$.generation') AS INTEGER),
        CAST(json_extract(value, '$.documentId') AS INTEGER),
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
        CAST(json_extract(value, '$.sourceEventVersion') AS INTEGER),
        CAST(json_extract(value, '$.sourceOutboxVersion') AS INTEGER)
      FROM json_each(?) event
      WHERE CAST(json_extract(event.value, '$.isDeleted') AS INTEGER) = 0
        AND EXISTS (
          SELECT 1
          FROM search_document_watermarks watermark
          WHERE watermark.physical_generation =
              CAST(json_extract(event.value, '$.generation') AS INTEGER)
            AND watermark.document_id =
              CAST(json_extract(event.value, '$.documentId') AS INTEGER)
            AND watermark.source_event_version =
              CAST(json_extract(event.value, '$.sourceEventVersion') AS INTEGER)
            AND watermark.source_outbox_version =
              CAST(json_extract(event.value, '$.sourceOutboxVersion') AS INTEGER)
            AND watermark.write_token = json_extract(event.value, '$.writeToken')
            AND watermark.is_deleted = 0
        )
    `).bind(payload),
    searchDb.prepare(`
      INSERT INTO search_documents_fts_v2 (generation, document_id, normalized_text)
      SELECT
        CAST(json_extract(value, '$.generation') AS INTEGER),
        CAST(json_extract(value, '$.documentId') AS INTEGER),
        json_extract(value, '$.normalizedText')
      FROM json_each(?) event
      WHERE CAST(json_extract(event.value, '$.isDeleted') AS INTEGER) = 0
        AND EXISTS (
          SELECT 1
          FROM search_documents_v2 document
          JOIN search_document_watermarks watermark
            ON watermark.physical_generation = document.generation
           AND watermark.document_id = document.document_id
          WHERE document.generation =
              CAST(json_extract(event.value, '$.generation') AS INTEGER)
            AND document.document_id =
              CAST(json_extract(event.value, '$.documentId') AS INTEGER)
            AND document.source_event_version =
              CAST(json_extract(event.value, '$.sourceEventVersion') AS INTEGER)
            AND document.source_outbox_version =
              CAST(json_extract(event.value, '$.sourceOutboxVersion') AS INTEGER)
            AND watermark.write_token = json_extract(event.value, '$.writeToken')
        )
    `).bind(payload)
  ];
  if (checkpoint) {
    statements.push(
      searchDb.prepare(`
        UPDATE search_runtime_state
        SET building_last_document_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
          AND building_generation = ?
          AND building_last_document_id = ?
          AND rebuild_token = ?
          AND rebuild_status = 'building'
      `).bind(
        checkpoint.nextDocumentId,
        Number(generations[0]),
        checkpoint.expectedLastDocumentId,
        checkpoint.token
      ),
      searchDb.prepare(expectedChangeAssertionSql())
    );
  }
  await searchDb.batch(statements);
}

async function writeLegacySearchMirrorFromV2(searchDb, processedIds) {
  const idsJson = JSON.stringify(processedIds);
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
        document.document_id,
        runtime.generation,
        document.document_number,
        document.revision_number,
        document.document_name,
        document.category_name,
        document.rack_code,
        document.tag_names,
        document.normalized_text,
        document.updated_at
      FROM search_documents_v2 document
      JOIN search_runtime_state runtime ON runtime.id = 1
      WHERE document.generation = runtime.active_generation
        AND document.document_id IN (
          SELECT CAST(value AS INTEGER) FROM json_each(?)
        )
    `).bind(idsJson),
    searchDb.prepare(`
      INSERT INTO search_documents_fts (document_id, normalized_text)
      SELECT document_id, normalized_text
      FROM search_documents
      WHERE document_id IN (
        SELECT CAST(value AS INTEGER) FROM json_each(?)
      )
    `).bind(idsJson)
  ]);
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

async function completeCoreOutbox(env, outbox, indexedCount, expectedGeneration, nextGeneration, leaseOwner) {
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
        AND lease_owner = ?
        AND lease_event_version = event_version
    `).bind(eventsJson, leaseOwner))
    .step(
      "remove-processed-count",
      env.DB.prepare(exactChangeCountAssertionSql(String(outbox.length)))
    )
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

async function markSearchOutboxFailure(env, outbox, error, leaseOwner) {
  if (!outbox.length) return;
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
        lease_owner = NULL,
        lease_event_version = NULL,
        lease_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE lease_owner = ?
      AND EXISTS (
      SELECT 1
      FROM json_each(?) event
      WHERE CAST(json_extract(event.value, '$.documentId') AS INTEGER) = search_index_outbox.document_id
        AND CAST(json_extract(event.value, '$.eventVersion') AS INTEGER) = search_index_outbox.event_version
    )
  `).bind(message, leaseOwner, eventsJson).run();
}

function searchDocumentPayload(
  document,
  generation,
  sourceEventVersion = 0,
  sourceOutboxVersion = 0
) {
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
    sourceEventVersion: Math.max(0, Number(sourceEventVersion) || 0),
    sourceOutboxVersion: Math.max(0, Number(sourceOutboxVersion) || 0),
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
