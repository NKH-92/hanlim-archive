import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DATA_QUALITY_ISSUES, getDataQualityPage } from "../src/domains/dataQuality/index.js";
import { getDocumentQualitySummary } from "../src/domains/documents/index.js";

const SUMMARY_FIELDS = Object.freeze({
  "duplicate-number": "duplicateDocumentNumbers",
  "missing-location": "missingLocation",
  "inactive-category": "missingCategory",
  "invalid-face": "invalidRackFace",
  "suspicious-text": "suspiciousText",
  "missing-disposal-year": "missingDisposalYear"
});

test("대시보드 품질 숫자는 각 상세 작업목록의 수정 대상 문서 행 수와 같다", async () => {
  const database = qualityDatabase();
  const state = { direct: 0, batches: [] };
  const env = { DB: sqliteD1(database, state) };

  try {
    const summary = await getDocumentQualitySummary(env);
    assert.equal(state.direct, 1, "대시보드 집계는 한 번의 D1 round trip을 유지한다");

    const expected = {
      "duplicate-number": 2,
      "missing-location": 3,
      "inactive-category": 2,
      "invalid-face": 1,
      "suspicious-text": 1,
      "missing-disposal-year": 1
    };

    for (const [issue, field] of Object.entries(SUMMARY_FIELDS)) {
      const detail = await getDataQualityPage(env, issue, 1, 100);
      assert.equal(summary[field], detail.totalItems, `${issue} 대시보드와 상세 건수`);
      assert.equal(summary[field], expected[issue], `${issue} 문서 행 수`);
    }
  } finally {
    database.close();
  }
});

test("품질 집계 SQL은 상세 분기 조건을 직접 재사용하고 공개 결과 shape를 유지한다", async () => {
  let summarySql = "";
  const env = {
    DB: {
      prepare(sql) {
        summarySql = sql;
        return {
          async first() {
            return {
              duplicate_document_numbers: 2,
              missing_location: 3,
              missing_category: 2,
              invalid_rack_face: 1,
              suspicious_text: 1,
              documents_without_tags: 8,
              missing_disposal_year: 1,
              disposed_documents: 1
            };
          }
        };
      }
    }
  };

  const summary = await getDocumentQualitySummary(env);

  for (const definition of Object.values(DATA_QUALITY_ISSUES)) {
    assert.ok(summarySql.includes(definition.condition));
  }
  assert.deepEqual(summary, {
    duplicateDocumentNumbers: 2,
    missingLocation: 3,
    missingCategory: 2,
    invalidRackFace: 1,
    suspiciousText: 1,
    documentsWithoutTags: 8,
    missingDisposalYear: 1,
    disposedDocuments: 1
  });
});

function qualityDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      name TEXT,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE racks (
      id INTEGER PRIMARY KEY,
      code TEXT,
      zone_number INTEGER,
      rack_number INTEGER,
      is_single_sided INTEGER NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE rack_slots (
      id INTEGER PRIMARY KEY,
      rack_id INTEGER,
      column_number INTEGER,
      shelf_number INTEGER,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      category_id INTEGER,
      rack_slot_id INTEGER,
      document_number TEXT NOT NULL,
      revision_number TEXT NOT NULL,
      document_name TEXT NOT NULL,
      note TEXT,
      disposal_due_year INTEGER,
      rack_face TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE document_tags (document_id INTEGER, tag_id INTEGER);

    INSERT INTO categories VALUES (1, '사용 분류', 1), (2, '중지 분류', 0);
    INSERT INTO racks VALUES
      (1, '1-01', 1, 1, 0, 1),
      (2, '1-02', 1, 2, 0, 0),
      (3, '1-03', 1, 3, 1, 1);
    INSERT INTO rack_slots VALUES
      (1, 1, 1, 1, 1),
      (2, 1, 2, 1, 0),
      (3, 2, 1, 1, 1),
      (4, 3, 1, 1, 1);

    INSERT INTO documents VALUES
      (1, 1, 1, 'DUP-001', 'Rev.0', '정상 문서 1', '', 2030, 'A', 'active'),
      (2, 1, 1, 'dup-001', 'rev.0', '정상 문서 2', '', 2030, 'A', 'active'),
      (3, 1, NULL, 'LOC-001', 'Rev.0', '위치 누락', '', 2030, 'A', 'active'),
      (4, 1, 2, 'LOC-002', 'Rev.0', '슬롯 비활성', '', 2030, 'A', 'active'),
      (5, 1, 3, 'LOC-003', 'Rev.0', '랙 비활성', '', 2030, 'A', 'active'),
      (6, 2, 1, 'CAT-001', 'Rev.0', '분류 비활성', '', 2030, 'A', 'active'),
      (7, NULL, 1, 'CAT-002', 'Rev.0', '분류 누락', '', 2030, 'A', 'active'),
      (8, 1, 4, 'FACE-001', 'Rev.0', '단면 2면', '', 2030, 'B', 'active'),
      (9, 1, 1, 'TEXT-001', 'Rev.0', 'Ã 깨진 문서', '', 2030, 'A', 'disposed'),
      (10, 1, 1, 'YEAR-001', 'Rev.0', '연도 누락', '', NULL, 'A', 'active');
    INSERT INTO document_tags VALUES (1, 1), (2, 1);
  `);
  return database;
}

function sqliteD1(database, state) {
  function statement(sql, args = []) {
    return {
      sql,
      args,
      bind(...nextArgs) {
        return statement(sql, nextArgs);
      },
      async first() {
        state.direct += 1;
        return database.prepare(sql).get(...args) ?? null;
      },
      async all() {
        state.direct += 1;
        return { results: database.prepare(sql).all(...args) };
      }
    };
  }

  return {
    prepare(sql) {
      return statement(sql);
    },
    async batch(statements) {
      state.batches.push(statements.length);
      return statements.map(({ sql, args }) => ({
        results: database.prepare(sql).all(...args),
        meta: { changes: 0 }
      }));
    }
  };
}
