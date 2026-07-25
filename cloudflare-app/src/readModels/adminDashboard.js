import { getDocumentCapacity, getDocumentQualitySummary } from "../domains/documents/index.js";
import { getAppUsers } from "../domains/identity/index.js";
import {
  getSearchIndexStats,
  getSearchOperationalState,
  getSearchProjectionState
} from "../domains/search/index.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";

const EXPECTED_CORE_MIGRATION = "0048_core_search_projection.sql";
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
      ? {
          ...searchIndex,
          ...readiness.search,
          readiness,
          level: readiness.degraded ? "warning" : searchIndex.level
        }
      : searchIndex
  };
  if (capacity) result.capacity = capacity;
  if (readiness) result.readiness = readiness;
  return Object.freeze(result);
}

/**
 * 배포 준비 판정.
 *
 * 필수 조건은 Core D1 schema 도달성뿐이다. 검색 색인은 재구축 가능한 파생 데이터이므로
 * 동기화 지연을 readiness 실패로 올리지 않는다. 파생 색인의 지연을 배포 게이트로 쓰면
 * 파생 데이터 지연이 곧 서비스 중단 판정이 되어 격리 원칙과 반대로 작동한다.
 * 색인 지연·legacy Search D1 상태는 warnings로 노출하고 관리자 화면에서 확인한다.
 */
export async function loadOperationalReadinessReadModel(env) {
  const [coreMigration, projection, search] = await Promise.all([
    readLatestMigration(env.DB),
    readProjectionReadiness(env),
    readLegacySearchReadiness(env)
  ]);
  const checks = Object.freeze({
    coreDatabase: migrationAtLeast(coreMigration, EXPECTED_CORE_MIGRATION)
  });
  const warnings = Object.freeze({
    searchProjectionSynced: projection.ready,
    searchDatabase: search.migrationReady,
    searchOperational: search.operational
  });
  const migrations = Object.freeze({
    core: Object.freeze({ current: coreMigration, expected: EXPECTED_CORE_MIGRATION, ready: checks.coreDatabase }),
    search: Object.freeze({
      current: search.migration,
      expected: EXPECTED_SEARCH_MIGRATION,
      ready: warnings.searchDatabase
    })
  });
  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    degraded: !Object.values(warnings).every(Boolean),
    checks,
    warnings,
    migrations,
    projection: projection.details,
    search: search.details
  });
}

async function readProjectionReadiness(env) {
  try {
    const state = await getSearchProjectionState(env);
    return {
      ready: state.ready && state.pendingDirtyCount === 0,
      details: Object.freeze({
        available: state.available,
        reindexStatus: state.reindexStatus,
        indexedDocumentCount: state.indexedDocumentCount,
        pendingDirtyCount: state.pendingDirtyCount,
        lastReindexedAt: state.lastReindexedAt
      })
    };
  } catch {
    return {
      ready: false,
      details: Object.freeze({
        available: false,
        reindexStatus: "unavailable",
        indexedDocumentCount: 0,
        pendingDirtyCount: 0,
        lastReindexedAt: null
      })
    };
  }
}

async function readLegacySearchReadiness(env) {
  if (!env.SEARCH_DB) {
    return { migrationReady: false, operational: false, migration: "", details: LEGACY_SEARCH_UNAVAILABLE };
  }
  try {
    const [migration, state] = await Promise.all([
      readLatestMigration(env.SEARCH_DB),
      getSearchOperationalState(env)
    ]);
    return {
      migrationReady: migrationAtLeast(migration, EXPECTED_SEARCH_MIGRATION),
      operational: isSearchOperational(state),
      migration,
      details: Object.freeze({
        generation: state.generation,
        searchGeneration: state.searchGeneration,
        activeGeneration: state.activeGeneration,
        indexedDocumentCount: state.indexedDocumentCount,
        searchIndexedDocumentCount: state.searchIndexedDocumentCount,
        pendingOutboxCount: state.pendingOutboxCount,
        searchAvailable: state.searchAvailable,
        rebuildRequired: state.rebuildRequired,
        rebuildStatus: state.rebuildStatus,
        v2Ready: state.v2Ready
      })
    };
  } catch {
    return { migrationReady: false, operational: false, migration: "", details: LEGACY_SEARCH_UNAVAILABLE };
  }
}

const LEGACY_SEARCH_UNAVAILABLE = Object.freeze({
  generation: 0,
  searchGeneration: 0,
  activeGeneration: 0,
  indexedDocumentCount: 0,
  searchIndexedDocumentCount: 0,
  pendingOutboxCount: 0,
  searchAvailable: false,
  rebuildRequired: false,
  rebuildStatus: "unavailable",
  v2Ready: false
});

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
