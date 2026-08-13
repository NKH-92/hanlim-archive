import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveRacks,
  getRackGrid,
  getRackSummaries,
  getSlotOptions
} from "../src/domains/racks/index.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

function recordingEnv(database) {
  const statements = [];
  const adapter = sqliteD1(database);
  return {
    statements,
    env: {
      DB: {
        ...adapter,
        prepare(sql) {
          statements.push(sql);
          return adapter.prepare(sql);
        }
      }
    }
  };
}

function queryPlan(database, sql, ...binds) {
  return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...binds)
    .map((row) => String(row.detail || ""))
    .join("\n");
}

test("location aggregates use the covering document index", async () => {
  const database = await createMigratedDatabase();
  const { env, statements } = recordingEnv(database);
  try {
    const indexColumns = database.prepare("PRAGMA index_info('idx_documents_location_current_state')")
      .all()
      .map((row) => row.name);
    assert.deepEqual(indexColumns, ["rack_slot_id", "sync_state", "rack_face", "status"]);

    const rackId = Number(database.prepare("SELECT id FROM racks WHERE is_active = 1 ORDER BY id LIMIT 1").get().id);
    await getRackSummaries(env);
    await getRackGrid(env, rackId);
    await getSlotOptions(env);

    assert.match(queryPlan(database, statements[0]), /idx_documents_location_current_state/);
    assert.match(queryPlan(database, statements[1], rackId), /idx_documents_location_current_state/);
    assert.match(queryPlan(database, statements[2]), /idx_documents_location_current_state/);
  } finally {
    database.close();
  }
});

test("rack option reads do not aggregate documents", async () => {
  const database = await createMigratedDatabase();
  const { env, statements } = recordingEnv(database);
  try {
    const racks = await getActiveRacks(env);

    assert.ok(racks.length > 0);
    assert.equal(racks.every((rack) => Number(rack.is_active) === 1), true);
    assert.equal(racks.every((rack) => !Object.hasOwn(rack, "document_count")), true);
    assert.doesNotMatch(statements[0], /\bdocuments\b/i);
  } finally {
    database.close();
  }
});
