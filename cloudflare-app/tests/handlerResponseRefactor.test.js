import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminUserAction,
  handleCategoryAction,
  handleTagAction
} from "../src/handlers/adminHandlers.js";
import { handleSaveRack } from "../src/handlers/rackHandlers.js";
import { csvDownloadResponse } from "../src/handlers/responseHelpers.js";

const adminSession = {
  username: "admin",
  displayName: "Admin",
  role: "Admin",
  csrfToken: "x".repeat(32)
};

test("csvDownloadResponse preserves exact CSV bytes and download headers", async () => {
  const body = "\uFEFFa,b\r\n1,2";
  const response = csvDownloadResponse(body, "archive.csv");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("Content-Disposition"), "attachment; filename=\"archive.csv\"");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(bytes, new TextEncoder().encode(body));
});

test("unexpected rack save errors are logged without exposing raw details", async () => {
  const form = new FormData();
  form.set("zoneNumber", "1");
  form.set("rackNumber", "1");
  form.set("name", "테스트 랙");
  form.set("description", "");
  form.set("isSingleSided", "1");
  form.set("isActive", "1");

  const request = new Request("https://archive.example/racks", { method: "POST", body: form });
  const env = {
    DB: {
      prepare() {
        throw new Error("SENSITIVE_D1_INTERNAL_DETAIL");
      }
    }
  };
  const session = { username: "admin", displayName: "관리자", role: "Admin", csrfToken: "x".repeat(32) };
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await handleSaveRack(request, env, session);
    const html = await response.text();
    assert.match(html, /랙을 저장하는 중 오류가 발생했습니다\./);
    assert.doesNotMatch(html, /SENSITIVE_D1_INTERNAL_DETAIL/);
  } finally {
    console.error = originalError;
  }
});

test("unsupported admin actions return 404 without calling a mutation", async () => {
  const env = {
    DB: {
      prepare() {
        throw new Error("mutation must not be called");
      }
    }
  };
  const request = new Request("https://archive.example/admin/action", { method: "POST" });

  const responses = await Promise.all([
    handleAdminUserAction(env, adminSession, { action: "disable", id: 1 }),
    handleCategoryAction(request, env, adminSession, { action: "archive", id: 1 }),
    handleTagAction(request, env, adminSession, { action: "archive", id: 1 })
  ]);

  assert.deepEqual(responses.map((response) => response.status), [404, 404, 404]);
});
