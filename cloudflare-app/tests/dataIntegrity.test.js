import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  addDocumentsToSet,
  deleteDocumentSet,
  removeDocumentFromSet,
  setDocumentSetLock,
  upsertDocumentSet
} from "../src/domains/sets/index.js";
import { configureRackCounts, getRackConfigurationVersion, upsertRack } from "../src/domains/racks/index.js";
import { upsertCategory, upsertTag } from "../src/domains/masters/index.js";
import { DATA_QUALITY_ISSUES, getDataQualityPage, normalizeDataQualityIssue } from "../src/domains/dataQuality/index.js";
import { getSearchIndexMeta } from "../src/domains/search/index.js";
import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";

const actor = {
  userId: 4,
  username: "operator",
  displayName: "운영자",
  role: "User",
  can_manage_masters: 1
};

test("세트 생성·수정은 이력과 상태를 각각 하나의 원자 batch에 둔다", async () => {
  const createEnv = recordingEnv({
    batch(statements) {
      return statements.map((_, index) => index === 0
        ? { meta: { changes: 1 }, results: [{ id: 9 }] }
        : { meta: { changes: 1 }, results: [] });
    }
  });
  const created = await upsertDocumentSet(createEnv, { name: "감사 세트" }, "관리자");

  assert.deepEqual(created, { ok: true, id: 9 });
  assert.equal(createEnv.state.batches.length, 1);
  assert.equal(createEnv.state.batches[0].length, 2);
  assert.match(createEnv.state.batches[0][0].sql, /INSERT INTO document_sets/);
  assert.match(createEnv.state.batches[0][1].sql, /INSERT INTO document_set_logs/);

  const updateEnv = recordingEnv();
  const updated = await upsertDocumentSet(updateEnv, { id: 9, name: "감사 세트 개정", description: "설명", expectedRowVersion: 1 }, "관리자");

  assert.deepEqual(updated, { ok: true, id: 9 });
  assert.equal(updateEnv.state.batches.length, 1);
  assert.equal(updateEnv.state.batches[0].length, 3);
  assert.match(updateEnv.state.batches[0][0].sql, /INSERT INTO document_set_logs/);
  assert.match(updateEnv.state.batches[0][0].sql, /WHERE id = \? AND is_locked = 0/);
  assert.match(updateEnv.state.batches[0][1].sql, /UPDATE document_sets/);
  assert.match(updateEnv.state.batches[0][2].sql, /STALE_VERSION/);
});

test("세트 문서 추가는 정확한 후보 읽기 뒤 이력·touch·연결을 한 batch에 둔다", async () => {
  const env = recordingEnv({
    first: (sql) => sql.includes("addable_count")
      ? { id: 3, is_locked: 0, row_version: 1, addable_count: 2 }
      : null,
    all(sql) {
      if (sql.includes("SELECT d.id, d.document_number")) {
        return [
          { id: 10, document_number: "MR-2026-001" },
          { id: 11, document_number: "PV-2026-014" }
        ];
      }
      return [];
    },
    batch(statements) {
      return statements.map((_, index) => index === 3
        ? { meta: { changes: 2 }, results: [{ document_id: 10 }, { document_id: 11 }] }
        : { meta: { changes: 1 }, results: [] });
    }
  });

  const result = await addDocumentsToSet(env, 3, [10, 11, 10], "관리자", 1);

  assert.deepEqual(result, { added: 2 });
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 5);
  assert.match(statements[0].sql, /INSERT INTO document_set_logs/);
  assert.match(statements[0].sql, /i\.document_id IS NULL/);
  assert.match(statements[0].sql, /GROUP_CONCAT\(eligible\.document_number/);
  assert.deepEqual(JSON.parse(statements[0].args[0]), [10, 11]);
  assert.match(statements[1].sql, /UPDATE document_sets/);
  assert.match(statements[2].sql, /STALE_VERSION/);
  assert.match(statements[3].sql, /INSERT OR IGNORE INTO document_set_items/);
  assert.match(statements[4].sql, /STALE_VERSION/);
  assert.equal(countD1Statements(env.state), 6);
  assert.ok(countD1Statements(env.state) <= FREE_TIER_BUDGET.maxD1StatementsPerRequest);
});

test("세트 문서 제외는 이력·touch·삭제 순서와 원자 경계를 보존한다", async () => {
  const env = recordingEnv({
    first(sql) {
      return sql.includes("FROM document_set_items i")
        ? { set_name: "감사 세트", row_version: 1, document_number: "PV-2026-014" }
        : null;
    }
  });

  const result = await removeDocumentFromSet(env, 3, 10, "관리자", 1);

  assert.deepEqual(result, { ok: true });
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 5);
  assert.match(statements[0].sql, /INSERT INTO document_set_logs/);
  assert.match(statements[0].sql, /s\.is_locked = 0/);
  assert.match(statements[1].sql, /UPDATE document_sets/);
  assert.match(statements[2].sql, /STALE_VERSION/);
  assert.match(statements[3].sql, /DELETE FROM document_set_items/);
  assert.match(statements[4].sql, /STALE_VERSION/);
  assert.ok(statements[0].args.includes("문서 제외: PV-2026-014"));
});

test("랙 수정은 감사·랙·슬롯 동기화와 stale abort assertion을 한 batch에서 처리한다", async () => {
  const env = recordingEnv({
    first(sql) {
      if (sql.includes("SELECT id, zone_number") && sql.includes("FROM racks")) {
        return {
          id: 3,
          zone_number: 1,
          rack_number: 3,
          code: "1-03",
          name: "기존 랙",
          description: "",
          is_single_sided: 0,
          is_active: 1,
          column_count: 7,
          shelf_count: 6,
          row_version: 1
        };
      }
      if (sql.includes("SELECT COUNT(*) AS count")) return { count: 0 };
      return null;
    }
  });

  const id = await upsertRack(env, {
    id: 3,
    zoneNumber: 1,
    rackNumber: 3,
    name: "개정 랙",
    description: "설명",
    isSingleSided: false,
    isActive: true,
    columnCount: 7,
    shelfCount: 6,
    expectedRowVersion: 1
  }, actor);

  assert.equal(id, 3);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 5);
  assert.match(statements[0].sql, /INSERT INTO system_audit_logs/);
  assert.match(statements[0].sql, /NOT EXISTS/);
  assert.match(statements[1].sql, /UPDATE racks/);
  assert.match(statements[1].sql, /NOT EXISTS/);
  assert.match(statements[2].sql, /STALE_VERSION|abs\(-9223372036854775808\)/);
  assert.match(statements[3].sql, /UPDATE rack_slots/);
  assert.match(statements[3].sql, /column_count = \? AND shelf_count = \?/);
  assert.match(statements[4].sql, /INSERT INTO rack_slots/);
  assert.match(statements[4].sql, /column_count = \? AND shelf_count = \?/);
  assert.ok(countD1Statements(env.state) <= FREE_TIER_BUDGET.maxD1StatementsPerRequest);
});

test("랙 생성은 생성·abort assertion·감사·초기 슬롯을 한 batch에서 처리한다", async () => {
  const env = recordingEnv({
    batch(statements) {
      return statements.map((_, index) => index === 0
        ? { meta: { changes: 1 }, results: [{ id: 17 }] }
        : { meta: { changes: 1 }, results: [] });
    }
  });

  const id = await upsertRack(env, {
    zoneNumber: 2,
    rackNumber: 4,
    name: "신규 랙",
    description: "설명",
    isSingleSided: false,
    isActive: true,
    columnCount: 7,
    shelfCount: 6
  }, actor);

  assert.equal(id, 17);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 4);
  assert.match(statements[0].sql, /INSERT INTO racks/);
  assert.match(statements[0].sql, /RETURNING id/);
  assert.match(statements[1].sql, /STALE_VERSION|abs\(-9223372036854775808\)/);
  assert.match(statements[2].sql, /INSERT INTO system_audit_logs/);
  assert.match(statements[3].sql, /INSERT INTO rack_slots/);
  assert.match(statements[3].sql, /WHERE r\.code = \?/);
});

test("데이터 품질 분기는 COUNT와 페이지 목록에 같은 조건·정렬·결과 shape를 사용한다", async () => {
  assert.equal(normalizeDataQualityIssue("unknown"), "duplicate-number");

  for (const [issue, definition] of Object.entries(DATA_QUALITY_ISSUES)) {
    const item = { id: 7, document_number: "PV-2026-014" };
    const env = recordingEnv({
      batch: () => [
        { results: [{ count: 1 }], meta: { changes: 0 } },
        { results: [item], meta: { changes: 0 } }
      ]
    });

    const result = await getDataQualityPage(env, issue, 2, 10);

    assert.equal(env.state.batches.length, 1);
    assert.equal(env.state.batches[0].length, 2);
    assert.ok(env.state.batches[0][0].sql.includes(definition.condition));
    assert.ok(env.state.batches[0][1].sql.includes(definition.condition));
    assert.match(env.state.batches[0][1].sql, /ORDER BY d\.document_number, d\.revision_number, d\.id/);
    assert.deepEqual(env.state.batches[0][1].args, [10, 10]);
    assert.deepEqual(result.items, [item]);
    assert.deepEqual(
      { issue: result.issue, label: result.label, page: result.page, pageSize: result.pageSize, totalItems: result.totalItems, totalPages: result.totalPages },
      { issue, label: definition.label, page: 2, pageSize: 10, totalItems: 1, totalPages: 1 }
    );
  }
});

test("데이터 품질 페이지는 비유한 페이지 값을 D1 bind에 전달하지 않는다", async () => {
  const env = recordingEnv({
    batch: () => [
      { results: [{ count: 0 }], meta: { changes: 0 } },
      { results: [], meta: { changes: 0 } }
    ]
  });

  const result = await getDataQualityPage(env, "missing-location", Infinity, Infinity);

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 30);
  assert.deepEqual(env.state.batches[0][1].args, [30, 0]);
});

test("실제 SQLite에서 excluded 이력은 현재 대장 중복으로 집계되지 않는다", async () => {
  const { database, env } = await migratedSqliteEnv();
  try {
    const before = await getDataQualityPage(env, "duplicate-number", 1, 30);
    const current = database.prepare("SELECT * FROM documents WHERE sync_state = 'current' ORDER BY id LIMIT 1").get();
    database.prepare(`
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number, document_name,
        note, rack_slot_id, rack_face, status, revision_date, disposal_due_year, sync_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'excluded')
    `).run(
      `EXCLUDED-DUP-${current.id}`,
      current.category_id,
      current.document_number,
      current.revision_number,
      `${current.document_name} 이력`,
      current.note,
      current.rack_slot_id,
      current.rack_face,
      current.status,
      current.revision_date,
      current.disposal_due_year
    );
    const after = await getDataQualityPage(env, "duplicate-number", 1, 30);
    assert.equal(after.totalItems, before.totalItems);
  } finally {
    database.close();
  }
});

test("0038 호환 trigger는 구버전 UPDATE의 버전과 검색 ETag를 단조 증가시킨다", async () => {
  const { database, env } = await migratedSqliteEnv();
  try {
    const searchMetaBefore = await getSearchIndexMeta(env);
    const category = database.prepare("SELECT id, row_version FROM categories ORDER BY id LIMIT 1").get();
    database.prepare("UPDATE categories SET description = ? WHERE id = ?").run("구버전 category 수정", category.id);
    const categoryAfterLegacy = database.prepare("SELECT row_version FROM categories WHERE id = ?").get(category.id);
    assert.equal(categoryAfterLegacy.row_version, category.row_version + 1);

    const searchMetaAfter = await getSearchIndexMeta(env);
    assert.notEqual(searchMetaAfter.versionKey, searchMetaBefore.versionKey);

    database.prepare(`
      UPDATE categories
      SET description = ?, row_version = row_version + 1
      WHERE id = ? AND row_version = ?
    `).run("명시적 category 수정", category.id, categoryAfterLegacy.row_version);
    assert.equal(
      database.prepare("SELECT row_version FROM categories WHERE id = ?").get(category.id).row_version,
      categoryAfterLegacy.row_version + 1
    );

    const tag = database.prepare("SELECT id, row_version FROM tags ORDER BY id LIMIT 1").get();
    database.prepare("UPDATE tags SET description = ? WHERE id = ?").run("구버전 tag 수정", tag.id);
    assert.equal(database.prepare("SELECT row_version FROM tags WHERE id = ?").get(tag.id).row_version, tag.row_version + 1);

    const rack = database.prepare("SELECT id, row_version FROM racks ORDER BY id LIMIT 1").get();
    database.prepare("UPDATE racks SET description = ? WHERE id = ?").run("구버전 rack 수정", rack.id);
    assert.equal(database.prepare("SELECT row_version FROM racks WHERE id = ?").get(rack.id).row_version, rack.row_version + 1);

    const set = await upsertDocumentSet(env, { name: "구버전 세트 trigger 검증" }, actor);
    assert.equal(set.ok, true);
    const setBefore = database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(set.id);
    database.prepare("UPDATE document_sets SET description = ? WHERE id = ?").run("구버전 set 수정", set.id);
    assert.equal(
      database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(set.id).row_version,
      setBefore.row_version + 1
    );
  } finally {
    database.close();
  }
});

test("실제 SQLite에서 세트 batch 후반 실패는 앞선 이력·touch까지 롤백한다", async () => {
  const { database, env } = await migratedSqliteEnv();
  try {
    const created = await upsertDocumentSet(env, { name: "원자성 검증 세트" }, "관리자");
    assert.equal(created.ok, true);
    const documentId = Number(database.prepare("SELECT id FROM documents ORDER BY id LIMIT 1").get().id);

    database.exec(`
      CREATE TRIGGER fail_set_update
      BEFORE UPDATE OF name ON document_sets
      WHEN NEW.name = '실패해야 하는 세트명'
      BEGIN
        SELECT RAISE(ABORT, 'forced set update failure');
      END;
    `);
    const logsBeforeUpdate = database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ?").get(created.id).count;
    const failedUpdate = await upsertDocumentSet(env, { id: created.id, name: "실패해야 하는 세트명", expectedRowVersion: 1 }, "관리자");
    assert.equal(failedUpdate.ok, false);
    assert.match(failedUpdate.message, /forced set update failure/);
    assert.equal(database.prepare("SELECT name FROM document_sets WHERE id = ?").get(created.id).name, "원자성 검증 세트");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ?").get(created.id).count, logsBeforeUpdate);
    database.exec("DROP TRIGGER fail_set_update");

    database.exec(`
      CREATE TRIGGER fail_set_create_log
      BEFORE INSERT ON document_set_logs
      WHEN NEW.action = 'create' AND NEW.set_name = '롤백 생성 세트'
      BEGIN
        SELECT RAISE(ABORT, 'forced set create log failure');
      END;
    `);
    const failedCreate = await upsertDocumentSet(env, { name: "롤백 생성 세트" }, "관리자");
    assert.equal(failedCreate.ok, false);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_sets WHERE name = '롤백 생성 세트'").get().count, 0);
    database.exec("DROP TRIGGER fail_set_create_log");

    database.prepare("UPDATE document_sets SET updated_at = ? WHERE id = ?").run("2000-01-01 00:00:00", created.id);
    database.exec(`
      CREATE TRIGGER fail_set_item_insert
      BEFORE INSERT ON document_set_items
      WHEN NEW.set_id = ${created.id}
      BEGIN
        SELECT RAISE(ABORT, 'forced set item failure');
      END;
    `);
    const logsBeforeAdd = database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ?").get(created.id).count;

    await assert.rejects(
      addDocumentsToSet(env, created.id, [documentId], "관리자", 2),
      /forced set item failure/
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_items WHERE set_id = ?").get(created.id).count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ?").get(created.id).count, logsBeforeAdd);
    assert.equal(database.prepare("SELECT updated_at FROM document_sets WHERE id = ?").get(created.id).updated_at, "2000-01-01 00:00:00");

    database.exec("DROP TRIGGER fail_set_item_insert");
    assert.deepEqual(await addDocumentsToSet(env, created.id, [documentId], "관리자", 2), { added: 1 });
    database.prepare("UPDATE document_sets SET updated_at = ? WHERE id = ?").run("2001-01-01 00:00:00", created.id);
    database.exec(`
      CREATE TRIGGER fail_set_item_delete
      BEFORE DELETE ON document_set_items
      WHEN OLD.set_id = ${created.id}
      BEGIN
        SELECT RAISE(ABORT, 'forced set item delete failure');
      END;
    `);
    const logsBeforeRemove = database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ?").get(created.id).count;

    await assert.rejects(
      removeDocumentFromSet(env, created.id, documentId, "관리자", 4),
      /forced set item delete failure/
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_items WHERE set_id = ?").get(created.id).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ?").get(created.id).count, logsBeforeRemove);
    assert.equal(database.prepare("SELECT updated_at FROM document_sets WHERE id = ?").get(created.id).updated_at, "2001-01-01 00:00:00");
  } finally {
    database.close();
  }
});

test("실제 SQLite에서 세트 200건 추가와 부분 경합 감사·버전·삭제가 일치한다", async () => {
  const { database, env } = await migratedSqliteEnv();
  try {
    const categoryId = Number(database.prepare("SELECT id FROM categories ORDER BY id LIMIT 1").get().id);
    const rackSlotId = Number(database.prepare("SELECT id FROM rack_slots ORDER BY id LIMIT 1").get().id);
    const insertDocument = database.prepare(`
      INSERT INTO documents (
        storage_code, category_id, document_number, revision_number,
        document_name, rack_slot_id, rack_face, status
      ) VALUES (?, ?, ?, 'Rev.0', ?, ?, 'A', 'active')
    `);
    const documentIds = [];
    for (let index = 1; index <= 200; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const result = insertDocument.run(`OCC-BULK-${suffix}`, categoryId, `OCC-DOC-${suffix}`, `대량 검증 ${suffix}`, rackSlotId);
      documentIds.push(Number(result.lastInsertRowid));
    }

    const fullSet = await upsertDocumentSet(env, { name: "200건 직접 추가 검증" }, actor);
    assert.equal(fullSet.ok, true);
    assert.deepEqual(await addDocumentsToSet(env, fullSet.id, documentIds, actor, 1), { added: 200 });
    assert.equal(database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(fullSet.id).row_version, 2);
    assert.match(database.prepare("SELECT details FROM document_set_logs WHERE set_id = ? AND action = 'add' ORDER BY id DESC LIMIT 1").get(fullSet.id).details, /문서 200건 추가/);
    const fullLogCount = database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ? AND action = 'add'").get(fullSet.id).count;
    assert.deepEqual(await addDocumentsToSet(env, fullSet.id, documentIds, actor, 2), { added: 0 });
    assert.equal(database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(fullSet.id).row_version, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ? AND action = 'add'").get(fullSet.id).count, fullLogCount);
    assert.deepEqual(await setDocumentSetLock(env, fullSet.id, true, "대량 검증 잠금", actor, 2), { ok: true });
    assert.equal(database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(fullSet.id).row_version, 3);
    assert.deepEqual(await setDocumentSetLock(env, fullSet.id, false, "대량 검증 잠금 해제", actor, 3), { ok: true });
    assert.equal(database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(fullSet.id).row_version, 4);

    const partialSet = await upsertDocumentSet(env, { name: "부분 경합 검증" }, actor);
    assert.equal(partialSet.ok, true);
    database.prepare("INSERT INTO document_set_items (set_id, document_id) VALUES (?, ?)").run(partialSet.id, documentIds[0]);
    assert.deepEqual(await addDocumentsToSet(env, partialSet.id, documentIds, actor, 1), { added: 199 });
    const partialLog = database.prepare("SELECT details FROM document_set_logs WHERE set_id = ? AND action = 'add' ORDER BY id DESC LIMIT 1").get(partialSet.id).details;
    assert.match(partialLog, /문서 199건 추가/);
    assert.doesNotMatch(partialLog, /OCC-DOC-001/);
    assert.equal(database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(partialSet.id).row_version, 2);

    assert.deepEqual(await removeDocumentFromSet(env, partialSet.id, documentIds[1], actor, 2), { ok: true });
    assert.equal(database.prepare("SELECT row_version FROM document_sets WHERE id = ?").get(partialSet.id).row_version, 3);
    assert.deepEqual(await deleteDocumentSet(env, partialSet.id, actor, 3), { ok: true });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_sets WHERE id = ?").get(partialSet.id).count, 0);
  } finally {
    database.close();
  }
});

test("랙 추가는 구역별 번호를 독립적으로 사용하고 예약된 비활성 랙을 재활성화한다", async () => {
  const { database, env } = await migratedSqliteEnv();
  try {
    const zoneOne = database.prepare("SELECT id, is_active FROM racks WHERE zone_number = 1 AND rack_number = 1").get();
    const zoneTwo = database.prepare("SELECT id, is_active FROM racks WHERE zone_number = 2 AND rack_number = 1").get();
    assert.equal(zoneOne.is_active, 1);
    assert.equal(zoneTwo.is_active, 0);

    const rackId = await upsertRack(env, {
      zoneNumber: 2,
      rackNumber: 1,
      name: "2구역 1번 랙",
      description: "구역별 번호 검증",
      isSingleSided: false,
      isActive: true,
      columnCount: 7,
      shelfCount: 6
    }, actor);

    assert.equal(rackId, zoneTwo.id);
    assert.notEqual(rackId, zoneOne.id);
    assert.deepEqual(
      { ...database.prepare("SELECT zone_number, rack_number, code, is_active FROM racks WHERE id = ?").get(rackId) },
      { zone_number: 2, rack_number: 1, code: "2-01", is_active: 1 }
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM racks WHERE zone_number = 2 AND rack_number = 1").get().count,
      1
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM rack_slots WHERE rack_id = ? AND is_active = 1").get(rackId).count,
      42
    );
    assert.equal(
      database.prepare("SELECT action FROM system_audit_logs WHERE entity_type = 'rack' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(String(rackId)).action,
      "reactivate"
    );

    await assert.rejects(
      upsertRack(env, {
        zoneNumber: 2,
        rackNumber: 1,
        name: "중복 랙",
        description: "",
        isSingleSided: false,
        isActive: true,
        columnCount: 7,
        shelfCount: 6
      }, actor),
      (error) => error?.code === "RACK_LOCATION_EXISTS"
    );
  } finally {
    database.close();
  }
});

test("실제 SQLite에서 마스터·랙 동시 수정은 첫 버전만 반영하고 stale 감사를 남기지 않는다", async () => {
  const { database, env } = await migratedSqliteEnv();
  try {
    const category = database.prepare("SELECT * FROM categories ORDER BY id LIMIT 1").get();
    const categoryFirst = await upsertCategory(env, {
      id: category.id,
      name: `${category.name} OCC`,
      description: category.description || "",
      sortOrder: Number(category.sort_order || 0),
      isActive: Boolean(category.is_active),
      expectedRowVersion: category.row_version
    }, actor);
    assert.equal(categoryFirst.ok, true);
    const categoryAuditCount = database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'category' AND entity_id = ?").get(String(category.id)).count;
    const categoryStale = await upsertCategory(env, {
      id: category.id,
      name: `${category.name} stale`,
      description: "",
      sortOrder: Number(category.sort_order || 0),
      isActive: true,
      expectedRowVersion: category.row_version
    }, actor);
    assert.equal(categoryStale.ok, false);
    assert.match(categoryStale.message, /새로고침/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'category' AND entity_id = ?").get(String(category.id)).count, categoryAuditCount);

    const tag = database.prepare("SELECT * FROM tags ORDER BY id LIMIT 1").get();
    const tagFirst = await upsertTag(env, {
      id: tag.id,
      name: `${tag.name} OCC`,
      description: tag.description || "",
      isActive: Boolean(tag.is_active),
      expectedRowVersion: tag.row_version
    }, actor);
    assert.equal(tagFirst.ok, true);
    const tagStale = await upsertTag(env, {
      id: tag.id,
      name: `${tag.name} stale`,
      description: "",
      isActive: true,
      expectedRowVersion: tag.row_version
    }, actor);
    assert.equal(tagStale.ok, false);
    assert.match(tagStale.message, /새로고침/);

    const rack = database.prepare("SELECT * FROM racks WHERE is_active = 1 ORDER BY id LIMIT 1").get();
    const rackValues = {
      id: rack.id,
      zoneNumber: rack.zone_number,
      rackNumber: rack.rack_number,
      name: `${rack.name || rack.code} OCC`,
      description: rack.description || "",
      isSingleSided: Boolean(rack.is_single_sided),
      isActive: true,
      columnCount: rack.column_count,
      shelfCount: rack.shelf_count,
      expectedRowVersion: rack.row_version
    };
    assert.equal(await upsertRack(env, rackValues, actor), rack.id);
    const rackAuditCount = database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'rack' AND entity_id = ?").get(String(rack.id)).count;
    await assert.rejects(upsertRack(env, { ...rackValues, name: "stale rack" }, actor), /새로고침/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'rack' AND entity_id = ?").get(String(rack.id)).count, rackAuditCount);
  } finally {
    database.close();
  }
});

test("실제 SQLite에서 랙 일괄 설정은 단조 버전 claim으로 stale 제출을 롤백한다", async () => {
  const { database, env } = await migratedSqliteEnv();
  try {
    const counts = Object.fromEntries([1, 2, 3].map((zone) => [
      zone,
      Number(database.prepare("SELECT COALESCE(MAX(rack_number), 0) AS count FROM racks WHERE zone_number = ?").get(zone).count)
    ]));
    const expectedVersion = await getRackConfigurationVersion(env);
    const rackVersionsBefore = database.prepare("SELECT id, row_version FROM racks WHERE is_active = 1 ORDER BY id").all();
    const first = await configureRackCounts(env, counts, actor, expectedVersion);
    assert.deepEqual(first, { ok: true });
    const rackVersionsAfter = database.prepare("SELECT id, row_version FROM racks WHERE is_active = 1 ORDER BY id").all();
    assert.ok(rackVersionsAfter.some((rack, index) => rack.row_version > rackVersionsBefore[index].row_version));
    const audits = database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'rack_configuration'").get().count;
    const stale = await configureRackCounts(env, counts, actor, expectedVersion);
    assert.equal(stale.ok, false);
    assert.match(stale.message, /새로고침/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'rack_configuration'").get().count, audits);
  } finally {
    database.close();
  }
});

test("실제 SQLite에서 슬롯 동기화 실패는 랙 수정과 시스템 감사까지 롤백한다", async () => {
  const { database, env } = await migratedSqliteEnv();
  try {
    database.exec(`
      CREATE TRIGGER fail_rack_slot_insert
      BEFORE INSERT ON rack_slots
      WHEN (SELECT code FROM racks WHERE id = NEW.rack_id) = '3-14'
      BEGIN
        SELECT RAISE(ABORT, 'forced rack slot insert failure');
      END;
    `);
    await assert.rejects(upsertRack(env, {
      zoneNumber: 3,
      rackNumber: 14,
      name: "롤백 생성 랙",
      description: "",
      isSingleSided: false,
      isActive: true,
      columnCount: 7,
      shelfCount: 6
    }, actor), /forced rack slot insert failure/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM racks WHERE code = '3-14'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'rack' AND entity_reference = '3-14'").get().count, 0);
    database.exec("DROP TRIGGER fail_rack_slot_insert");

    const rackId = await upsertRack(env, {
      zoneNumber: 3,
      rackNumber: 14,
      name: "원자성 검증 랙",
      description: "",
      isSingleSided: false,
      isActive: true,
      columnCount: 7,
      shelfCount: 6
    }, actor);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM rack_slots WHERE rack_id = ? AND is_active = 1").get(rackId).count, 42);

    database.exec(`
      CREATE TRIGGER fail_rack_slot_update
      BEFORE UPDATE ON rack_slots
      WHEN OLD.rack_id = ${rackId}
      BEGIN
        SELECT RAISE(ABORT, 'forced rack slot failure');
      END;
    `);
    const auditsBefore = database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'rack' AND entity_id = ?").get(rackId).count;
    const expectedRowVersion = Number(database.prepare("SELECT row_version FROM racks WHERE id = ?").get(rackId).row_version);

    await assert.rejects(upsertRack(env, {
      id: rackId,
      zoneNumber: 3,
      rackNumber: 14,
      name: "반영되면 안 되는 이름",
      description: "",
      isSingleSided: false,
      isActive: true,
      columnCount: 6,
      shelfCount: 5,
      expectedRowVersion
    }, actor), /forced rack slot failure/);

    const rack = database.prepare("SELECT name, column_count, shelf_count FROM racks WHERE id = ?").get(rackId);
    assert.deepEqual({ ...rack }, { name: "원자성 검증 랙", column_count: 7, shelf_count: 6 });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_audit_logs WHERE entity_type = 'rack' AND entity_id = ?").get(rackId).count, auditsBefore);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM rack_slots WHERE rack_id = ? AND is_active = 1").get(rackId).count, 42);

    database.exec("DROP TRIGGER fail_rack_slot_update");
    await upsertRack(env, {
      id: rackId,
      zoneNumber: 3,
      rackNumber: 14,
      name: "정상 개정 랙",
      description: "",
      isSingleSided: false,
      isActive: true,
      columnCount: 6,
      shelfCount: 5,
      expectedRowVersion
    }, actor);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM rack_slots WHERE rack_id = ? AND is_active = 1").get(rackId).count, 30);
    assert.equal(database.prepare("SELECT name FROM racks WHERE id = ?").get(rackId).name, "정상 개정 랙");
  } finally {
    database.close();
  }
});

function recordingEnv({ first = () => null, all = () => [], run = () => 1, batch = null } = {}) {
  const state = { calls: [], batches: [] };

  function statement(sql, args = []) {
    return {
      sql,
      args,
      bind(...nextArgs) {
        if (nextArgs.length > FREE_TIER_BUDGET.maxD1BoundParametersPerStatement) {
          throw new RangeError(`D1 statement bind count ${nextArgs.length} exceeds ${FREE_TIER_BUDGET.maxD1BoundParametersPerStatement}`);
        }
        return statement(sql, nextArgs);
      },
      async first() {
        state.calls.push({ type: "first", sql, args });
        return first(sql, args);
      },
      async all() {
        state.calls.push({ type: "all", sql, args });
        return { results: all(sql, args) };
      },
      async run() {
        state.calls.push({ type: "run", sql, args });
        return { meta: { changes: run(sql, args) } };
      }
    };
  }

  return {
    state,
    DB: {
      prepare(sql) {
        return statement(sql);
      },
      async batch(statements) {
        state.batches.push(statements.map(({ sql, args }) => ({ sql, args })));
        return batch
          ? batch(statements)
          : statements.map(() => ({ meta: { changes: 1 }, results: [] }));
      }
    }
  };
}

function countD1Statements(state) {
  return state.calls.length + state.batches.reduce((sum, statements) => sum + statements.length, 0);
}

async function migratedSqliteEnv() {
  const database = new DatabaseSync(":memory:");
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const migrations = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    database.exec(await readFile(new URL(migration, migrationsUrl), "utf8"));
  }
  return { database, env: { DB: sqliteD1(database) } };
}

function sqliteD1(database) {
  function statement(sql, args = []) {
    return {
      sql,
      args,
      bind(...nextArgs) {
        if (nextArgs.length > FREE_TIER_BUDGET.maxD1BoundParametersPerStatement) {
          throw new RangeError(`D1 statement bind count ${nextArgs.length} exceeds ${FREE_TIER_BUDGET.maxD1BoundParametersPerStatement}`);
        }
        return statement(sql, nextArgs);
      },
      async first() {
        return database.prepare(sql).get(...args) ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...args) };
      },
      async run() {
        const result = database.prepare(sql).run(...args);
        return {
          meta: {
            changes: Number(result.changes || 0),
            last_row_id: Number(result.lastInsertRowid || 0)
          }
        };
      }
    };
  }

  return {
    prepare(sql) {
      return statement(sql);
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(({ sql, args }) => {
          if (/\bRETURNING\b/i.test(sql)) {
            const rows = database.prepare(sql).all(...args);
            return {
              results: rows,
              meta: {
                changes: Number(database.prepare("SELECT changes() AS count").get().count || 0),
                last_row_id: Number(database.prepare("SELECT last_insert_rowid() AS id").get().id || 0)
              }
            };
          }
          if (/^\s*(?:WITH[\s\S]+?\)\s*)?SELECT\b/i.test(sql)) {
            return { results: database.prepare(sql).all(...args), meta: { changes: 0 } };
          }
          const result = database.prepare(sql).run(...args);
          return {
            results: [],
            meta: {
              changes: Number(result.changes || 0),
              last_row_id: Number(result.lastInsertRowid || 0)
            }
          };
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
