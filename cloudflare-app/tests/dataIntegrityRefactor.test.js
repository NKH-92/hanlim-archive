import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  DATA_QUALITY_ISSUES,
  addDocumentsToSet,
  getDataQualityPage,
  normalizeDataQualityIssue,
  removeDocumentFromSet,
  upsertDocumentSet,
  upsertRack
} from "../src/db.js";
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
  const updated = await upsertDocumentSet(updateEnv, { id: 9, name: "감사 세트 개정", description: "설명" }, "관리자");

  assert.deepEqual(updated, { ok: true, id: 9 });
  assert.equal(updateEnv.state.batches.length, 1);
  assert.equal(updateEnv.state.batches[0].length, 2);
  assert.match(updateEnv.state.batches[0][0].sql, /INSERT INTO document_set_logs/);
  assert.match(updateEnv.state.batches[0][0].sql, /WHERE id = \? AND is_locked = 0/);
  assert.match(updateEnv.state.batches[0][1].sql, /UPDATE document_sets/);
});

test("세트 문서 추가는 정확한 후보 읽기 뒤 이력·touch·연결을 한 batch에 둔다", async () => {
  const env = recordingEnv({
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
      return statements.map((_, index) => index === 2
        ? { meta: { changes: 2 }, results: [{ document_id: 10 }, { document_id: 11 }] }
        : { meta: { changes: 1 }, results: [] });
    }
  });

  const result = await addDocumentsToSet(env, 3, [10, 11, 10], "관리자");

  assert.deepEqual(result, { added: 2 });
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /INSERT INTO document_set_logs/);
  assert.match(statements[0].sql, /i\.document_id IS NULL/);
  assert.ok(statements[0].args.includes("문서 2건 추가: MR-2026-001, PV-2026-014"));
  assert.match(statements[1].sql, /UPDATE document_sets/);
  assert.match(statements[2].sql, /INSERT OR IGNORE INTO document_set_items/);
  assert.equal(countD1Statements(env.state), 4);
  assert.ok(countD1Statements(env.state) <= FREE_TIER_BUDGET.maxD1StatementsPerRequest);
});

test("세트 문서 제외는 이력·touch·삭제 순서와 원자 경계를 보존한다", async () => {
  const env = recordingEnv({
    first(sql) {
      return sql.includes("FROM document_set_items i")
        ? { set_name: "감사 세트", document_number: "PV-2026-014" }
        : null;
    }
  });

  const result = await removeDocumentFromSet(env, 3, 10, "관리자");

  assert.deepEqual(result, { ok: true });
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /INSERT INTO document_set_logs/);
  assert.match(statements[0].sql, /s\.is_locked = 0/);
  assert.match(statements[1].sql, /UPDATE document_sets/);
  assert.match(statements[2].sql, /DELETE FROM document_set_items/);
  assert.ok(statements[0].args.includes("문서 제외: PV-2026-014"));
});

test("랙 수정은 감사·랙·슬롯 동기화를 하나의 4문장 batch에서 처리한다", async () => {
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
          shelf_count: 6
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
    shelfCount: 6
  }, actor);

  assert.equal(id, 3);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 4);
  assert.match(statements[0].sql, /INSERT INTO system_audit_logs/);
  assert.match(statements[0].sql, /NOT EXISTS/);
  assert.match(statements[1].sql, /UPDATE racks/);
  assert.match(statements[1].sql, /NOT EXISTS/);
  assert.match(statements[2].sql, /UPDATE rack_slots/);
  assert.match(statements[2].sql, /column_count = \? AND shelf_count = \?/);
  assert.match(statements[3].sql, /INSERT INTO rack_slots/);
  assert.match(statements[3].sql, /column_count = \? AND shelf_count = \?/);
  assert.ok(countD1Statements(env.state) <= FREE_TIER_BUDGET.maxD1StatementsPerRequest);
});

test("랙 생성은 생성·감사·초기 슬롯을 하나의 3문장 batch에서 처리한다", async () => {
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
  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /INSERT INTO racks/);
  assert.match(statements[0].sql, /RETURNING id/);
  assert.match(statements[1].sql, /INSERT INTO system_audit_logs/);
  assert.match(statements[2].sql, /INSERT INTO rack_slots/);
  assert.match(statements[2].sql, /WHERE r\.code = \?/);
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
    const failedUpdate = await upsertDocumentSet(env, { id: created.id, name: "실패해야 하는 세트명" }, "관리자");
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
      addDocumentsToSet(env, created.id, [documentId], "관리자"),
      /forced set item failure/
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_items WHERE set_id = ?").get(created.id).count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ?").get(created.id).count, logsBeforeAdd);
    assert.equal(database.prepare("SELECT updated_at FROM document_sets WHERE id = ?").get(created.id).updated_at, "2000-01-01 00:00:00");

    database.exec("DROP TRIGGER fail_set_item_insert");
    assert.deepEqual(await addDocumentsToSet(env, created.id, [documentId], "관리자"), { added: 1 });
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
      removeDocumentFromSet(env, created.id, documentId, "관리자"),
      /forced set item delete failure/
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_items WHERE set_id = ?").get(created.id).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM document_set_logs WHERE set_id = ?").get(created.id).count, logsBeforeRemove);
    assert.equal(database.prepare("SELECT updated_at FROM document_sets WHERE id = ?").get(created.id).updated_at, "2001-01-01 00:00:00");
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

    await assert.rejects(upsertRack(env, {
      id: rackId,
      zoneNumber: 3,
      rackNumber: 14,
      name: "반영되면 안 되는 이름",
      description: "",
      isSingleSided: false,
      isActive: true,
      columnCount: 6,
      shelfCount: 5
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
      shelfCount: 5
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
