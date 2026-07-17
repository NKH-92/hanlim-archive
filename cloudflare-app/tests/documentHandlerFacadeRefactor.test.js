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
  "handleFilteredDispose",
  "renderCreateDocument"
];

test("문서 핸들러 호환 배럴은 기존 공개 표면을 그대로 유지한다", () => {
  assert.deepEqual(Object.keys(documentHandlers).sort(), expectedExports);
  assert.equal(documentHandlers.handleDocuments, browseHandlers.handleDocuments);
  assert.equal(documentHandlers.handleDocumentExport, browseHandlers.handleDocumentExport);
  assert.equal(documentHandlers.handleCreateDocument, crudHandlers.handleCreateDocument);
  assert.equal(documentHandlers.handleDocumentRoute, crudHandlers.handleDocumentRoute);
  assert.equal(documentHandlers.renderCreateDocument, crudHandlers.renderCreateDocument);
  assert.equal(documentHandlers.handleBulkDispose, disposalHandlers.handleBulkDispose);
  assert.equal(documentHandlers.handleDisposalWorkspace, disposalHandlers.handleDisposalWorkspace);
  assert.equal(documentHandlers.handleFilteredDispose, disposalHandlers.handleFilteredDispose);
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
