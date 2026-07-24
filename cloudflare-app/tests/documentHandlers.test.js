import assert from "node:assert/strict";
import test from "node:test";

import * as documentHandlers from "../src/handlers/documentHandlers.js";
import * as browseHandlers from "../src/handlers/documents/browse.js";
import * as crudHandlers from "../src/handlers/documents/crud.js";
import * as disposalHandlers from "../src/handlers/documents/disposal.js";
import { routeDocumentRequest } from "../src/handlers/documentRouter.js";

const expectedExports = [
  "handleBulkDispose",
  "handleCreateDocument",
  "handleDisposalWorkspace",
  "handleDocumentExport",
  "handleDocumentRoute",
  "handleDocuments",
  "handleDuplicateDocumentCheck",
  "handleFilteredDispose",
  "handleSelectedDisposal",
  "renderCreateDocument"
];

test("문서 핸들러 호환 배럴은 기존 공개 표면을 그대로 유지한다", () => {
  assert.deepEqual(Object.keys(documentHandlers).sort(), expectedExports);
  assert.equal(documentHandlers.handleDocuments, browseHandlers.handleDocuments);
  assert.equal(documentHandlers.handleDocumentExport, browseHandlers.handleDocumentExport);
  assert.equal(documentHandlers.handleCreateDocument, crudHandlers.handleCreateDocument);
  assert.equal(documentHandlers.handleDuplicateDocumentCheck, crudHandlers.handleDuplicateDocumentCheck);
  assert.equal(documentHandlers.handleDocumentRoute, crudHandlers.handleDocumentRoute);
  assert.equal(documentHandlers.renderCreateDocument, crudHandlers.renderCreateDocument);
  assert.equal(documentHandlers.handleBulkDispose, disposalHandlers.handleBulkDispose);
  assert.equal(documentHandlers.handleDisposalWorkspace, disposalHandlers.handleDisposalWorkspace);
  assert.equal(documentHandlers.handleFilteredDispose, disposalHandlers.handleFilteredDispose);
  assert.equal(documentHandlers.handleSelectedDisposal, disposalHandlers.handleSelectedDisposal);
});

test("GET /documents는 쿼리를 보존해 표준 문서 작업 공간으로 연결한다", async () => {
  const request = new Request("https://archive.example.com/documents?rack=7&status=active&sort=location");
  const url = new URL(request.url);
  const response = await routeDocumentRequest(request, {}, { role: "User" }, url, "/documents");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/app?rack=7&status=active&sort=location");
});

test("문서 상세의 지원하지 않는 액션은 DB를 조회하지 않고 404를 반환한다", async () => {
  const response = await documentHandlers.handleDocumentRoute(
    new Request("https://archive.example.com/documents/7/unknown"),
    {},
    { role: "Admin", displayName: "관리자", csrfToken: "csrf" },
    { id: 7, action: "unknown" }
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.match(await response.text(), /페이지를 찾을 수 없습니다/);
});

test("문서 개정은 동일 바인더 정보를 잠그고 개정번호와 일자만 입력받는다", async () => {
  const env = {
    DB: {
      prepare(sql) {
        const statement = {
          bind() { return statement; },
          async first() {
            if (sql.includes("FROM documents d")) {
              return {
                id: 7,
                document_number: "SOP-QA-014",
                revision_number: "Rev.03",
                revision_date: "2026-05-14",
                disposal_due_year: 2031,
                document_name: "변경관리 절차서",
                category_id: 1,
                category_name: "품질보증",
                rack_slot_id: 12,
                rack_face: "B",
                rack_code: "1-13",
                zone_number: 1,
                rack_number: 13,
                column_number: 3,
                shelf_number: 4,
                status: "active",
                note: "원문서 비고",
                updated_at: "2026-07-18 09:00:00",
                row_version: 3
              };
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM document_tags")) return { results: [{ id: 2, name: "원본보관" }] };
            if (sql.includes("FROM categories")) return { results: [{ id: 1, name: "품질보증", is_active: 1 }] };
            if (sql.includes("FROM tags")) return { results: [{ id: 2, name: "원본보관", is_active: 1 }] };
            if (sql.includes("FROM rack_slots")) {
              return { results: [{ id: 12, zone_number: 1, rack_number: 13, column_number: 3, shelf_number: 4, is_single_sided: 0 }] };
            }
            return { results: [] };
          }
        };
        return statement;
      }
    }
  };
  const response = await documentHandlers.handleDocumentRoute(
    new Request("https://archive.example.com/documents/7/revise"),
    env,
    { role: "Admin", displayName: "관리자", csrfToken: "csrf" },
    { id: 7, action: "revise" }
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /action="\/documents\/7\/revise"/);
  assert.match(html, /SOP-QA-014/);
  assert.match(html, /변경관리 절차서/);
  assert.match(html, /1구역 \/ 13-2번 랙 \/ 3열 \/ 4선반/);
  assert.match(html, /name="revisionNumber" value=""/);
  assert.match(html, /name="revisionDate" value=""/);
  assert.match(html, /name="confirmReplacement" value="1"/);
  assert.match(html, /이전 개정본이 자동 폐기/);
  assert.match(html, /다른 바인더에 보관할 문서라면/);
  assert.doesNotMatch(html, /name="documentNumber"|name="documentName"|name="categoryId"|name="tagIds"|name="rackSlotId"|name="rackFace"|name="disposalDueYear"|name="note"/);
});

test("필터 전체 폐기 경로는 총 건수 확인이 다르면 캠페인을 만들지 않는다", async () => {
  let batchCalls = 0;
  const env = {
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          args: [],
          bind(...args) {
            this.args = args;
            return this;
          },
          async first() {
            return sql.includes("COUNT(*) AS count") ? { count: 3 } : null;
          }
        };
        return statement;
      },
      async batch() {
        batchCalls += 1;
        return [];
      }
    }
  };
  const request = new Request("https://archive.example.com/documents/dispose-filtered", {
    method: "POST",
    body: new URLSearchParams({
      categoryId: "3",
      reason: "보존기간 만료",
      confirmedTargetCount: "2",
      confirmDisposal: "1"
    })
  });

  const response = await documentHandlers.handleFilteredDispose(request, env, {
    userId: 4,
    username: "disposal",
    displayName: "폐기 담당자",
    role: "User",
    can_manage_disposals: 1
  });

  assert.equal(response.status, 409);
  assert.match(await response.text(), /현재 필터 전체 대상은 3건/);
  assert.equal(batchCalls, 0);
});
