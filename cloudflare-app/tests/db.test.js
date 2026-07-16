import assert from "node:assert/strict";
import test from "node:test";

import {
  addDocumentsToSet,
  buildFloorPlanLayout,
  buildSearchSuggestions,
  buildViewerFacets,
  compactSearchText,
  deleteDocumentSet,
  documentToViewerItem,
  disposeDocument,
  disposeDocumentsBulk,
  getDocumentQualitySummary,
  getSearchIndexMeta,
  levenshteinDistance,
  MAX_SEARCH_RESULTS,
  parseDocumentFilters,
  parseDocumentNumberList,
  parseSearchQuery,
  permanentlyDeleteDocument,
  removeDocumentFromSet,
  restoreDocument,
  scoreDocumentMatch,
  searchDocuments,
  searchTokens,
  updateDocument,
  upsertDocumentSet,
  validateDocumentInput
} from "../src/db.js";

test("parseDocumentNumberList splits, trims, and dedupes pasted numbers", () => {
  const numbers = parseDocumentNumberList("MR-2026-001, PV-2026-014\n mr-2026-001 ;\tARC-000002\n\n");

  assert.deepEqual(numbers, ["MR-2026-001", "PV-2026-014", "ARC-000002"]);
  assert.deepEqual(parseDocumentNumberList(""), []);
  assert.deepEqual(parseDocumentNumberList(null), []);
  // 공백 구분도 지원한다(감사관이 부른 번호를 공백으로 붙여넣는 경우).
  assert.deepEqual(parseDocumentNumberList("NOPE-999  ARC-000001 PV-2026-014"), ["NOPE-999", "ARC-000001", "PV-2026-014"]);
});

test("search normalization supports partial numbers, spacing, and light typos", () => {
  const document = {
    storage_code: "ARC-000123",
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    tag_names: "중요문서; 원본보관",
    rack_code: "2-01",
    zone_number: 2,
    rack_number: 1,
    is_single_sided: 0,
    column_number: 3,
    shelf_number: 2,
    rack_face: "A",
    note: ""
  };

  assert.deepEqual(searchTokens("PV 2026"), ["pv", "2026", "pv2026"]);
  assert.equal(compactSearchText("PV-2026 014"), "pv2026014");
  assert.equal(levenshteinDistance("밸리데이션", "밸리데이선"), 1);
  assert.ok(scoreDocumentMatch(document, "2026-014").relevance_score > 0);
  assert.ok(scoreDocumentMatch(document, "밸리데이선").relevance_score > 0);
  assert.ok(scoreDocumentMatch(document, "2구역 1랙").relevance_score > 0);
  // 면 단위 랙 표기(양면 1번 랙 A면 = "1-1")로도 찾을 수 있어야 한다.
  assert.ok(scoreDocumentMatch(document, "1-1").relevance_score > 0);
  assert.equal(scoreDocumentMatch(document, "완전히다른검색어").relevance_score, 0);
});

test("parseDocumentFilters supports URLSearchParams and normalizes invalid values", () => {
  const params = new URLSearchParams({
    q: "PV",
    category: "2",
    zoneNumber: "3",
    tag: "4",
    status: "disposed",
    sort: "location"
  });

  assert.deepEqual(parseDocumentFilters(params), {
    categoryId: 2,
    zoneNumber: 3,
    tagId: 4,
    status: "disposed",
    sort: "location"
  });
  assert.deepEqual(parseDocumentFilters({ category: "1.5", status: "unknown", sort: "drop-table", q: "검색" }), {
    categoryId: 0,
    zoneNumber: 0,
    tagId: 0,
    status: "",
    sort: "relevance"
  });
});

test("parseSearchQuery preserves the original token for removable filter chips", () => {
  const parsed = parseSearchQuery("2구역 PV 폐기문서", {
    categories: [{ id: 7, name: "PV" }],
    tags: []
  });

  assert.equal(parsed.text, "");
  assert.deepEqual(parsed.chips.map((chip) => chip.token), ["2구역", "PV", "폐기문서"]);
});

test("buildSearchSuggestions never exceeds the requested limit", () => {
  const suggestions = buildSearchSuggestions([{
    document_number: "PV-2026-014",
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    rack_code: "2-01"
  }], 2);

  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions.map((item) => item.type), ["document_number", "document_name"]);
});

test("authoritative searches score the full configured result window deterministically", async () => {
  const env = recordingEnv({ all: () => [] });

  await searchDocuments(env, "PV", MAX_SEARCH_RESULTS);

  const documentQuery = env.state.calls.find((call) =>
    call.type === "all" && call.sql.includes("FROM documents d") && call.sql.includes("LIMIT ?")
  );
  assert.ok(documentQuery);
  assert.equal(documentQuery.args.at(-1), MAX_SEARCH_RESULTS);
  assert.match(documentQuery.sql, /ORDER BY d\.updated_at DESC, d\.id DESC\s+LIMIT \?/);
});

test("getSearchIndexMeta preserves every master and rack update stamp in the version key", async () => {
  let sql = "";
  const row = {
    count: 3,
    max_id: 9,
    documents_updated: "2026-07-10 10:00:00",
    categories_updated: "2026-07-02 11:00:00",
    tags_updated: "2026-06-30 09:00:00",
    racks_updated: "2026-07-01 12:00:00",
    slots_updated: "2026-07-01 08:00:00"
  };
  const env = {
    DB: {
      prepare(query) {
        sql = query;
        return { first: async () => row };
      }
    }
  };

  const before = await getSearchIndexMeta(env);
  row.tags_updated = "2026-06-30 09:01:00";
  const after = await getSearchIndexMeta(env);

  assert.equal(before.count, 3);
  assert.equal(before.maxId, 9);
  // 문서가 가장 최신이어도 더 오래된 태그 시각 변경이 버전 키를 바꿔야 한다.
  assert.equal(before.updated, "2026-07-10 10:00:00");
  assert.equal(after.updated, before.updated);
  assert.equal(before.versionKey, "20260710100000-20260702110000-20260630090000-20260701120000-20260701080000");
  assert.equal(after.versionKey, "20260710100000-20260702110000-20260630090100-20260701120000-20260701080000");
  assert.notEqual(after.versionKey, before.versionKey);
  assert.match(sql, /FROM categories/);
  assert.match(sql, /FROM tags/);
  assert.match(sql, /FROM racks/);
  assert.match(sql, /FROM rack_slots/);
});

test("validateDocumentInput rejects missing or inactive tags", async () => {
  const env = recordingEnv({
    first: (sql) => {
      if (sql.includes("FROM categories")) return { id: 1, is_active: 1 };
      if (sql.includes("FROM rack_slots")) return { id: 2, is_single_sided: 0 };
      return null;
    },
    all: (sql) => {
      if (sql.includes("FROM tags")) return [{ id: 10, is_active: 1 }, { id: 11, is_active: 0 }];
      return [];
    }
  });

  const base = {
    documentNumber: "MR-001",
    revisionNumber: "Rev.0",
    documentName: "문서",
    categoryId: 1,
    rackSlotId: 2,
    rackFace: "A",
    note: "",
    tagIds: [10, 11]
  };

  assert.match(await validateDocumentInput(env, base), /태그/);
  assert.equal(await validateDocumentInput(env, base, { allowInactiveTagIds: [11] }), "");
  assert.match(await validateDocumentInput(env, { ...base, tagIds: [10, 99] }), /존재/);
  assert.match(
    await validateDocumentInput(env, { ...base, tagIds: [10, 99] }, { allowInactiveTagIds: [99] }),
    /존재/
  );
});

test("validateDocumentInput rejects oversized text before database access", async () => {
  const env = recordingEnv();
  const values = {
    documentNumber: "D".repeat(101),
    revisionNumber: "Rev.0",
    documentName: "문서",
    categoryId: 1,
    rackSlotId: 2,
    rackFace: "A",
    note: "",
    tagIds: []
  };

  assert.match(await validateDocumentInput(env, values), /문서번호는 100자 이하/);
  assert.equal(env.state.calls.length, 0, "순수 텍스트 검증 실패 시 D1 조회를 시작하지 않는다");
});

test("disposeDocumentsBulk packs per-document guards into one atomic batch", async () => {
  const env = recordingEnv({
    all: (sql) => {
      if (sql.includes("WHERE d.id IN")) {
        return [
          sampleDocument({ id: 1 }),
          sampleDocument({ id: 2, status: "disposed", document_number: "MR-002" }),
          sampleDocument({ id: 3, document_number: "MR-003" })
        ];
      }
      if (sql.includes("FROM document_tags")) {
        return [
          { document_id: 1, id: 7, name: "중요문서" },
          { document_id: 3, id: 8, name: "원본보관" }
        ];
      }
      return [];
    }
  });

  const result = await disposeDocumentsBulk(env, [1, 2, 3, 99], "관리자", "일괄 폐기", "Admin");

  assert.equal(result.ok, false);
  assert.equal(result.disposed, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /99번/);
  const lookupCalls = env.state.calls.filter((call) => call.type === "all");
  assert.equal(lookupCalls.length, 2);
  assert.match(lookupCalls[0].sql, /WHERE d\.id IN/);
  assert.match(lookupCalls[1].sql, /FROM document_tags/);
  assert.equal(env.state.batches.length, 1);
  assert.equal(env.state.batches[0].length, 6); // active 2건 × (이력+감사+UPDATE)

  const statements = env.state.batches[0];
  for (let index = 0; index < 2; index += 1) {
    const offset = index * 3;
    assert.match(statements[offset].sql, /INSERT INTO disposal_logs/);
    assert.match(statements[offset + 1].sql, /INSERT INTO document_audit_logs/);
    assert.match(statements[offset + 2].sql, /UPDATE documents/);
    assert.match(statements[offset + 2].sql, /status = 'active'/);
  }
});

test("disposeDocument reports a conflict when the guarded update changes no rows", async () => {
  const env = recordingEnv({
    first: (sql) => (sql.includes("FROM documents d") ? sampleDocument() : null),
    batch: (statements) => statements.map(() => ({ meta: { changes: 0 } }))
  });

  const result = await disposeDocument(env, 1, "관리자", "폐기 사유", "Admin");

  // 원자화된 batch가 실행되더라도 pre-state 가드가 모두 걸려 아무것도 커밋되지 않는다(0행).
  assert.equal(result.ok, false);
  assert.match(result.message, /변경/);
});

test("viewer search item exposes location-first api shape", () => {
  const item = documentToViewerItem({
    id: 7,
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    document_name: "충전 공정 밸리데이션 보고서",
    category_name: "PV",
    tag_names: "중요문서; 원본보관",
    status: "active",
    rack_code: "2-01",
    zone_number: 2,
    rack_number: 1,
    is_single_sided: 0,
    column_number: 3,
    shelf_number: 2,
    rack_face: "A",
    match_reason: "문서번호 부분 일치",
    relevance_score: 177,
    updated_at: "2026-06-28"
  });

  assert.equal(item.id, 7);
  assert.equal(item.documentNumber, "PV-2026-014");
  assert.deepEqual(item.tags, ["중요문서", "원본보관"]);
  // 양면 랙은 면 단위 표기(1-1 = 1번 랙 A면)로 위치를 안내한다.
  assert.equal(item.location.label, "2구역 / 1-1번 랙 / 3열 / 2선반");
  assert.equal(item.location.rackLabel, "1-1");
  assert.equal(item.location.isSingleSided, false);
  assert.equal(item.matchReason, "문서번호 부분 일치");
});

test("viewer search item labels single-sided racks without a face suffix", () => {
  const single = documentToViewerItem({
    id: 8,
    document_number: "MR-2026-001",
    revision_number: "Rev.0",
    document_name: "제조기록서",
    category_name: "제조기록서",
    status: "active",
    rack_code: "2-09",
    zone_number: 2,
    rack_number: 9,
    is_single_sided: 1,
    column_number: 7,
    shelf_number: 6,
    rack_face: "A",
    updated_at: "2026-06-28"
  });

  assert.equal(single.location.rackLabel, "9");
  assert.equal(single.location.isSingleSided, true);
  assert.equal(single.location.label, "2구역 / 9번 랙 / 7열 / 6선반");

  const faceB = documentToViewerItem({
    id: 9,
    document_number: "PV-2026-020",
    revision_number: "Rev.0",
    document_name: "밸리데이션 보고서",
    category_name: "PV",
    status: "active",
    rack_code: "1-13",
    zone_number: 1,
    rack_number: 13,
    is_single_sided: 0,
    column_number: 1,
    shelf_number: 1,
    rack_face: "B",
    updated_at: "2026-06-28"
  });

  assert.equal(faceB.location.rackLabel, "13-2");
  assert.equal(faceB.location.label, "1구역 / 13-2번 랙 / 1열 / 1선반");
});

test("getDocumentQualitySummary uses one D1 aggregate round trip", async () => {
  let calls = 0;
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /duplicate_document_numbers/);
        return {
          async first() {
            calls += 1;
            return {
              duplicate_document_numbers: 2,
              missing_location: 1,
              missing_category: 3,
              invalid_rack_face: 4,
              suspicious_text: 5,
              documents_without_tags: 6,
              disposed_documents: 7
            };
          }
        };
      }
    }
  };

  const summary = await getDocumentQualitySummary(env);

  assert.equal(calls, 1);
  assert.deepEqual(summary, {
    duplicateDocumentNumbers: 2,
    missingLocation: 1,
    missingCategory: 3,
    invalidRackFace: 4,
    suspiciousText: 5,
    documentsWithoutTags: 6,
    disposedDocuments: 7
  });
});

test("viewer facets count active filters from result rows", () => {
  const facets = buildViewerFacets([
    { category_id: 1, category_name: "PV", tag_names: "중요문서", zone_number: 1, status: "active" },
    { category_id: 1, category_name: "PV", tag_names: "원본보관", zone_number: 1, status: "disposed" },
    { category_id: 2, category_name: "SOP", tag_names: "중요문서; 교육", zone_number: 2, status: "active" }
  ]);

  assert.deepEqual(facets.categories.map((item) => [item.label, item.count]), [["PV", 2], ["SOP", 1]]);
  assert.deepEqual(facets.zones.map((item) => [item.label, item.count]), [["1구역", 2], ["2구역", 1]]);
  assert.equal(facets.tags.find((item) => item.label === "중요문서").count, 2);
  assert.equal(facets.statuses.find((item) => item.value === "active").count, 2);
});

test("floor plan layout clamps regions and auto-places racks by zone", () => {
  const layout = buildFloorPlanLayout([
    { id: 1, code: "1-01", zone_number: 1, rack_number: 1, active_document_count: 3, is_single_sided: 0 },
    { id: 2, code: "1-02", zone_number: 1, rack_number: 2, active_document_count: 1, is_single_sided: 1 },
    { id: 3, code: "3-01", zone_number: 3, rack_number: 1, active_document_count: 2, is_single_sided: 0 }
  ], [
    { region_key: "zone-1", label: "1구역", description: "", top_pct: -5, left_pct: 12, width_pct: 38, height_pct: 40, default_rack_count: 4 },
    { region_key: "zone-2", label: "2구역", description: "", top_pct: 55, left_pct: 5, width_pct: 40, height_pct: 38, default_rack_count: 10 },
    { region_key: "zone-3", label: "3구역", description: "", top_pct: 55, left_pct: 52, width_pct: 160, height_pct: 38, default_rack_count: 2 }
  ]);

  // 랙이 없는 구역(2구역)은 도면에서 빠진다.
  assert.deepEqual(layout.map((region) => region.key), ["zone-1", "zone-3"]);
  assert.equal(layout[0].topPct, 0);
  assert.equal(layout[1].widthPct, 100);
  // 좌측부터 1번 랙 순서로 배치된다.
  assert.deepEqual(layout[0].racks.map((rack) => rack.code), ["1-01", "1-02"]);
  assert.ok(layout[0].racks[0].leftPct < layout[0].racks[1].leftPct);
  assert.equal(layout[1].racks[0].documentCount, 2);
});

test("disposeDocument writes disposal + audit logs and the status change in one atomic batch", async () => {
  const env = recordingEnv({
    first: (sql) => (sql.includes("FROM documents d") ? sampleDocument() : null)
  });

  const result = await disposeDocument(env, 1, "관리자", "폐기 사유", "Admin");

  assert.equal(result.ok, true);
  // 상태변경과 두 로그가 반드시 하나의 batch(트랜잭션) 안에 함께 있어야 한다(감사기록 없는 상태변경 방지).
  assert.equal(env.state.batches.length, 1);
  const sqls = env.state.batches[0].map((statement) => statement.sql);
  assert.ok(sqls.some((sql) => sql.includes("INSERT INTO disposal_logs")));
  assert.ok(sqls.some((sql) => sql.includes("INSERT INTO document_audit_logs")));
  assert.ok(sqls.some((sql) => sql.includes("UPDATE documents") && sql.includes("status = 'disposed'")));
  // 로그 INSERT는 pre-state 가드(... FROM documents WHERE ...)로 조건부 실행되어야 한다.
  const disposalLog = env.state.batches[0].find((statement) => statement.sql.includes("INSERT INTO disposal_logs"));
  assert.ok(disposalLog.sql.includes("FROM documents"));
});

test("upsertDocumentSet writes create and update logs", async () => {
  const createEnv = recordingEnv({
    first: (sql) => (sql.includes("INSERT INTO document_sets") ? { id: 9 } : null)
  });
  const created = await upsertDocumentSet(createEnv, { name: "정기감사 준비문서" }, "관리자");
  assert.equal(created.ok, true);
  const createLog = createEnv.state.calls.find((call) => call.sql.includes("INSERT INTO document_set_logs"));
  assert.ok(createLog);
  assert.equal(createLog.args[2], "create");

  const updateEnv = recordingEnv({ run: () => 1 });
  const updated = await upsertDocumentSet(updateEnv, { id: 9, name: "정기감사 준비문서" }, "관리자");
  assert.equal(updated.ok, true);
  const updateLog = updateEnv.state.calls.find((call) => call.sql.includes("INSERT INTO document_set_logs"));
  assert.ok(updateLog);
  assert.equal(updateLog.args[2], "update");
});

test("addDocumentsToSet logs which document numbers were actually added", async () => {
  const env = recordingEnv({
    batch: (statements) => statements.map((_, index) => ({ meta: { changes: index === 0 ? 1 : 0 } })),
    first: (sql) => (sql.includes("FROM document_sets") ? { id: 3, name: "감사세트" } : null),
    all: (sql) => (sql.includes("FROM documents") ? [{ document_number: "MR-2026-001" }] : [])
  });

  const { added } = await addDocumentsToSet(env, 3, [10, 11], "관리자");

  assert.equal(added, 1);
  const log = env.state.calls.find((call) => call.sql.includes("INSERT INTO document_set_logs"));
  assert.ok(log);
  assert.equal(log.args[2], "add");
  assert.match(log.args[4], /MR-2026-001/);
});

test("removeDocumentFromSet and deleteDocumentSet write remove and delete logs", async () => {
  const removeEnv = recordingEnv({
    first: (sql) => (sql.includes("FROM document_sets") ? { id: 3, name: "감사세트" } : null),
    all: (sql) => (sql.includes("FROM documents") ? [{ document_number: "PV-2026-014" }] : []),
    run: () => 1
  });
  const removed = await removeDocumentFromSet(removeEnv, 3, 10, "관리자");
  assert.equal(removed.ok, true);
  const removeLog = removeEnv.state.calls.find((call) => call.sql.includes("INSERT INTO document_set_logs"));
  assert.equal(removeLog.args[2], "remove");
  assert.match(removeLog.args[4], /PV-2026-014/);

  const deleteEnv = recordingEnv({
    first: (sql) => (sql.includes("FROM document_sets") ? { id: 3, name: "감사세트" } : null)
  });
  const deleted = await deleteDocumentSet(deleteEnv, 3, "관리자");
  assert.equal(deleted.ok, true);
  // 삭제 이력이 삭제와 같은 batch 안에서 기록되어야 한다(세트만 사라지고 기록이 없는 공백 방지).
  assert.equal(deleteEnv.state.batches.length, 1);
  const deleteSqls = deleteEnv.state.batches[0].map((statement) => statement.sql);
  assert.ok(deleteSqls.some((sql) => sql.includes("INSERT INTO document_set_logs") && sql.includes("'delete'")));
  assert.ok(deleteSqls.some((sql) => sql.includes("DELETE FROM document_sets")));
});

test("updateDocument binds the optimistic lock and guards tags + audit in one atomic batch", async () => {
  const env = recordingEnv({
    first: (sql) => (sql.includes("FROM documents d") ? sampleDocument() : null),
    all: () => []
  });

  const result = await updateDocument(env, 1, {
    documentNumber: "MR-002",
    revisionNumber: "Rev.1",
    documentName: "수정된 문서",
    categoryId: 1,
    rackSlotId: 9,
    rackFace: "B",
    tagIds: [2, 3],
    note: "메모",
    expectedUpdatedAt: "2026-07-01 09:00:00"
  }, "관리자", "Admin");

  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  const update = statements.find((s) => s.sql.includes("UPDATE documents") && s.sql.includes("category_id"));
  // 낙관적 잠금: 가드 UPDATE에 updated_at 조건과 기대값 바인딩이 포함되어야 한다.
  assert.ok(update.sql.includes("updated_at = ?"));
  assert.ok(update.args.includes("2026-07-01 09:00:00"));
  // 감사 스냅샷과 실제 저장값이 어긋나지 않도록 위치 변경값도 같은 가드 UPDATE에 포함한다.
  assert.ok(update.sql.includes("rack_slot_id = ?"));
  assert.ok(update.sql.includes("rack_face = ?"));
  assert.ok(update.args.includes(9));
  assert.ok(update.args.includes("B"));
  // 태그 교체와 감사 로그가 같은 batch 안에 있고, 태그 DELETE도 pre-state 가드(EXISTS)에 묶여야 한다.
  const tagDelete = statements.find((s) => s.sql.includes("DELETE FROM document_tags"));
  assert.ok(tagDelete && tagDelete.sql.includes("EXISTS"));
  assert.ok(statements.some((s) => s.sql.includes("INSERT INTO document_audit_logs")));
});

test("updateDocument reports a conflict when the optimistic lock does not match", async () => {
  const env = recordingEnv({
    first: (sql) => (sql.includes("FROM documents d") ? sampleDocument() : null),
    all: () => [],
    batch: (statements) => statements.map(() => ({ meta: { changes: 0 } }))
  });

  const result = await updateDocument(env, 1, {
    documentNumber: "MR-002",
    revisionNumber: "Rev.1",
    documentName: "수정",
    categoryId: 1,
    rackSlotId: 1,
    rackFace: "A",
    tagIds: [],
    note: "",
    expectedUpdatedAt: "2000-01-01 00:00:00"
  }, "관리자", "Admin");

  assert.equal(result.ok, false);
  assert.match(result.message, /먼저 수정|변경/);
});

test("permanentlyDeleteDocument refuses active documents and preserves history before hard delete", async () => {
  const activeEnv = recordingEnv({
    first: (sql) => (sql.includes("FROM documents d") ? sampleDocument({ status: "active" }) : null)
  });
  const refused = await permanentlyDeleteDocument(activeEnv, 1, "관리자", "Admin");
  assert.equal(refused.ok, false);
  assert.equal(activeEnv.state.batches.length, 0);

  const env = recordingEnv({
    first: (sql) => (sql.includes("FROM documents d") ? sampleDocument({ status: "disposed" }) : null),
    all: (sql) => {
      if (sql.includes("FROM disposal_logs")) return [{ id: 6, action: "disposed" }];
      return [];
    }
  });
  const result = await permanentlyDeleteDocument(env, 1, "관리자", "Admin");
  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const statements = env.state.batches[0];
  // 감사 로그 INSERT가 DELETE '앞'에 있어 이력 스냅샷이 삭제 전에 보존되어야 한다.
  const auditIdx = statements.findIndex((s) => s.sql.includes("INSERT INTO document_audit_logs"));
  const deleteIdx = statements.findIndex((s) => s.sql.includes("DELETE FROM documents"));
  assert.ok(auditIdx >= 0 && deleteIdx >= 0 && auditIdx < deleteIdx);
  const detailsJson = statements[auditIdx].args.find((a) => typeof a === "string" && a.includes("history"));
  assert.ok(detailsJson, "감사 상세에 history 스냅샷이 포함되어야 한다");
  assert.match(detailsJson, /disposals/);
});

function sampleDocument(overrides = {}) {
  return {
    id: 1,
    storage_code: "ARC-000001",
    document_number: "MR-001",
    revision_number: "Rev.0",
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
    note: "",
    ...overrides
  };
}

function recordingEnv({ first = () => null, all = () => [], run = () => 1, batch = null } = {}) {
  const state = { calls: [], batches: [] };
  const env = {
    state,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              sql,
              args,
              async first() {
                state.calls.push({ sql, args, type: "first" });
                return first(sql, args);
              },
              async all() {
                state.calls.push({ sql, args, type: "all" });
                return { results: all(sql, args) };
              },
              async run() {
                state.calls.push({ sql, args, type: "run" });
                return { meta: { changes: run(sql, args) } };
              }
            };
          }
        };
      },
      async batch(statements) {
        state.batches.push(statements.map((statement) => ({ sql: statement.sql, args: statement.args })));
        return batch ? batch(statements) : statements.map(() => ({ meta: { changes: 1 } }));
      }
    }
  };

  return env;
}
