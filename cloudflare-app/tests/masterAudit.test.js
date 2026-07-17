import assert from "node:assert/strict";
import test from "node:test";

import { upsertCategory } from "../src/data/mastersData.js";
import { upsertRack } from "../src/data/racksData.js";

const actor = {
  userId: 4,
  username: "operator",
  displayName: "운영자",
  role: "User",
  can_manage_masters: 1
};

test("대분류 수정은 시스템 감사 INSERT를 상태 UPDATE 앞에 같은 batch로 둔다", async () => {
  const env = recordingEnv({
    first(sql) {
      if (sql.includes("SELECT * FROM categories")) {
        return { id: 2, name: "기존", description: "이전", sort_order: 1, is_active: 1 };
      }
      return null;
    }
  });

  const result = await upsertCategory(env, {
    id: 2,
    name: "개정",
    description: "변경",
    sortOrder: 2,
    isActive: true
  }, actor);

  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  assert.match(env.state.batches[0][0].sql, /INSERT INTO system_audit_logs/);
  assert.match(env.state.batches[0][1].sql, /UPDATE categories/);
});

test("랙 수정은 시스템 감사와 랙 UPDATE를 먼저 원자 처리한 뒤 슬롯을 동기화한다", async () => {
  const env = recordingEnv({
    first(sql) {
      if (sql.includes("FROM racks") && sql.includes("WHERE id = ?")) {
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
  assert.equal(env.state.batches.length, 2);
  assert.match(env.state.batches[0][0].sql, /INSERT INTO system_audit_logs/);
  assert.match(env.state.batches[0][1].sql, /UPDATE racks/);
  assert.match(env.state.batches[1][0].sql, /UPDATE rack_slots/);
});

function recordingEnv({ first }) {
  const state = { batches: [] };
  function statement(sql, args = []) {
    return {
      sql,
      args,
      bind(...nextArgs) {
        return statement(sql, nextArgs);
      },
      async first() {
        return first(sql, args);
      },
      async all() {
        return { results: [] };
      },
      async run() {
        return { meta: { changes: 1 } };
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
        state.batches.push(statements);
        return statements.map(() => ({ meta: { changes: 1 }, results: [] }));
      }
    }
  };
}
