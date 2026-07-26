import { FREE_TIER_BUDGET } from "../../src/freeTierBudget.js";

export function sampleDocument(overrides = {}) {
  return {
    id: 1,
    storage_code: "ARC-000001",
    document_number: "MR-001",
    revision_number: "Rev.0",
    revision_date: "2026-07-17",
    disposal_due_year: 2031,
    document_name: "문서",
    category_name: "제조기록서",
    category_id: 1,
    rack_slot_id: 1,
    rack_face: "A",
    status: "active",
    rack_code: "1-01",
    zone_number: 1,
    rack_number: 1,
    column_number: 1,
    shelf_number: 1,
    slot_code: "1-1",
    updated_at: "2026-07-01 09:00:00",
    row_version: 1,
    note: "",
    ...overrides
  };
}

export function recordingEnv({ first = () => null, all = () => [], run = () => 1, batch = null } = {}) {
  const state = { calls: [], batches: [] };
  return {
    state,
    DB: {
      prepare(sql) {
        return {
          sql,
          args: [],
          bind(...args) {
            if (args.length > FREE_TIER_BUDGET.maxD1BoundParametersPerStatement) {
              throw new RangeError(`D1 statement bind count ${args.length} exceeds ${FREE_TIER_BUDGET.maxD1BoundParametersPerStatement}`);
            }
            return boundStatement(sql, args, state, { first, all, run });
          },
          async first() {
            state.calls.push({ sql, args: [], type: "first" });
            return first(sql, []);
          },
          async all() {
            state.calls.push({ sql, args: [], type: "all" });
            return { results: all(sql, []) };
          },
          async run() {
            state.calls.push({ sql, args: [], type: "run" });
            return { meta: { changes: run(sql, []) } };
          }
        };
      },
      async batch(statements) {
        state.batches.push(statements.map((statement) => ({ sql: statement.sql, args: statement.args })));
        return batch ? batch(statements) : statements.map(() => ({ meta: { changes: 1 } }));
      }
    }
  };
}

function boundStatement(sql, args, state, callbacks) {
  return {
    sql,
    args,
    async first() {
      state.calls.push({ sql, args, type: "first" });
      return callbacks.first(sql, args);
    },
    async all() {
      state.calls.push({ sql, args, type: "all" });
      return { results: callbacks.all(sql, args) };
    },
    async run() {
      state.calls.push({ sql, args, type: "run" });
      return { meta: { changes: callbacks.run(sql, args) } };
    }
  };
}
