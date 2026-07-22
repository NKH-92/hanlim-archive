import { auditActorSnapshot } from "../../identity/index.js";
import { clean } from "../../../shared/text/normalize.js";
import { createBatchPlan } from "../../../platform/d1/batchPlan.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

// 상태 변경과 같은 batch에서 감사 INSERT를 먼저 실행할 수 있도록 statement를 반환한다.
// guardSql은 신뢰할 수 있는 내부 코드가 만든 `FROM ... WHERE ...` 조각만 전달한다.
export function createSystemAuditStatement(env, {
  entityType,
  entityId = null,
  entityReference = null,
  action,
  actor,
  summary,
  details = null
}, { guardSql = "", guardBinds = [] } = {}) {
  const actorSnapshot = auditActorSnapshot(actor);
  const values = [
    clean(entityType),
    entityId === null || entityId === undefined ? null : String(entityId),
    clean(entityReference) || null,
    clean(action),
    actorSnapshot.userId,
    actorSnapshot.username,
    actorSnapshot.displayName,
    JSON.stringify(actorSnapshot.permissions),
    clean(summary),
    serializeDetails(details)
  ];

  if (!values[0] || !values[3] || !values[8]) {
    throw new TypeError("감사로그의 대상 유형, 동작, 요약은 필수입니다.");
  }

  if (guardSql) {
    const normalizedGuard = String(guardSql).trim();
    if (!/^FROM\s/i.test(normalizedGuard)) {
      throw new TypeError("감사로그 guardSql은 FROM 절로 시작해야 합니다.");
    }
    return env.DB.prepare(`
      INSERT INTO system_audit_logs (
        entity_type,
        entity_id,
        entity_reference,
        action,
        actor_user_id,
        actor_username_snapshot,
        actor_display_name_snapshot,
        actor_permissions_snapshot,
        summary,
        details_json
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ${normalizedGuard}
    `).bind(...values, ...guardBinds);
  }

  return env.DB.prepare(`
    INSERT INTO system_audit_logs (
      entity_type,
      entity_id,
      entity_reference,
      action,
      actor_user_id,
      actor_username_snapshot,
      actor_display_name_snapshot,
      actor_permissions_snapshot,
      summary,
      details_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(...values);
}

export async function getSystemAuditPage(env, filters = {}, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const normalized = normalizeAuditFilters(filters);
  const currentPage = positiveInteger(page, 1);
  const size = Math.min(positiveInteger(pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const { where, binds } = buildAuditWhere(normalized);
  const offset = (currentPage - 1) * size;

  const [countResult, rowsResult] = await executeMutationBatch(env, createBatchPlan("audit.page")
    .step("count", env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM system_audit_logs
      ${where}
    `).bind(...binds))
    .step("rows", env.DB.prepare(`
      SELECT
        id,
        entity_type,
        entity_id,
        entity_reference,
        action,
        actor_user_id,
        actor_username_snapshot,
        actor_display_name_snapshot,
        actor_permissions_snapshot,
        summary,
        details_json,
        created_at
      FROM system_audit_logs
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).bind(...binds, size, offset))
  );
  const totalItems = Number(countResult?.results?.[0]?.total || 0);
  return {
    items: rowsResult?.results ?? [],
    filters: normalized,
    pagination: {
      page: currentPage,
      pageSize: size,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / size))
    }
  };
}

export function normalizeAuditFilters(filters = {}) {
  return {
    from: clean(readFilter(filters, "from")),
    to: clean(readFilter(filters, "to")),
    actor: clean(readFilter(filters, "actor")),
    entityType: clean(readFilter(filters, "entityType", "entity_type")),
    action: clean(readFilter(filters, "action")),
    reference: clean(readFilter(filters, "reference", "q"))
  };
}

function buildAuditWhere(filters) {
  const clauses = [];
  const binds = [];

  if (filters.from) {
    clauses.push("created_at >= ?");
    binds.push(filters.from);
  }
  if (filters.to) {
    clauses.push("created_at < datetime(?, '+1 day')");
    binds.push(filters.to);
  }
  if (filters.actor) {
    const pattern = `%${escapeLike(filters.actor)}%`;
    clauses.push("(actor_username_snapshot LIKE ? ESCAPE '\\' OR actor_display_name_snapshot LIKE ? ESCAPE '\\')");
    binds.push(pattern, pattern);
  }
  if (filters.entityType) {
    clauses.push("entity_type = ?");
    binds.push(filters.entityType);
  }
  if (filters.action) {
    clauses.push("action = ?");
    binds.push(filters.action);
  }
  if (filters.reference) {
    const pattern = `%${escapeLike(filters.reference)}%`;
    clauses.push("(entity_reference LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')");
    binds.push(pattern, pattern);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    binds
  };
}

function serializeDetails(details) {
  if (details === null || details === undefined || details === "") {
    return null;
  }
  return typeof details === "string" ? details : JSON.stringify(details);
}

function readFilter(filters, ...keys) {
  for (const key of keys) {
    const value = typeof filters?.get === "function" ? filters.get(key) : filters?.[key];
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return "";
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}
