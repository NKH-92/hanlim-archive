import { getSearchOperationalState } from "../domains/search/index.js";
import { logError } from "../platform/observability/logger.js";

const EXPECTED_CORE_MIGRATION = "0043_release_identity_and_search_leases.sql";
const EXPECTED_SEARCH_MIGRATION = "0003_rebuild_barriers_and_watermarks.sql";
const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});

export async function handleReadinessCheck(env) {
  const workerVersion = String(env.CF_VERSION_METADATA?.id || "").trim() || null;
  try {
    const [coreMigration, searchMigration, search] = await Promise.all([
      readLatestMigration(env.DB),
      readLatestMigration(env.SEARCH_DB),
      getSearchOperationalState(env)
    ]);
    const checks = {
      coreDatabase: coreMigration === EXPECTED_CORE_MIGRATION,
      searchDatabase: searchMigration === EXPECTED_SEARCH_MIGRATION,
      searchOperational: isSearchOperational(search)
    };
    const ok = Object.values(checks).every(Boolean);
    return jsonResponse({
      ok,
      workerVersion,
      checks,
      search: {
        generation: search.generation,
        activeGeneration: search.activeGeneration,
        indexedDocumentCount: search.searchIndexedDocumentCount,
        pendingOutboxCount: search.pendingOutboxCount
      }
    }, ok ? 200 : 503);
  } catch (error) {
    logError("worker.readyz", error);
    return jsonResponse({ ok: false, workerVersion }, 503);
  }
}

async function readLatestMigration(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("D1 database binding이 필요합니다.");
  }
  const row = await database.prepare(`
    SELECT name
    FROM d1_migrations
    ORDER BY id DESC
    LIMIT 1
  `).first();
  return String(row?.name || "");
}

function isSearchOperational(state) {
  return state.searchAvailable
    && state.v2Ready
    && !state.rebuildRequired
    && state.rebuildStatus === "ready"
    && state.pendingOutboxCount === 0
    && state.generation === state.searchGeneration
    && state.activeGeneration >= 1
    && state.indexedDocumentCount === state.searchIndexedDocumentCount;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
