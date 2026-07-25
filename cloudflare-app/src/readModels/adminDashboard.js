import { getDocumentCapacity, getDocumentQualitySummary } from "../domains/documents/index.js";
import { getAppUsers } from "../domains/identity/index.js";
import { getSearchIndexStats, getSearchOperationalState } from "../domains/search/index.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";

const EXPECTED_CORE_MIGRATION = "0045_user_role_templates.sql";
const EXPECTED_SEARCH_MIGRATION = "0003_rebuild_barriers_and_watermarks.sql";

export async function loadAdminDashboardReadModel(env, session) {
  const canViewAudit = hasPermission(session, PERMISSIONS.VIEW_AUDIT);
  const [users, quality, capacity, searchIndex, readiness] = await Promise.all([
    hasPermission(session, PERMISSIONS.MANAGE_USERS) ? getAppUsers(env) : Promise.resolve([]),
    hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS) ? getDocumentQualitySummary(env) : Promise.resolve(null),
    hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS) ? getDocumentCapacity(env) : Promise.resolve(null),
    canViewAudit ? getSearchIndexStats(env) : Promise.resolve(null),
    canViewAudit ? loadOperationalReadinessReadModel(env) : Promise.resolve(null)
  ]);

  const result = {
    pendingCount: users.filter((user) => user.status === "pending").length,
    quality,
    searchIndex: searchIndex && readiness
      ? { ...searchIndex, ...readiness.search, readiness, level: readiness.ok ? searchIndex.level : "warning" }
      : searchIndex
  };
  if (capacity) result.capacity = capacity;
  if (readiness) result.readiness = readiness;
  return Object.freeze(result);
}

export async function loadOperationalReadinessReadModel(env) {
  const [coreMigration, searchMigration, search] = await Promise.all([
    readLatestMigration(env.DB),
    readLatestMigration(env.SEARCH_DB),
    getSearchOperationalState(env)
  ]);
  const checks = Object.freeze({
    coreDatabase: migrationAtLeast(coreMigration, EXPECTED_CORE_MIGRATION),
    searchDatabase: migrationAtLeast(searchMigration, EXPECTED_SEARCH_MIGRATION),
    searchOperational: isSearchOperational(search)
  });
  const migrations = Object.freeze({
    core: Object.freeze({ current: coreMigration, expected: EXPECTED_CORE_MIGRATION, ready: checks.coreDatabase }),
    search: Object.freeze({ current: searchMigration, expected: EXPECTED_SEARCH_MIGRATION, ready: checks.searchDatabase })
  });
  const searchDetails = Object.freeze({
    generation: search.generation,
    searchGeneration: search.searchGeneration,
    activeGeneration: search.activeGeneration,
    indexedDocumentCount: search.indexedDocumentCount,
    searchIndexedDocumentCount: search.searchIndexedDocumentCount,
    pendingOutboxCount: search.pendingOutboxCount,
    searchAvailable: search.searchAvailable,
    rebuildRequired: search.rebuildRequired,
    rebuildStatus: search.rebuildStatus,
    v2Ready: search.v2Ready
  });
  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    checks,
    migrations,
    search: searchDetails
  });
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

function migrationAtLeast(current, expected) {
  const currentSequence = migrationSequence(current);
  const expectedSequence = migrationSequence(expected);
  return expectedSequence >= 0 && currentSequence >= expectedSequence;
}

function migrationSequence(name) {
  const match = /^(\d{4})_/.exec(String(name || ""));
  return match ? Number(match[1]) : -1;
}

function isSearchOperational(state) {
  // 기존 index는 무료 티어 Cron이 v2 shadow rebuild를 마칠 때까지 read path로 유지한다.
  const sharedReady = state.searchAvailable
    && !state.rebuildRequired
    && state.rebuildStatus === "ready"
    && state.pendingOutboxCount === 0
    && state.generation === state.searchGeneration
    && state.indexedDocumentCount === state.searchIndexedDocumentCount;
  return sharedReady && (!state.v2Ready || state.activeGeneration >= 1);
}
