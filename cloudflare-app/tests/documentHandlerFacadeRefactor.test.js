import assert from "node:assert/strict";
import test from "node:test";

import * as documentHandlers from "../src/handlers/documentHandlers.js";
import * as browseHandlers from "../src/handlers/documents/browse.js";
import * as crudHandlers from "../src/handlers/documents/crud.js";
import * as disposalHandlers from "../src/handlers/documents/disposal.js";

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

test("새 개정 등록은 식별·분류·태그·위치를 복사하고 새 입력 필드는 비운다", async () => {
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
  assert.match(html, /name="documentNumber" value="SOP-QA-014"/);
  assert.match(html, /name="documentName" value="변경관리 절차서"/);
  assert.match(html, /name="categoryId"[\s\S]*?<option value="1" selected>/);
  assert.match(html, /name="tagIds" value="2" checked/);
  assert.match(html, /name="rackSlotId"[\s\S]*?<option value="12"[^>]*selected>/);
  assert.match(html, /name="rackFace"[\s\S]*?<option value="B" selected>/);
  assert.match(html, /name="revisionNumber" value=""/);
  assert.match(html, /name="revisionDate" value=""/);
  assert.match(html, /name="disposalDueYear" value=""/);
  assert.match(html, /<h2 id="note-title">필요한 변경사항<\/h2>[\s\S]*?<textarea[^>]*name="note"[^>]*><\/textarea>/);
});

test("필터 폐기 호환 경로는 캠페인 생성 후 기존 위치로 리다이렉트한다", async () => {
  const env = {
    DB: {
      prepare(sql) {
        return {
          sql,
          bind(...args) {
            return { sql, args };
          }
        };
      },
      async batch(statements) {
        return statements.map((statement, index) => ({
          meta: { changes: 1 },
          results: index === 0 ? [{ id: 29 }] : [],
          statement
        }));
      }
    }
  };
  const request = new Request("https://archive.example.com/documents/dispose-filtered", {
    method: "POST",
    body: new URLSearchParams({ categoryId: "3", reason: "보존기간 만료" })
  });

  const response = await documentHandlers.handleFilteredDispose(request, env, {
    userId: 4,
    username: "disposal",
    displayName: "폐기 담당자",
    role: "User",
    can_manage_disposals: 1
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/disposal-batches/29/edit");
});
