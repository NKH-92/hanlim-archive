import assert from "node:assert/strict";
import test from "node:test";

import { createMigratedDatabase } from "./helpers/migratedDatabase.js";

function plan(database, sql) {
  return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => String(row.detail || "")).join("\n");
}

test("0050은 10,000건 초기 적재용 documents index를 핵심 조회 패턴만 남긴다", async () => {
  const database = await createMigratedDatabase();
  try {
    const indexes = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND tbl_name = 'documents'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => row.name);

    assert.deepEqual(indexes, [
      "idx_documents_current_identity",
      "idx_documents_current_name",
      "idx_documents_current_status_updated",
      "idx_documents_excel_row_key"
    ]);

    assert.match(
      plan(database, "SELECT id FROM documents WHERE sync_state = 'current' AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT 30"),
      /idx_documents_current_status_updated/
    );
    assert.match(
      plan(database, "SELECT id FROM documents WHERE sync_state = 'current' AND UPPER(document_number) = UPPER('MR-2026-001')"),
      /idx_documents_current_identity/
    );
    assert.match(
      plan(database, "SELECT id FROM documents WHERE sync_state = 'current' AND document_name = '2026년 1분기 제조기록서' COLLATE NOCASE ORDER BY id DESC LIMIT 30"),
      /idx_documents_current_name/
    );
  } finally {
    database.close();
  }
});

test("0050~0052는 rollback shape를 보존하면서 연결·staging index write를 줄인다", async () => {
  const database = await createMigratedDatabase();
  try {
    const documentTagsSql = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_tags'"
    ).get().sql;
    const membershipSql = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_snapshot_membership'"
    ).get().sql;
    const snapshotRowsSql = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_snapshot_rows'"
    ).get().sql;
    assert.match(documentTagsSql, /WITHOUT ROWID/i);
    assert.match(membershipSql, /WITHOUT ROWID/i);
    assert.match(snapshotRowsSql, /id INTEGER PRIMARY KEY AUTOINCREMENT/i, "직전 Worker가 읽는 staging id shape는 유지한다");

    const removedIndexes = [
      "idx_rack_slots_rack_layout",
      "idx_document_set_items_set",
      "idx_document_snapshot_exclusions_snapshot",
      "idx_document_snapshot_membership_key",
      "idx_document_tags_tag_document",
      "idx_document_snapshot_rows_action",
      "idx_search_projection_category",
      "idx_search_projection_location",
      "idx_search_projection_updated",
      "idx_search_projection_number"
    ];
    for (const name of removedIndexes) {
      assert.equal(
        database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?").get(name).count,
        0,
        `${name}은 최종 schema에 남지 않아야 한다`
      );
    }
  } finally {
    database.close();
  }
});

test("0050은 검색 cursor generation을 projection 상태로 expand하고 rollback counter와 함께 갱신한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const projectionBefore = database.prepare(
      "SELECT generation FROM search_projection_state WHERE id = 1"
    ).get().generation;
    const legacyBefore = database.prepare(
      "SELECT generation FROM search_index_state WHERE id = 1"
    ).get().generation;
    assert.equal(projectionBefore, legacyBefore);

    database.prepare(`
      UPDATE documents
      SET document_name = document_name || ' 수정'
      WHERE id = (SELECT MIN(id) FROM documents)
    `).run();

    const projectionAfter = database.prepare(
      "SELECT generation FROM search_projection_state WHERE id = 1"
    ).get().generation;
    const legacyAfter = database.prepare(
      "SELECT generation FROM search_index_state WHERE id = 1"
    ).get().generation;
    assert.ok(projectionAfter > projectionBefore);
    assert.equal(projectionAfter, legacyAfter);
  } finally {
    database.close();
  }
});
