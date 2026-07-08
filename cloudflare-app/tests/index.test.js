import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import { createSessionCookie } from "../src/auth.js";

const SESSION_SECRET = "test-session-secret-with-at-least-32-characters";

test("regular users cannot open or post the document creation route", async () => {
  const env = userSessionEnv();
  const user = { username: "viewer", displayName: "Viewer", role: "User" };
  const cookie = await createSessionCookie(user, env, false);
  const csrfToken = csrfFromCookie(cookie);

  const getResponse = await worker.fetch(new Request("https://archive.example.com/documents/new", {
    headers: { Cookie: cookie }
  }), env);

  const postResponse = await worker.fetch(new Request("https://archive.example.com/documents", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://archive.example.com"
    },
    body: new URLSearchParams({ csrf_token: csrfToken })
  }), env);

  assert.equal(getResponse.status, 403);
  assert.equal(postResponse.status, 403);
});

test("viewer search api returns paginated items, facets, and suggestions", async () => {
  const env = viewerSearchEnv();
  const user = { username: "viewer", displayName: "Viewer", role: "User" };
  const cookie = await createSessionCookie(user, env, false);

  const response = await worker.fetch(new Request("https://archive.example.com/api/viewer/search?q=PV&pageSize=1", {
    headers: {
      Cookie: cookie,
      Accept: "application/json"
    }
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].documentNumber, "PV-2026-014");
  assert.equal(payload.items[0].location.label, "1구역 / 1번 랙 / 2열 / 3선반 / A면");
  assert.equal(payload.pagination.totalItems, 1);
  assert.equal(payload.facets.categories[0].label, "PV");
  assert.ok(payload.suggestions.length >= 1);
});

function userSessionEnv() {
  return {
    SESSION_SECRET,
    DB: {
      prepare() {
        return {
          bind(username) {
            return {
              async first() {
                return {
                  username,
                  display_name: "Viewer",
                  status: "approved",
                  role: "User"
                };
              }
            };
          }
        };
      }
    }
  };
}

function viewerSearchEnv() {
  const documents = [{
    id: 7,
    storage_code: "ARC-000007",
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    document_name: "충전 공정 밸리데이션 보고서",
    note: "",
    rack_face: "A",
    status: "active",
    updated_at: "2026-06-28",
    category_name: "PV",
    category_id: 1,
    rack_code: "1-01",
    zone_number: 1,
    rack_number: 1,
    is_single_sided: 0,
    column_count: 3,
    shelf_count: 4,
    column_number: 2,
    shelf_number: 3,
    slot_code: "2-3",
    tag_names: "중요문서"
  }];

  return {
    SESSION_SECRET,
    DB: {
      prepare(sql) {
        return {
          bind(usernameOrLimit) {
            return {
              async first() {
                if (sql.includes("FROM app_users")) {
                  return {
                    username: usernameOrLimit,
                    display_name: "Viewer",
                    status: "approved",
                    role: "User"
                  };
                }
                return null;
              },
              async all() {
                if (sql.includes("FROM documents d")) {
                  return { results: documents };
                }
                return { results: [] };
              }
            };
          }
        };
      }
    }
  };
}

function csrfFromCookie(cookie) {
  const value = cookie.match(/hanlim_session=([^;]+)/)[1];
  const [payload] = value.split(".", 1);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).csrfToken;
}
