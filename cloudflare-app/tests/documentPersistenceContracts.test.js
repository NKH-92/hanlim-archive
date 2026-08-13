import assert from "node:assert/strict";
import test from "node:test";

import {
  disposeDocument,
  disposeDocumentsBulk,
  findDuplicateDocument,
  findDocumentsByNumbers,
  getDocumentCount,
  getDocumentPage,
  getDocumentQualitySummary,
  getDisposalCandidates,
  parseDisposalFilters,
  parseDocumentNumberList,
  permanentlyDeleteDocument,
  restoreDocument,
  updateDocument,
  validateDocumentInput
} from "../src/domains/documents/index.js";
import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";
import { recordingEnv, sampleDocument } from "./helpers/recordingD1.js";

test("문서번호 목록 parser는 붙여넣기 구분자를 처리하고 대소문자 중복을 제거한다", () => {
  assert.deepEqual(
    parseDocumentNumberList("MR-2026-001, PV-2026-014\n mr-2026-001 ;\tARC-000002\n\n"),
    ["MR-2026-001", "PV-2026-014", "ARC-000002"]
  );
  assert.deepEqual(parseDocumentNumberList(""), []);
  assert.deepEqual(parseDocumentNumberList(null), []);
  assert.deepEqual(parseDocumentNumberList("NOPE-999  ARC-000001 PV-2026-014"), ["NOPE-999", "ARC-000001", "PV-2026-014"]);
});

test("세트용 문서번호 조회는 내부 storage code를 검색하지 않는다", async () => {
  let executedSql = "";
  let executedArgs = [];
  const env = {
    DB: {
      prepare(sql) {
        executedSql = sql;
        return {
          bind(...args) {
            executedArgs = args;
            return { all: async () => ({ results: [{ id: 7, document_number: "PV-2026-014" }] }) };
          }
        };
      }
    }
  };
  const result = await findDocumentsByNumbers(env, ["PV-2026-014", "ARC-000007"]);
  assert.deepEqual(result.documents, [{ id: 7, document_number: "PV-2026-014" }]);
  assert.deepEqual(result.missing, ["ARC-000007"]);
  assert.doesNotMatch(executedSql, /storage_code/);
  assert.deepEqual(executedArgs, [JSON.stringify(["PV-2026-014", "ARC-000007"])]);
  assert.match(executedSql, /json_each\(\?\)/);
});

test("중복 조회는 문서번호+개정번호만 사용하고 내부 storage code를 노출하지 않는다", async () => {
  let executedSql = "";
  let executedArgs = [];
  const env = {
    DB: {
      prepare(sql) {
        executedSql = sql;
        return {
          bind(...args) {
            executedArgs = args;
            return {
              async first() {
                return {
                  id: 7,
                  document_number: "SOP-QA-014",
                  revision_number: "Rev.03",
                  document_name: "변경관리 절차서",
                  status: "active",
                  duplicate_count: 1
                };
              }
            };
          }
        };
      }
    }
  };
  const duplicate = await findDuplicateDocument(env, "SOP-QA-014", "Rev.03", 4);
  assert.equal(duplicate.exists, true);
  assert.equal(duplicate.document.id, 7);
  assert.doesNotMatch(executedSql, /storage_code/);
  assert.match(executedSql, /UPPER\(d\.document_number\)/);
  assert.deepEqual(executedArgs, ["SOP-QA-014", "Rev.03", 4, 4]);
});

test("폐기 필터는 양의 id와 유효한 폐기연도만 허용한다", () => {
  assert.deepEqual(parseDisposalFilters({ category: "3", rack: "7", disposalDueYear: "2031" }), {
    categoryId: 3, rackId: 7, disposalDueYear: 2031
  });
  assert.deepEqual(parseDisposalFilters({ categoryId: "-1", rackId: "1.5", disposalDueYear: "1899" }), {
    categoryId: 0, rackId: 0, disposalDueYear: 0
  });
});

test("폐기 후보 조회는 active 문서와 선택 필터만 사용한다", async () => {
  const env = recordingEnv({ all: () => [] });
  await getDisposalCandidates(env, { categoryId: 3, rackId: 7, disposalDueYear: 2031 }, 500);
  const query = env.state.calls.find((call) => call.type === "all");
  assert.ok(query);
  assert.match(query.sql, /d\.status = 'active'/);
  assert.match(query.sql, /d\.category_id = \?/);
  assert.match(query.sql, /r\.id = \?/);
  assert.match(query.sql, /d\.disposal_due_year = \?/);
  assert.deepEqual(query.args, [3, 7, 2031, 201]);
});

test("문서 검증은 미등록·비활성 tag를 거부하고 허용된 기존 비활성 tag만 보존한다", async () => {
  const env = recordingEnv({
    first: (sql) => {
      if (sql.includes("FROM categories")) return { id: 1, is_active: 1 };
      if (sql.includes("FROM rack_slots")) return { id: 2, is_single_sided: 0 };
      return null;
    },
    all: (sql) => sql.includes("FROM tags") ? [{ id: 10, is_active: 1 }, { id: 11, is_active: 0 }] : []
  });
  const base = {
    documentNumber: "MR-001", revisionNumber: "Rev.0", revisionDate: "2026-07-17",
    disposalDueYear: "2031", documentName: "문서", categoryId: 1, rackSlotId: 2,
    rackFace: "A", note: "", tagIds: [10, 11]
  };
  assert.match(await validateDocumentInput(env, base), /태그/);
  assert.equal(await validateDocumentInput(env, base, { allowInactiveTagIds: [11] }), "");
  assert.match(await validateDocumentInput(env, { ...base, tagIds: [10, 99] }), /존재/);
  assert.match(await validateDocumentInput(env, { ...base, tagIds: [10, 99] }, { allowInactiveTagIds: [99] }), /존재/);
  const before = env.state.calls.filter((call) => call.sql.includes("FROM tags")).length;
  assert.match(await validateDocumentInput(env, { ...base, tagIds: Array.from({ length: 37 }, (_, index) => index + 1) }), /최대 36개/);
  assert.equal(env.state.calls.filter((call) => call.sql.includes("FROM tags")).length, before);
});

test("문서 텍스트 상한 위반은 DB 조회 전에 거부한다", async () => {
  const env = recordingEnv();
  const values = {
    documentNumber: "D".repeat(101), revisionNumber: "Rev.0", revisionDate: "2026-07-17",
    disposalDueYear: "2031", documentName: "문서", categoryId: 1, rackSlotId: 2,
    rackFace: "A", note: "", tagIds: []
  };
  assert.match(await validateDocumentInput(env, values), /문서번호는 100자 이하/);
  assert.equal(env.state.calls.length, 0);
});

test("직접 일괄 폐기는 문서별 guard를 하나의 원자 batch에 묶는다", async () => {
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
  assert.match(result.failures[0], /99번/);
  assert.equal(env.state.batches.length, 1);
  assert.equal(env.state.batches[0].length, 6);
  for (let index = 0; index < 2; index += 1) {
    const offset = index * 3;
    assert.match(env.state.batches[0][offset].sql, /INSERT INTO disposal_logs/);
    assert.match(env.state.batches[0][offset + 1].sql, /INSERT INTO document_audit_logs/);
    assert.match(env.state.batches[0][offset + 2].sql, /UPDATE documents/);
    assert.match(env.state.batches[0][offset + 2].sql, /updated_at = \?/);
    assert.match(env.state.batches[0][offset + 2].sql, /row_version = \?/);
  }
});

test("단건 폐기는 guarded update가 0행이면 경합으로 보고한다", async () => {
  const env = recordingEnv({
    first: (sql) => sql.includes("FROM documents d") ? sampleDocument() : null,
    batch: (statements) => statements.map(() => ({ meta: { changes: 0 } }))
  });
  const result = await disposeDocument(env, 1, "관리자", "폐기 사유", "Admin");
  assert.equal(result.ok, false);
  assert.match(result.message, /변경/);
  for (const statement of env.state.batches[0].filter((item) => !/STALE_VERSION/.test(item.sql || ""))) {
    assert.match(statement.sql, /updated_at = \?/);
    assert.match(statement.sql, /row_version = \?/);
  }
});

test("문서 품질 요약은 하나의 D1 aggregate round trip으로 읽는다", async () => {
  let calls = 0;
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /duplicate_document_numbers/);
        return {
          async first() {
            calls += 1;
            return {
              duplicate_document_numbers: 2, missing_location: 1, missing_category: 3,
              invalid_rack_face: 4, suspicious_text: 5, documents_without_tags: 6,
              disposed_documents: 7, missing_disposal_year: 8
            };
          }
        };
      }
    }
  };
  assert.deepEqual(await getDocumentQualitySummary(env), {
    duplicateDocumentNumbers: 2, missingLocation: 1, missingCategory: 3, invalidRackFace: 4,
    suspiciousText: 5, documentsWithoutTags: 6, disposedDocuments: 7, missingDisposalYear: 8
  });
  assert.equal(calls, 1);
});

test("문서 browse는 SQL COUNT와 LIMIT/OFFSET page read를 사용한다", async () => {
  const env = recordingEnv({
    first: (sql) => sql.includes("COUNT(*)") ? { count: 73 } : null,
    all: (sql) => sql.includes("FROM documents d") ? [sampleDocument()] : []
  });
  const filters = { categoryId: 2, status: "active", sort: "location" };
  assert.equal(await getDocumentCount(env, filters), 73);
  assert.equal((await getDocumentPage(env, filters, 2, FREE_TIER_BUDGET.documentPageSize)).length, 1);
  const pageCall = env.state.calls.find((call) => call.type === "all");
  assert.match(pageCall.sql, /LIMIT \? OFFSET \?/);
  assert.match(pageCall.sql, /d\.category_id = \?/);
  assert.match(pageCall.sql, /r\.zone_number, r\.rack_number/);
  assert.doesNotMatch(pageCall.sql, /GROUP_CONCAT|LEFT JOIN document_tags|GROUP BY d\.id/);
  assert.deepEqual(pageCall.args.slice(-2), [30, 30]);
});

test("직접 일괄 폐기는 10건 상한을 DB 접근 전에 적용한다", async () => {
  const env = recordingEnv();
  const tooMany = Array.from({ length: FREE_TIER_BUDGET.directBulkDisposeMaxItems + 1 }, (_, index) => index + 1);
  const result = await disposeDocumentsBulk(env, tooMany, "관리자", "긴급 폐기", "Admin");
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /10건 이하/);
  assert.equal(env.state.calls.length, 0);
  assert.equal(env.state.batches.length, 0);
});

test("직접 일괄 폐기 10건은 요청 statement 예산 안에 머문다", async () => {
  const documents = Array.from({ length: 10 }, (_, index) => sampleDocument({ id: index + 1 }));
  const env = recordingEnv({ all: (sql) => sql.includes("WHERE d.id IN") ? documents : [] });
  const result = await disposeDocumentsBulk(env, documents.map((item) => item.id), "관리자", "긴급 폐기", "Admin");
  assert.equal(result.disposed, 10);
  assert.equal(env.state.batches[0].length, 30);
  assert.ok(env.state.calls.length + env.state.batches[0].length <= FREE_TIER_BUDGET.maxD1StatementsPerRequest);
});

test("단건 폐기는 폐기·감사 이력과 상태 변경을 한 batch에 둔다", async () => {
  const env = recordingEnv({ first: (sql) => sql.includes("FROM documents d") ? sampleDocument() : null });
  const result = await disposeDocument(env, 1, "관리자", "폐기 사유", "Admin");
  assert.equal(result.ok, true);
  assert.equal(env.state.batches.length, 1);
  const sqls = env.state.batches[0].map((statement) => statement.sql);
  assert.ok(sqls.some((sql) => sql.includes("INSERT INTO disposal_logs")));
  assert.ok(sqls.some((sql) => sql.includes("INSERT INTO document_audit_logs")));
  assert.ok(sqls.some((sql) => sql.includes("UPDATE documents") && sql.includes("status = 'disposed'")));
  const disposalLog = env.state.batches[0].find((statement) => statement.sql.includes("INSERT INTO disposal_logs"));
  assert.ok(disposalLog.sql.includes("FROM documents"));
});

test("문서 복구는 사유를 요구하고 disposal/audit/update를 원자 처리한다", async () => {
  const refusedEnv = recordingEnv();
  const actor = { userId: 7, username: "keeper", displayName: "담당자", role: "Admin" };
  assert.equal((await restoreDocument(refusedEnv, 1, actor, "")).ok, false);
  assert.equal(refusedEnv.state.calls.length, 0);

  const env = recordingEnv({
    first: (sql) => sql.includes("FROM documents d") ? sampleDocument({ status: "disposed" }) : null,
    all: () => []
  });
  const result = await restoreDocument(env, 1, actor, "폐기 대상 선정 오류", "Admin");
  assert.equal(result.ok, true);
  const statements = env.state.batches[0];
  assert.equal(statements.length, 5);
  assert.match(statements[0].sql, /INSERT INTO disposal_logs/);
  assert.ok(statements[0].args.includes("폐기 대상 선정 오류"));
  assert.match(statements[1].sql, /INSERT INTO document_audit_logs/);
  assert.match(statements[2].sql, /INSERT INTO system_audit_logs/);
  assert.match(statements[3].sql, /UPDATE documents/);
  assert.match(statements[4].sql, /STALE_VERSION/);
});

test("문서 수정은 낙관적 잠금과 tag/audit 변경을 한 batch에 묶는다", async () => {
  const env = recordingEnv({ first: (sql) => sql.includes("FROM documents d") ? sampleDocument() : null, all: () => [] });
  const result = await updateDocument(env, 1, {
    documentNumber: "MR-002", revisionNumber: "Rev.1", revisionDate: "2026-07-17",
    disposalDueYear: "2031", documentName: "수정된 문서", categoryId: 1, rackSlotId: 9,
    rackFace: "B", tagIds: [2, 3], note: "메모",
    expectedUpdatedAt: "2026-07-01 09:00:00", expectedRowVersion: 1
  }, "관리자", "Admin");
  assert.equal(result.ok, true);
  const statements = env.state.batches[0];
  const update = statements.find((statement) => statement.sql.includes("UPDATE documents") && statement.sql.includes("category_id"));
  assert.ok(update.sql.includes("updated_at = ?"));
  assert.ok(update.args.includes("2026-07-01 09:00:00"));
  assert.ok(update.args.includes(1));
  assert.ok(update.args.includes("A"));
  assert.ok(update.args.includes("Rev.0"));
  assert.ok(!update.args.includes("Rev.1"));
  assert.ok(!update.args.includes(9));
  const tagDelete = statements.find((statement) => statement.sql.includes("DELETE FROM document_tags"));
  assert.ok(tagDelete && tagDelete.sql.includes("EXISTS"));
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO document_audit_logs")));
});

test("문서 수정은 optimistic lock 불일치와 잠금 token 누락을 거부한다", async () => {
  const conflictEnv = recordingEnv({
    first: (sql) => sql.includes("FROM documents d") ? sampleDocument() : null,
    all: () => [],
    batch: (statements) => statements.map(() => ({ meta: { changes: 0 } }))
  });
  const conflict = await updateDocument(conflictEnv, 1, {
    documentNumber: "MR-002", revisionNumber: "Rev.1", revisionDate: "2026-07-17",
    disposalDueYear: "2031", documentName: "수정", categoryId: 1, rackSlotId: 1,
    rackFace: "A", tagIds: [], note: "", expectedUpdatedAt: "2000-01-01 00:00:00", expectedRowVersion: 1
  }, "관리자", "Admin");
  assert.equal(conflict.ok, false);
  assert.match(conflict.message, /먼저 수정|변경/);

  const missingEnv = recordingEnv({ first: (sql) => sql.includes("FROM documents d") ? sampleDocument() : null });
  const missing = await updateDocument(missingEnv, 1, {
    documentNumber: "MR-002", revisionNumber: "Rev.1", documentName: "수정", categoryId: 1,
    rackSlotId: 1, rackFace: "A", tagIds: [], note: ""
  }, "관리자", "Admin");
  assert.equal(missing.ok, false);
  assert.match(missing.message, /잠금 정보|새로고침/);
  assert.equal(missingEnv.state.batches.length, 0);
});

test("내부 permanent delete는 active 문서를 거부하고 hard delete 전에 history를 보존한다", async () => {
  const activeEnv = recordingEnv({ first: (sql) => sql.includes("FROM documents d") ? sampleDocument({ status: "active" }) : null });
  assert.equal((await permanentlyDeleteDocument(activeEnv, 1, "관리자", "Admin")).ok, false);
  assert.equal(activeEnv.state.batches.length, 0);

  const env = recordingEnv({
    first: (sql) => sql.includes("FROM documents d") ? sampleDocument({ status: "disposed" }) : null,
    all: (sql) => sql.includes("FROM disposal_logs") ? [{ id: 6, action: "disposed" }] : []
  });
  const result = await permanentlyDeleteDocument(env, 1, "관리자", "Admin");
  assert.equal(result.ok, true);
  const statements = env.state.batches[0];
  const auditIndex = statements.findIndex((statement) => statement.sql.includes("INSERT INTO document_audit_logs"));
  const deleteIndex = statements.findIndex((statement) => statement.sql.includes("DELETE FROM documents"));
  assert.ok(auditIndex >= 0 && deleteIndex >= 0 && auditIndex < deleteIndex);
  assert.match(statements[deleteIndex].sql, /updated_at = \?/);
  assert.match(statements[deleteIndex].sql, /row_version = \?/);
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO system_audit_logs")));
  const detailsJson = statements[auditIndex].args.find((value) => typeof value === "string" && value.includes("history"));
  assert.ok(detailsJson);
  assert.match(detailsJson, /disposals/);
});
