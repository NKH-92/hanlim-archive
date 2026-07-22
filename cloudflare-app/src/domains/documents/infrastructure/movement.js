// 문서 위치 이동: 일반정보 수정과 분리된 낙관적 잠금·감사·이동 이력 데이터 계층.

import { locationLabel } from "../../racks/index.js";
import { clean } from "../../../shared/text/normalize.js";
import { getDocument } from "../../../data/documentsData.js";
import { AUDIT_LOG_INSERT_WITH_ACTOR, hasChanged } from "../../../data/sqlShared.js";
import { createSystemAuditStatement } from "../../audit/index.js";
import { createDocumentMovePlan } from "./mutationPlans.js";
import { isExpectedChangeAbort } from "../../../platform/d1/expectedChange.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";

function actorSnapshot(session = {}) {
  const userId = Number(session.userId ?? session.user_id ?? session.id);
  return {
    userId: Number.isInteger(userId) && userId > 0 ? userId : null,
    username: clean(session.username) || "알 수 없음",
    displayName: clean(session.displayName ?? session.display_name) || clean(session.username) || "알 수 없음",
    role: clean(session.role) || "User"
  };
}

function locationSnapshot(row, rackFace = row?.rack_face) {
  return locationLabel({ ...row, rack_face: rackFace });
}

async function getActiveMovementSlot(env, slotId) {
  return env.DB.prepare(`
    SELECT
      rs.id,
      rs.column_number,
      rs.shelf_number,
      rs.slot_code,
      r.id AS rack_id,
      r.code AS rack_code,
      r.zone_number,
      r.rack_number,
      r.is_single_sided,
      r.column_count,
      r.shelf_count
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE rs.id = ? AND rs.is_active = 1 AND r.is_active = 1
  `).bind(slotId).first();
}

export async function moveDocument(env, documentId, values, session = {}) {
  const id = Number(documentId);
  const targetSlotId = Number(values?.rackSlotId);
  const targetFace = clean(values?.rackFace).toUpperCase();
  const reason = clean(values?.reason);
  const expectedUpdatedAt = clean(values?.expectedUpdatedAt);
  const expectedRowVersion = Number(values?.expectedRowVersion);

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }
  if (!Number.isInteger(targetSlotId) || targetSlotId <= 0 || !["A", "B"].includes(targetFace)) {
    return { ok: false, message: "이동할 랙·열·선반과 면을 선택하세요." };
  }
  if (!reason) {
    return { ok: false, message: "위치 이동 사유를 입력하세요." };
  }
  if (reason.length > 500) {
    return { ok: false, message: "위치 이동 사유는 500자 이하로 입력하세요." };
  }
  if (!expectedUpdatedAt) {
    return { ok: false, message: "문서 변경 시각이 없습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }
  if (!Number.isInteger(expectedRowVersion) || expectedRowVersion <= 0) {
    return { ok: false, message: "문서 버전이 없습니다. 화면을 새로고침한 뒤 다시 시도하세요." };
  }

  const [document, target] = await Promise.all([
    getDocument(env, id),
    getActiveMovementSlot(env, targetSlotId)
  ]);
  if (!document) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }
  if (document.status !== "active") {
    return { ok: false, message: "폐기 상태 문서는 위치를 이동할 수 없습니다." };
  }
  if (!target) {
    return { ok: false, message: "사용 중인 랙 위치를 선택하세요." };
  }
  if (Number(target.is_single_sided) === 1 && targetFace === "B") {
    return { ok: false, message: "단면 랙은 2면을 선택할 수 없습니다." };
  }
  if (Number(document.rack_slot_id) === targetSlotId && document.rack_face === targetFace) {
    return { ok: false, message: "현재 위치와 다른 위치를 선택하세요." };
  }

  const actor = actorSnapshot(session);
  const beforeLocation = locationSnapshot(document);
  const afterLocation = locationSnapshot(target, targetFace);
  const guardSql = `id = ?
        AND status = 'active'
        AND updated_at = ?
        AND row_version = ?
        AND rack_slot_id = ?
        AND rack_face = ?
        AND EXISTS (
          SELECT 1
          FROM rack_slots target_rs
          JOIN racks target_r ON target_r.id = target_rs.rack_id
          WHERE target_rs.id = ?
            AND target_rs.is_active = 1
            AND target_r.is_active = 1
            AND (? = 'A' OR target_r.is_single_sided = 0)
            AND target_r.code = ?
            AND target_r.zone_number = ?
            AND target_r.rack_number = ?
            AND target_rs.column_number = ?
            AND target_rs.shelf_number = ?
            AND target_r.is_single_sided = ?
        )
        AND EXISTS (
          SELECT 1
          FROM rack_slots source_rs
          JOIN racks source_r ON source_r.id = source_rs.rack_id
          WHERE source_rs.id = documents.rack_slot_id
            AND source_r.code = ?
            AND source_r.zone_number = ?
            AND source_r.rack_number = ?
            AND source_rs.column_number = ?
            AND source_rs.shelf_number = ?
            AND source_r.is_single_sided = ?
        )`;
  const guardBinds = [
    id,
    expectedUpdatedAt,
    expectedRowVersion,
    Number(document.rack_slot_id),
    document.rack_face,
    targetSlotId,
    targetFace,
    target.rack_code,
    Number(target.zone_number),
    Number(target.rack_number),
    Number(target.column_number),
    Number(target.shelf_number),
    Number(target.is_single_sided),
    document.rack_code,
    Number(document.zone_number),
    Number(document.rack_number),
    Number(document.column_number),
    Number(document.shelf_number),
    Number(document.is_single_sided)
  ];
  // 공개 감사 상세에는 내부 storage_code를 넣지 않는다. 감사 테이블의 필수 snapshot 컬럼은
  // 기존 불변식상 저장하되 화면 계층에서 계속 가려진다.
  const auditDetails = JSON.stringify({
    before: {
      documentNumber: document.document_number,
      location: beforeLocation,
      rackSlotId: Number(document.rack_slot_id),
      rackFace: document.rack_face
    },
    after: {
      documentNumber: document.document_number,
      location: afterLocation,
      rackSlotId: targetSlotId,
      rackFace: targetFace
    },
    reason
  });

  const statements = [
    env.DB.prepare(`
      ${AUDIT_LOG_INSERT_WITH_ACTOR}
      SELECT ?, ?, ?, 'move', ?, ?, ?, ?, '문서 위치 이동', ?
      FROM documents
      WHERE ${guardSql}
    `).bind(
      id,
      document.storage_code,
      document.document_number,
      actor.displayName,
      actor.role,
      actor.userId,
      actor.username,
      auditDetails,
      ...guardBinds
    ),
    env.DB.prepare(`
      INSERT INTO document_movements (
        document_id,
        document_number_snapshot,
        from_rack_slot_id,
        from_rack_face,
        to_rack_slot_id,
        to_rack_face,
        from_location_snapshot,
        to_location_snapshot,
        reason,
        performed_by_user_id,
        performed_by_username,
        performed_by_name
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM documents
      WHERE ${guardSql}
    `).bind(
      id,
      document.document_number,
      Number(document.rack_slot_id),
      document.rack_face,
      targetSlotId,
      targetFace,
      beforeLocation,
      afterLocation,
      reason,
      actor.userId,
      actor.username,
      actor.displayName,
      ...guardBinds
    ),
    createSystemAuditStatement(env, {
      entityType: "document",
      entityId: id,
      entityReference: document.document_number,
      action: "move",
      actor: session,
      summary: "문서 위치 이동",
      details: JSON.parse(auditDetails)
    }, { guardSql: `FROM documents WHERE ${guardSql}`, guardBinds }),
    env.DB.prepare(`
      UPDATE documents
      SET rack_slot_id = ?, rack_face = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE ${guardSql}
    `).bind(targetSlotId, targetFace, ...guardBinds)
  ];
  const plan = createDocumentMovePlan(statements, guardSql);
  let results;
  try {
    results = await executeMutationBatch(env, plan);
  } catch (error) {
    if (isExpectedChangeAbort(error)) {
      return { ok: false, message: "다른 사용자가 문서를 먼저 수정했거나 위치 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
    }
    throw error;
  }

  // expectChanged assertion이 마지막에 삽입되므로 실제 UPDATE는 뒤에서 두 번째다.
  if (!hasChanged(results[results.length - 2] || results[3])) {
    return { ok: false, message: "다른 사용자가 문서를 먼저 수정했거나 위치 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }
  return { ok: true, fromLocation: beforeLocation, toLocation: afterLocation };
}

export async function getDocumentMovements(env, documentId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Math.floor(Number(limit) || 50), 200));
  const result = await env.DB.prepare(`
    SELECT
      id,
      document_id,
      document_number_snapshot,
      from_location_snapshot,
      to_location_snapshot,
      reason,
      performed_by_username,
      performed_by_name,
      created_at
    FROM document_movements
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(documentId, safeLimit).all();
  return result.results ?? [];
}

export async function getDocumentMovementPage(env, filters = {}, page = 1, pageSize = 30) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.max(1, Math.min(Math.floor(Number(pageSize) || 30), 100));
  const query = clean(filters.query);
  const clauses = [];
  const binds = [];
  if (query) {
    clauses.push("(document_number_snapshot LIKE ? ESCAPE '\\' OR performed_by_username LIKE ? ESCAPE '\\' OR performed_by_name LIKE ? ESCAPE '\\')");
    const escaped = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    binds.push(escaped, escaped, escaped);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [countRow, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM document_movements ${where}`).bind(...binds).first(),
    env.DB.prepare(`
      SELECT
        id,
        document_id,
        document_number_snapshot,
        from_location_snapshot,
        to_location_snapshot,
        reason,
        performed_by_username,
        performed_by_name,
        created_at
      FROM document_movements
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).bind(...binds, safePageSize, (safePage - 1) * safePageSize).all()
  ]);
  const totalItems = Number(countRow?.count || 0);
  return {
    items: rows.results ?? [],
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / safePageSize))
  };
}
