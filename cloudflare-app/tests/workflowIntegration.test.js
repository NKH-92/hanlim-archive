import assert from "node:assert/strict";
import test from "node:test";

import { handleFilteredDispose } from "../src/handlers/documentHandlers.js";
import { documentFormPage } from "../src/views/documentViews.js";

test("필터 전체 폐기는 문서를 갱신하지 않고 캠페인 초안을 만든다", async () => {
  const state = { batches: [] };
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
        state.batches.push(statements);
        return statements.map((statement, index) => ({
          meta: { changes: 1 },
          results: index === 0 ? [{ id: 17 }] : [],
          statement
        }));
      }
    }
  };
  const session = {
    userId: 4,
    username: "disposal",
    displayName: "폐기 담당자",
    role: "User",
    can_manage_disposals: 1
  };
  const request = new Request("https://archive.example.com/documents/dispose-filtered", {
    method: "POST",
    body: new URLSearchParams({ categoryId: "3", reason: "보존기간 만료" })
  });

  const response = await handleFilteredDispose(request, env, session);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/disposal-batches/17/edit");
  const sql = state.batches.flat().map((statement) => statement.sql).join("\n");
  assert.match(sql, /INSERT INTO disposal_batches/);
  assert.doesNotMatch(sql, /UPDATE documents/);
});

test("미등록 세트 문서 연결은 문서번호와 안전한 복귀 경로를 폼에 보존한다", async () => {
  const response = documentFormPage({
    session: { role: "Admin", displayName: "관리자", csrfToken: "csrf" },
    title: "문서 등록",
    action: "/documents",
    values: { documentNumber: "PV-NEW-01", returnTo: "/sets/9" },
    categories: [],
    tags: [],
    slots: [],
    selectedTags: []
  });
  const html = await response.text();

  assert.match(html, /name="documentNumber" value="PV-NEW-01"/);
  assert.match(html, /name="returnTo" value="\/sets\/9"/);
});
