import {
  DEFAULT_RACK_COLUMNS,
  DEFAULT_RACK_SHELVES,
  MAX_RACK_COLUMNS,
  MAX_RACKS_PER_ZONE,
  MAX_RACK_SHELVES,
  RACK_ZONES
} from "../config.js";
import { logError } from "../platform/observability/logger.js";
import { clean } from "../shared/text/normalize.js";
import { DOCUMENT_BASE_JOINS, DOCUMENT_LOCATION_COLUMNS } from "./sqlShared.js";
import { createSystemAuditStatement } from "../domains/audit/index.js";
import { DEFAULT_FLOOR_PLAN_REGIONS, buildFloorPlanLayout } from "../domains/racks/domain/floorPlan.js";
import { presentSlotOption } from "../domains/racks/web/presenters.js";
import { createRackConfigurationPlan, createRackCreatePlan, createRackResizePlan } from "../domains/racks/infrastructure/rackMutationPlans.js";
import { executeMutationBatch } from "../platform/d1/requestGateway.js";
import { isExpectedChangeAbort } from "../platform/d1/expectedChange.js";

export { DEFAULT_FLOOR_PLAN_REGIONS, buildFloorPlanLayout };

// 좌표는 Archive.png(1024x797) 회색 구역 실측 비율. 컨테이너 aspect-ratio가
// 이미지 비율과 일치해야 오버레이가 어긋나지 않는다 (views/floorPlanViews.js 참조).
export async function getFloorPlanRegions(env) {
  try {
    const result = await env.DB.prepare(`
      SELECT
        region_key,
        label,
        description,
        top_pct,
        left_pct,
        width_pct,
        height_pct,
        default_rack_count,
        is_active
      FROM floor_plan_regions
      WHERE is_active = 1
      ORDER BY region_key
    `).all();
    const rows = result.results ?? [];
    return rows.length ? rows : DEFAULT_FLOOR_PLAN_REGIONS.map((region) => ({ ...region }));
  } catch (error) {
    // 위치 핵심: 도면 구역 조회가 예외로 실패하면 기본 도면으로 폴백하되 반드시 경보로 남긴다.
    // (빈 테이블은 정상 기본값이므로 예외만 이 경로로 온다.)
    logError("db.getFloorPlanRegions", error);
    return DEFAULT_FLOOR_PLAN_REGIONS.map((region) => ({ ...region }));
  }
}

export async function getRackSummaries(env) {
  const result = await env.DB.prepare(`
    SELECT
      r.id,
      r.zone_number,
      r.rack_number,
      r.code,
      r.name,
      r.description,
      r.is_single_sided,
      r.is_active,
      r.column_count,
      r.shelf_count,
      r.row_version,
      COUNT(d.id) AS document_count,
      SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END) AS active_document_count
    FROM racks r
    LEFT JOIN rack_slots rs ON rs.rack_id = r.id
    LEFT JOIN documents d ON d.rack_slot_id = rs.id AND d.sync_state = 'current'
    WHERE r.is_active = 1
    GROUP BY r.id
    ORDER BY r.zone_number, r.rack_number
  `).all();

  return result.results ?? [];
}

export async function getRackDetails(env, id) {
  return env.DB.prepare(`
    SELECT id, zone_number, rack_number, code, name, description, is_single_sided, is_active, column_count, shelf_count, row_version
    FROM racks
    WHERE id = ?
  `).bind(id).first();
}

export async function getRackConfigurationVersion(env) {
  const row = await env.DB.prepare(`
    SELECT current_version
    FROM document_sync_state
    WHERE id = 1
  `).first();
  return Number(row?.current_version || 0);
}

export async function getRackDocuments(env, rackId) {
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      d.storage_code,
      d.document_number,
      d.revision_number,
      d.revision_date,
      d.disposal_due_year,
      d.document_name,
      d.rack_face,
      d.status,
      ${DOCUMENT_LOCATION_COLUMNS}
      rs.column_number,
      rs.shelf_number,
      rs.slot_code
    ${DOCUMENT_BASE_JOINS}
    WHERE r.id = ? AND d.sync_state = 'current'
    ORDER BY d.rack_face, rs.column_number, rs.shelf_number, d.document_number
  `).bind(rackId).all();

  return result.results ?? [];
}

// 랙 상세 격자는 셀마다 질의하지 않고 한 번의 집계로 면·열·선반별 상태 건수를 만든다.
export async function getRackGrid(env, rackId) {
  const result = await env.DB.prepare(`
    SELECT
      faces.rack_face,
      rs.column_number,
      rs.shelf_number,
      SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN d.status = 'disposed' THEN 1 ELSE 0 END) AS disposed_count
    FROM racks r
    JOIN rack_slots rs ON rs.rack_id = r.id AND rs.is_active = 1
    JOIN (
      SELECT 'A' AS rack_face
      UNION ALL
      SELECT 'B' AS rack_face
    ) faces ON faces.rack_face = 'A' OR r.is_single_sided = 0
    LEFT JOIN documents d
      ON d.rack_slot_id = rs.id
      AND d.rack_face = faces.rack_face
      AND d.sync_state = 'current'
    WHERE r.id = ? AND r.is_active = 1
    GROUP BY faces.rack_face, rs.column_number, rs.shelf_number
    ORDER BY faces.rack_face, rs.shelf_number DESC, rs.column_number
  `).bind(rackId).all();

  return result.results ?? [];
}

export async function getSlotOptions(env) {
  const result = await env.DB.prepare(`
    SELECT
      rs.id,
      rs.slot_code,
      rs.column_number,
      rs.shelf_number,
      r.code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE rs.is_active = 1 AND r.is_active = 1
    ORDER BY r.zone_number, r.rack_number, rs.column_number, rs.shelf_number
  `).all();

  return (result.results ?? []).map(presentSlotOption);
}

export async function upsertRack(env, values, actor = {}) {
  if (values.rackNumber < 1 || values.rackNumber > MAX_RACKS_PER_ZONE) {
    throw new Error(`랙 번호는 구역당 1~${MAX_RACKS_PER_ZONE} 사이여야 합니다.`);
  }

  if (values.columnCount < 1 || values.columnCount > MAX_RACK_COLUMNS || values.shelfCount < 1 || values.shelfCount > MAX_RACK_SHELVES) {
    throw new Error(`랙 구조는 1~${MAX_RACK_COLUMNS}열, 1~${MAX_RACK_SHELVES}선반 사이로 설정해야 합니다.`);
  }

  const code = `${values.zoneNumber}-${String(values.rackNumber).padStart(2, "0")}`;
  const after = rackAuditSnapshot({
    zone_number: values.zoneNumber,
    rack_number: values.rackNumber,
    code,
    name: values.name,
    description: values.description,
    is_single_sided: values.isSingleSided ? 1 : 0,
    is_active: values.isActive ? 1 : 0,
    column_count: values.columnCount,
    shelf_count: values.shelfCount
  });

  if (values.id) {
    const expectedRowVersion = positiveVersion(values.expectedRowVersion ?? values.rowVersion);
    if (!expectedRowVersion) throw staleRackError();
    const before = await getRackDetails(env, values.id);
    if (!before) throw new Error("랙을 찾을 수 없습니다.");
    if (Number(before.row_version) !== expectedRowVersion) throw staleRackError();
    const blocked = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      JOIN rack_slots rs ON rs.id = d.rack_slot_id
      WHERE rs.rack_id = ?
        AND (rs.column_number > ? OR rs.shelf_number > ?)
    `).bind(values.id, values.columnCount, values.shelfCount).first();

    if ((blocked?.count ?? 0) > 0) {
      throw new Error("줄이려는 열/선반 범위 밖에 문서가 있어 랙 구조를 변경할 수 없습니다.");
    }

    const nextActive = values.isActive ? 1 : 0;
    const action = Number(before.is_active) !== nextActive
      ? (nextActive ? "reactivate" : "deactivate")
      : "update";
    // 사전 확인과 batch 사이에 범위 밖 슬롯으로 문서가 이동할 수 있으므로 감사·랙 수정도
    // 같은 축소 가능 조건으로 다시 가드한다. 이후 슬롯 문장은 수정된 구조 값을 확인한다.
    const resizeGuardSql = `FROM racks target
      WHERE target.id = ?
        AND target.row_version = ?
        AND NOT EXISTS (
          SELECT 1
          FROM documents d
          JOIN rack_slots rs ON rs.id = d.rack_slot_id
          WHERE rs.rack_id = target.id
            AND (rs.column_number > ? OR rs.shelf_number > ?)
        )`;
    const resizeGuardBinds = [values.id, expectedRowVersion, values.columnCount, values.shelfCount];
    const resizeStatements = [
      createSystemAuditStatement(env, {
        entityType: "rack",
        entityId: values.id,
        entityReference: before.code,
        action,
        actor,
        summary: `랙 ${action === "reactivate" ? "다시 사용" : action === "deactivate" ? "사용중지" : "수정"}`,
        details: { before: rackAuditSnapshot(before), after }
      }, { guardSql: resizeGuardSql, guardBinds: resizeGuardBinds }),
      env.DB.prepare(`
        UPDATE racks
        SET
          zone_number = ?,
          rack_number = ?,
          code = ?,
          name = ?,
          description = ?,
          is_single_sided = ?,
          is_active = ?,
          column_count = ?,
          shelf_count = ?,
          updated_at = CURRENT_TIMESTAMP,
          row_version = row_version + 1
        WHERE id = ? AND row_version = ?
          AND NOT EXISTS (
            SELECT 1
            FROM documents d
            JOIN rack_slots rs ON rs.id = d.rack_slot_id
            WHERE rs.rack_id = racks.id
              AND (rs.column_number > ? OR rs.shelf_number > ?)
          )
      `).bind(
        values.zoneNumber,
        values.rackNumber,
        code,
        values.name || null,
        values.description || null,
        values.isSingleSided ? 1 : 0,
        nextActive,
        values.columnCount,
        values.shelfCount,
        values.id,
        expectedRowVersion,
        values.columnCount,
        values.shelfCount
      ),
      ...createRackSlotSyncStatements(env, values.id, values.columnCount, values.shelfCount)
    ];
    const resizePlan = createRackResizePlan(resizeStatements, `rack:${values.id}:${values.columnCount}x${values.shelfCount}`);
    let results;
    try {
      results = await executeMutationBatch(env, resizePlan);
    } catch (error) {
      if (isExpectedChangeAbort(error)) throw staleRackError();
      throw error;
    }
    if (!Number(results[1]?.meta?.changes || 0)) throw new Error("랙을 찾을 수 없습니다.");

    return values.id;
  }

  const createStatements = [
    env.DB.prepare(`
      INSERT INTO racks (
        zone_number,
        rack_number,
        code,
        name,
        description,
        is_single_sided,
        is_active,
        column_count,
        shelf_count,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
      RETURNING id
    `).bind(
      values.zoneNumber,
      values.rackNumber,
      code,
      values.name || null,
      values.description || null,
      values.isSingleSided ? 1 : 0,
      values.columnCount,
      values.shelfCount
    ),
    createSystemAuditStatement(env, {
      entityType: "rack",
      entityReference: code,
      action: "create",
      actor,
      summary: "랙 생성",
      details: { after: { ...after, isActive: true } }
    }, { guardSql: "FROM racks WHERE code = ?", guardBinds: [code] }),
    createRackSlotInsertStatementByCode(env, code, values.columnCount, values.shelfCount)
  ];
  const createPlan = createRackCreatePlan(createStatements, `rack:${code}`);
  const results = await executeMutationBatch(env, createPlan);
  const id = Number(results[0]?.results?.[0]?.id || results[0]?.meta?.last_row_id || 0);
  if (!id) throw new Error("생성한 랙을 확인할 수 없습니다.");

  return id;
}

function createRackSlotSyncStatements(env, rackId, columnCount, shelfCount) {
  return [
    env.DB.prepare(`
      UPDATE rack_slots
      SET
        is_active = CASE
          WHEN column_number BETWEEN 1 AND ? AND shelf_number BETWEEN 1 AND ? THEN 1
          ELSE 0
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE rack_id = ?
        AND EXISTS (
          SELECT 1 FROM racks
          WHERE id = ? AND column_count = ? AND shelf_count = ?
        )
    `).bind(columnCount, shelfCount, rackId, rackId, columnCount, shelfCount),
    env.DB.prepare(`
      WITH RECURSIVE
        col_nums(column_number) AS (
          VALUES(1)
          UNION ALL
          SELECT column_number + 1 FROM col_nums WHERE column_number < ?
        ),
        shelf_nums(shelf_number) AS (
          VALUES(1)
          UNION ALL
          SELECT shelf_number + 1 FROM shelf_nums WHERE shelf_number < ?
        )
      INSERT INTO rack_slots (
        rack_id,
        slot_code,
        column_number,
        shelf_number,
        description,
        is_active,
        updated_at
      )
      SELECT
        ?,
        printf('%d-%d', col_nums.column_number, shelf_nums.shelf_number),
        col_nums.column_number,
        shelf_nums.shelf_number,
        printf('%d열 %d선반', col_nums.column_number, shelf_nums.shelf_number),
        1,
        CURRENT_TIMESTAMP
      FROM col_nums
      CROSS JOIN shelf_nums
      WHERE EXISTS (
        SELECT 1 FROM racks
        WHERE id = ? AND column_count = ? AND shelf_count = ?
      )
      ON CONFLICT(rack_id, slot_code) DO UPDATE SET
        column_number = excluded.column_number,
        shelf_number = excluded.shelf_number,
        description = excluded.description,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(columnCount, shelfCount, rackId, rackId, columnCount, shelfCount)
  ];
}

function createRackSlotInsertStatementByCode(env, code, columnCount, shelfCount) {
  return env.DB.prepare(`
    WITH RECURSIVE
      col_nums(column_number) AS (
        VALUES(1)
        UNION ALL
        SELECT column_number + 1 FROM col_nums WHERE column_number < ?
      ),
      shelf_nums(shelf_number) AS (
        VALUES(1)
        UNION ALL
        SELECT shelf_number + 1 FROM shelf_nums WHERE shelf_number < ?
      )
    INSERT INTO rack_slots (
      rack_id,
      slot_code,
      column_number,
      shelf_number,
      description,
      is_active,
      updated_at
    )
    SELECT
      r.id,
      printf('%d-%d', col_nums.column_number, shelf_nums.shelf_number),
      col_nums.column_number,
      shelf_nums.shelf_number,
      printf('%d열 %d선반', col_nums.column_number, shelf_nums.shelf_number),
      1,
      CURRENT_TIMESTAMP
    FROM racks r
    CROSS JOIN col_nums
    CROSS JOIN shelf_nums
    WHERE r.code = ?
    ON CONFLICT(rack_id, slot_code) DO UPDATE SET
      column_number = excluded.column_number,
      shelf_number = excluded.shelf_number,
      description = excluded.description,
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).bind(columnCount, shelfCount, code);
}

export async function configureRackCounts(env, counts, actor = {}, expectedVersion = 0) {
  for (const zone of RACK_ZONES) {
    if (!Number.isInteger(counts[zone]) || counts[zone] < 0 || counts[zone] > MAX_RACKS_PER_ZONE) {
      return { ok: false, message: `구역별 랙 수는 0~${MAX_RACKS_PER_ZONE} 사이여야 합니다.` };
    }
  }
  const expectedConfigurationVersion = positiveVersion(expectedVersion);
  if (!expectedConfigurationVersion) {
    return { ok: false, message: "랙 구성이 다른 요청에서 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  const usedRows = await env.DB.prepare(`
    SELECT r.zone_number, MAX(r.rack_number) AS max_used_rack
    FROM racks r
    JOIN rack_slots rs ON rs.rack_id = r.id
    JOIN documents d ON d.rack_slot_id = rs.id AND d.sync_state = 'current'
    GROUP BY r.zone_number
  `).all();

  for (const row of usedRows.results ?? []) {
    if (counts[row.zone_number] < row.max_used_rack) {
      return {
        ok: false,
        message: `${row.zone_number}구역 ${row.max_used_rack}번 랙에 문서가 있어 ${counts[row.zone_number]}개로 줄일 수 없습니다.`
      };
    }
  }

  const beforeCounts = await env.DB.prepare(`
    SELECT zone_number, COUNT(*) AS count
    FROM racks
    WHERE is_active = 1 AND zone_number IN (1, 2, 3)
    GROUP BY zone_number
  `).all();
  const before = Object.fromEntries(RACK_ZONES.map((zone) => [zone, 0]));
  for (const row of beforeCounts.results ?? []) before[row.zone_number] = Number(row.count || 0);

  const configurationStatements = [
    env.DB.prepare(`
      UPDATE document_sync_state
      SET current_version = current_version
      WHERE id = 1 AND current_version = ?
    `).bind(expectedConfigurationVersion),
    createSystemAuditStatement(env, {
      entityType: "rack_configuration",
      entityReference: "zones-1-3",
      action: "update",
      actor,
      summary: "구역별 랙 구성 변경",
      details: { before, after: counts }
    }, { guardSql: "FROM (SELECT 1 AS audit_guard)" }),
    env.DB.prepare(`
      WITH RECURSIVE nums(rack_number) AS (
        VALUES(1)
        UNION ALL
        SELECT rack_number + 1 FROM nums WHERE rack_number < ?
      ),
      zones(zone_number) AS (
        VALUES(1), (2), (3)
      )
      INSERT INTO racks (
        zone_number,
        rack_number,
        code,
        name,
        description,
        is_single_sided,
        is_active,
        column_count,
        shelf_count,
        updated_at
      )
      SELECT
        zones.zone_number,
        nums.rack_number,
        printf('%d-%02d', zones.zone_number, nums.rack_number),
        printf('%d구역 %02d번 랙', zones.zone_number, nums.rack_number),
        printf('%d구역 운영 랙', zones.zone_number),
        0,
        CASE
          WHEN zones.zone_number = 1 AND nums.rack_number <= ? THEN 1
          WHEN zones.zone_number = 2 AND nums.rack_number <= ? THEN 1
          WHEN zones.zone_number = 3 AND nums.rack_number <= ? THEN 1
          ELSE 0
        END,
        ?,
        ?,
        CURRENT_TIMESTAMP
      FROM zones
      CROSS JOIN nums
      WHERE 1 = 1
      ON CONFLICT(zone_number, rack_number) DO NOTHING
    `).bind(MAX_RACKS_PER_ZONE, counts[1], counts[2], counts[3], DEFAULT_RACK_COLUMNS, DEFAULT_RACK_SHELVES),
    env.DB.prepare(`
      UPDATE racks
      SET is_active = CASE
            WHEN zone_number = 1 AND rack_number <= ? THEN 1
            WHEN zone_number = 2 AND rack_number <= ? THEN 1
            WHEN zone_number = 3 AND rack_number <= ? THEN 1
            ELSE 0
          END,
          updated_at = CURRENT_TIMESTAMP,
          row_version = row_version + 1
      WHERE zone_number IN (1, 2, 3)
        AND rack_number BETWEEN 1 AND ?
    `).bind(counts[1], counts[2], counts[3], MAX_RACKS_PER_ZONE),
    env.DB.prepare(`
      WITH RECURSIVE
        default_cols(column_number) AS (
          VALUES(1)
          UNION ALL
          SELECT column_number + 1 FROM default_cols WHERE column_number < ?
        ),
        default_shelves(shelf_number) AS (
          VALUES(1)
          UNION ALL
          SELECT shelf_number + 1 FROM default_shelves WHERE shelf_number < ?
        )
      INSERT INTO rack_slots (
        rack_id,
        slot_code,
        column_number,
        shelf_number,
        description,
        is_active,
        updated_at
      )
      SELECT
        r.id,
        printf('%d-%d', default_cols.column_number, default_shelves.shelf_number),
        default_cols.column_number,
        default_shelves.shelf_number,
        printf('%d열 %d선반', default_cols.column_number, default_shelves.shelf_number),
        1,
        CURRENT_TIMESTAMP
      FROM racks r
      CROSS JOIN default_cols
      CROSS JOIN default_shelves
      WHERE r.zone_number IN (1, 2, 3)
        AND r.rack_number BETWEEN 1 AND ?
      ON CONFLICT(rack_id, slot_code) DO UPDATE SET
        column_number = excluded.column_number,
        shelf_number = excluded.shelf_number,
        description = excluded.description,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(DEFAULT_RACK_COLUMNS, DEFAULT_RACK_SHELVES, MAX_RACKS_PER_ZONE)
  ];
  const configurationPlan = createRackConfigurationPlan(configurationStatements);
  try {
    await executeMutationBatch(env, configurationPlan);
  } catch (error) {
    if (isExpectedChangeAbort(error)) {
      return { ok: false, message: "랙 구성이 다른 요청에서 변경되었습니다. 새로고침 후 다시 시도하세요." };
    }
    throw error;
  }

  return { ok: true };
}

function rackAuditSnapshot(row = {}) {
  return {
    zoneNumber: Number(row.zone_number || 0),
    rackNumber: Number(row.rack_number || 0),
    code: clean(row.code),
    name: clean(row.name),
    description: clean(row.description),
    isSingleSided: Boolean(row.is_single_sided),
    isActive: Boolean(row.is_active),
    columnCount: Number(row.column_count || 0),
    shelfCount: Number(row.shelf_count || 0)
  };
}

function positiveVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function staleRackError() {
  return Object.assign(
    new Error("랙이 다른 요청에서 변경되었습니다. 새로고침 후 다시 시도하세요."),
    { code: "STALE_VERSION" }
  );
}
