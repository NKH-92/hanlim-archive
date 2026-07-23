// 엑셀 반영 BatchPlan. 감사·이력 INSERT를 문서 UPDATE보다 먼저 두고, set-based SQL로 statement ≤40을 유지한다.
import { exactChangeCountAssertionSql } from "../../../platform/d1/expectedChange.js";

export function buildApplyStatements(env, {
  snapshotId,
  snapshot,
  actorSnapshot,
  role,
  applyReason,
  approvalReference,
  applyDetails
}) {
  const id = Number(snapshotId);
  const reason = applyReason;
  const approval = approvalReference || "";

  const statements = [
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'applying',
          apply_reason = ?,
          approval_reference = NULLIF(?, ''),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'ready' AND base_version = (
        SELECT current_version FROM document_sync_state WHERE id = 1
      )
    `).bind(reason, approval, id),

    // 02. update 대상 document audit INSERT
    env.DB.prepare(`
      INSERT INTO document_audit_logs (
        document_id, storage_code, document_number, action, actor, actor_role,
        actor_user_id, actor_username, summary, details
      )
      SELECT
        d.id, d.storage_code, d.document_number, 'excel_sync_update', ?, ?, ?, ?,
        '엑셀 문서대장 기준 정보 변경',
        json_object(
          'schemaVersion', 1,
          'snapshotCode', s.snapshot_code,
          'applyReason', ?,
          'approvalReference', NULLIF(?, ''),
          'changedFields', json(IFNULL(row.changed_fields_json, '[]')),
          'changeFlags', json(IFNULL(row.change_flags_json, '[]')),
          'before', json(row.before_json),
          'after', json(row.after_json)
        )
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.id = row.matched_document_id
        AND d.row_version = row.expected_row_version
        AND d.sync_state IN ('current', 'excluded')
      WHERE row.snapshot_id = ? AND row.action = 'update'
    `).bind(actorSnapshot.displayName, role, actorSnapshot.userId, actorSnapshot.username, reason, approval, id),

    // 03. exclusion document audit INSERT
    env.DB.prepare(`
      INSERT INTO document_audit_logs (
        document_id, storage_code, document_number, action, actor, actor_role,
        actor_user_id, actor_username, summary, details
      )
      SELECT
        d.id, d.storage_code, d.document_number, 'excel_sync_exclude', ?, ?, ?, ?,
        '새 엑셀 문서대장에서 제외',
        json_object(
          'schemaVersion', 1,
          'snapshotCode', s.snapshot_code,
          'applyReason', ?,
          'approvalReference', NULLIF(?, ''),
          'before', json(ex.before_json),
          'after', json_object('syncState', 'excluded')
        )
      FROM document_snapshot_exclusions ex
      JOIN document_snapshots s ON s.id = ex.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.id = ex.document_id
        AND d.sync_state = 'current'
        AND d.row_version = ex.expected_row_version
        AND d.excel_row_key = ex.excel_row_key
      WHERE ex.snapshot_id = ?
    `).bind(actorSnapshot.displayName, role, actorSnapshot.userId, actorSnapshot.username, reason, approval, id),

    // 04. movement logs INSERT (위치 변경만)
    env.DB.prepare(`
      INSERT INTO document_movements (
        document_id, document_number_snapshot,
        from_rack_slot_id, from_rack_face, from_location_snapshot,
        to_rack_slot_id, to_rack_face, to_location_snapshot,
        reason, performed_by_user_id, performed_by_username, performed_by_name, snapshot_code
      )
      SELECT
        d.id,
        d.document_number,
        d.rack_slot_id,
        d.rack_face,
        printf('%s / %s면', IFNULL(fr.code, ''), CASE WHEN d.rack_face = 'B' THEN '2' ELSE '1' END),
        CAST(json_extract(row.after_json, '$.values.rackSlotId') AS INTEGER),
        json_extract(row.after_json, '$.values.rackFace'),
        printf('%s / %s면', IFNULL(tr.code, ''), CASE WHEN json_extract(row.after_json, '$.values.rackFace') = 'B' THEN '2' ELSE '1' END),
        ?,
        ?, ?, ?, s.snapshot_code
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.id = row.matched_document_id
        AND d.row_version = row.expected_row_version
        AND d.sync_state IN ('current', 'excluded')
      LEFT JOIN rack_slots fs ON fs.id = d.rack_slot_id
      LEFT JOIN racks fr ON fr.id = fs.rack_id
      LEFT JOIN rack_slots ts ON ts.id = CAST(json_extract(row.after_json, '$.values.rackSlotId') AS INTEGER)
      LEFT JOIN racks tr ON tr.id = ts.rack_id
      WHERE row.snapshot_id = ?
        AND row.action = 'update'
        AND (
          d.rack_slot_id <> CAST(json_extract(row.after_json, '$.values.rackSlotId') AS INTEGER)
          OR d.rack_face <> json_extract(row.after_json, '$.values.rackFace')
        )
    `).bind(reason, actorSnapshot.userId, actorSnapshot.username, actorSnapshot.displayName, id),

    // 05. disposal/restore logs INSERT
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason, snapshot_code)
      SELECT
        d.id,
        CASE
          WHEN json_extract(row.after_json, '$.values.status') = 'disposed' THEN 'disposed'
          ELSE 'restored'
        END,
        ?,
        ?,
        s.snapshot_code
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.id = row.matched_document_id
        AND d.row_version = row.expected_row_version
        AND d.sync_state IN ('current', 'excluded')
      WHERE row.snapshot_id = ?
        AND row.action = 'update'
        AND d.status <> json_extract(row.after_json, '$.values.status')
    `).bind(actorSnapshot.displayName, reason, id),

    // 06. update 대상 tags DELETE — document pre-state guard와 동일 조건
    env.DB.prepare(`
      DELETE FROM document_tags
      WHERE document_id IN (
        SELECT row.matched_document_id
        FROM document_snapshot_rows row
        JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
        JOIN documents d ON d.id = row.matched_document_id
          AND d.row_version = row.expected_row_version
          AND d.sync_state IN ('current', 'excluded')
        WHERE row.snapshot_id = ? AND row.action = 'update'
      )
    `).bind(id),

    // 07. update 대상 tags INSERT — document pre-state guard와 동일 조건
    env.DB.prepare(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      SELECT row.matched_document_id, CAST(tag.value AS INTEGER)
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.id = row.matched_document_id
        AND d.row_version = row.expected_row_version
        AND d.sync_state IN ('current', 'excluded')
      CROSS JOIN json_each(json_extract(row.after_json, '$.values.tagIds')) tag
      JOIN tags t ON t.id = CAST(tag.value AS INTEGER) AND t.is_active = 1
      WHERE row.snapshot_id = ? AND row.action = 'update'
    `).bind(id),

    // 08. existing document UPDATE
    env.DB.prepare(`
      UPDATE documents AS d
      SET excel_row_key = row.row_key,
          category_id = CAST(json_extract(row.after_json, '$.values.categoryId') AS INTEGER),
          document_number = json_extract(row.after_json, '$.values.documentNumber'),
          revision_number = json_extract(row.after_json, '$.values.revisionNumber'),
          revision_date = NULLIF(json_extract(row.after_json, '$.values.revisionDate'), ''),
          disposal_due_year = CAST(NULLIF(json_extract(row.after_json, '$.values.disposalDueYear'), '') AS INTEGER),
          document_name = json_extract(row.after_json, '$.values.documentName'),
          note = NULLIF(json_extract(row.after_json, '$.values.note'), ''),
          rack_slot_id = CAST(json_extract(row.after_json, '$.values.rackSlotId') AS INTEGER),
          rack_face = json_extract(row.after_json, '$.values.rackFace'),
          status = json_extract(row.after_json, '$.values.status'),
          sync_state = 'current',
          last_snapshot_id = ?,
          row_version = row_version + 1,
          updated_at = CURRENT_TIMESTAMP
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      WHERE d.id = row.matched_document_id
        AND d.row_version = row.expected_row_version
        AND d.sync_state IN ('current', 'excluded')
        AND NOT EXISTS (
          SELECT 1
          FROM document_revision_links link
          WHERE (link.previous_document_id = d.id OR link.new_document_id = d.id)
            AND (
              d.document_number IS NOT json_extract(row.after_json, '$.values.documentNumber')
              OR d.revision_number IS NOT json_extract(row.after_json, '$.values.revisionNumber')
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM document_revision_links link
          WHERE link.previous_document_id = d.id
            AND d.status = 'disposed'
            AND json_extract(row.after_json, '$.values.status') = 'active'
        )
        AND row.snapshot_id = ?
        AND row.action = 'update'
    `).bind(id, id),

    // update 건수가 계획과 다르면 트랜잭션 전체를 abort한다.
    env.DB.prepare(
      exactChangeCountAssertionSql("(SELECT update_count FROM document_snapshots WHERE id = ?)")
    ).bind(id),

    // 09. new document INSERT
    env.DB.prepare(`
      INSERT INTO documents (
        storage_code, excel_row_key, category_id, document_number, revision_number,
        revision_date, disposal_due_year, document_name, note, rack_slot_id, rack_face,
        status, sync_state, last_snapshot_id, updated_at
      )
      SELECT
        'SNP-' || row.snapshot_id || '-' || row.row_number,
        row.row_key,
        CAST(json_extract(row.after_json, '$.values.categoryId') AS INTEGER),
        json_extract(row.after_json, '$.values.documentNumber'),
        json_extract(row.after_json, '$.values.revisionNumber'),
        NULLIF(json_extract(row.after_json, '$.values.revisionDate'), ''),
        CAST(NULLIF(json_extract(row.after_json, '$.values.disposalDueYear'), '') AS INTEGER),
        json_extract(row.after_json, '$.values.documentName'),
        NULLIF(json_extract(row.after_json, '$.values.note'), ''),
        CAST(json_extract(row.after_json, '$.values.rackSlotId') AS INTEGER),
        json_extract(row.after_json, '$.values.rackFace'),
        json_extract(row.after_json, '$.values.status'),
        'current', row.snapshot_id, CURRENT_TIMESTAMP
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      WHERE row.snapshot_id = ? AND row.action = 'create'
    `).bind(id),

    // create 건수가 계획과 다르면 트랜잭션 전체를 abort한다.
    env.DB.prepare(
      exactChangeCountAssertionSql("(SELECT create_count FROM document_snapshots WHERE id = ?)")
    ).bind(id),

    // 10. 신규 storage code 확정
    env.DB.prepare(`
      UPDATE documents
      SET storage_code = 'ARC-' || printf('%06d', id)
      WHERE last_snapshot_id = ? AND storage_code LIKE 'SNP-%'
        AND EXISTS (SELECT 1 FROM document_snapshots WHERE id = ? AND status = 'applying')
    `).bind(id, id),

    // 11. 신규 문서 audit INSERT
    env.DB.prepare(`
      INSERT INTO document_audit_logs (
        document_id, storage_code, document_number, action, actor, actor_role,
        actor_user_id, actor_username, summary, details
      )
      SELECT
        d.id, d.storage_code, d.document_number, 'excel_sync_create', ?, ?, ?, ?,
        '엑셀 문서대장 기준 문서 등록',
        json_object(
          'schemaVersion', 1,
          'snapshotCode', s.snapshot_code,
          'applyReason', ?,
          'approvalReference', NULLIF(?, ''),
          'after', json(row.after_json)
        )
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.excel_row_key = row.row_key
      WHERE row.snapshot_id = ? AND row.action = 'create'
    `).bind(actorSnapshot.displayName, role, actorSnapshot.userId, actorSnapshot.username, reason, approval, id),

    // 12. 신규 disposed log + create tags
    env.DB.prepare(`
      INSERT INTO disposal_logs (document_id, action, performed_by, reason, snapshot_code)
      SELECT d.id, 'disposed', ?, ?, s.snapshot_code
      FROM documents d
      JOIN document_snapshots s ON s.id = d.last_snapshot_id AND s.status = 'applying'
      WHERE d.last_snapshot_id = ? AND d.status = 'disposed'
        AND EXISTS (SELECT 1 FROM document_snapshots WHERE id = ? AND status = 'applying')
        AND NOT EXISTS (SELECT 1 FROM disposal_logs log WHERE log.document_id = d.id)
    `).bind(actorSnapshot.displayName, reason, id, id),

    env.DB.prepare(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      SELECT d.id, CAST(tag.value AS INTEGER)
      FROM document_snapshot_rows row
      JOIN document_snapshots s ON s.id = row.snapshot_id AND s.status = 'applying'
      JOIN documents d ON d.excel_row_key = row.row_key
      CROSS JOIN json_each(json_extract(row.after_json, '$.values.tagIds')) tag
      JOIN tags t ON t.id = CAST(tag.value AS INTEGER) AND t.is_active = 1
      WHERE row.snapshot_id = ? AND row.action = 'create'
    `).bind(id),

    // 13. exclusion document UPDATE
    env.DB.prepare(`
      UPDATE documents
      SET sync_state = 'excluded',
          row_version = row_version + 1,
          last_snapshot_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE sync_state = 'current'
        AND EXISTS (SELECT 1 FROM document_snapshots WHERE id = ? AND status = 'applying')
        AND EXISTS (
          SELECT 1 FROM document_snapshot_exclusions ex
          WHERE ex.snapshot_id = ?
            AND ex.document_id = documents.id
            AND ex.expected_row_version = documents.row_version
            AND ex.excel_row_key = documents.excel_row_key
        )
    `).bind(id, id, id),

    // exclusion 건수가 계획과 다르면 트랜잭션 전체를 abort한다.
    env.DB.prepare(
      exactChangeCountAssertionSql("(SELECT exclude_count FROM document_snapshots WHERE id = ?)")
    ).bind(id),

    // 14. system snapshot apply audit INSERT
    env.DB.prepare(`
      INSERT INTO system_audit_logs (
        entity_type, entity_id, entity_reference, action, actor_user_id,
        actor_username_snapshot, actor_display_name_snapshot, actor_permissions_snapshot,
        summary, details_json
      )
      SELECT 'document_snapshot', CAST(id AS TEXT), snapshot_code, 'apply', ?, ?, ?, ?, ?, ?
      FROM document_snapshots
      WHERE id = ? AND status = 'applying'
    `).bind(
      actorSnapshot.userId,
      actorSnapshot.username,
      actorSnapshot.displayName,
      JSON.stringify(actorSnapshot.permissions),
      "엑셀 문서대장 전체 동기화 반영",
      JSON.stringify(applyDetails),
      id
    ),

    // 15. version 단조 증가 (base_version+1 덮어쓰기 금지)
    env.DB.prepare(`
      UPDATE document_sync_state
      SET current_version = current_version + 1,
          current_snapshot_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
        AND EXISTS (SELECT 1 FROM document_snapshots WHERE id = ? AND status = 'applying')
    `).bind(id, id),

    // 16. snapshot completed
    env.DB.prepare(`
      UPDATE document_snapshots
      SET status = 'completed', applied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'applying'
      RETURNING *
    `).bind(id)
  ];

  if (snapshot.mode === "bootstrap") {
    const claim = statements.shift();
    const completed = statements.pop();
    const exactSeedPredicate = `
      note = 'Cloudflare 테스트 기본 문서'
      AND (
        (storage_code = 'ARC-000001' AND document_number = 'MR-2026-001')
        OR (storage_code = 'ARC-000002' AND document_number = 'PV-2026-014')
      )
    `;

    statements.unshift(
      claim,
      env.DB.prepare(`
        UPDATE bootstrap_runtime_control
        SET suppress_derived_triggers = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
          AND suppress_derived_triggers = 0
          AND EXISTS (
            SELECT 1
            FROM document_snapshots
            WHERE id = ? AND status = 'applying' AND mode = 'bootstrap'
          )
          AND (SELECT COUNT(*) FROM documents) = 2
          AND (SELECT COUNT(*) FROM documents WHERE ${exactSeedPredicate}) = 2
      `).bind(id),
      env.DB.prepare(exactChangeCountAssertionSql("1")),
      env.DB.prepare(`
        DELETE FROM documents
        WHERE ${exactSeedPredicate}
          AND EXISTS (
            SELECT 1
            FROM bootstrap_runtime_control
            WHERE id = 1 AND suppress_derived_triggers = 1
          )
      `),
      env.DB.prepare(exactChangeCountAssertionSql("2"))
    );

    statements.push(
      env.DB.prepare(`
        UPDATE search_index_state
        SET rebuild_required = 1,
            generation = generation + 1,
            indexed_document_count = 0,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
          AND EXISTS (
            SELECT 1
            FROM document_snapshots
            WHERE id = ? AND status = 'applying'
          )
      `).bind(id),
      env.DB.prepare(`
        UPDATE bootstrap_runtime_control
        SET suppress_derived_triggers = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1 AND suppress_derived_triggers = 1
      `),
      env.DB.prepare(exactChangeCountAssertionSql("1")),
      completed
    );
  }

  return statements;
}
