import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import { createPasswordRecord, createSessionCookie } from "../src/auth.js";

const SESSION_SECRET = "test-session-secret-with-at-least-32-characters";

test("regular users cannot access document administration or disposal routes", async () => {
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

  const disposalGetResponse = await worker.fetch(new Request("https://archive.example.com/documents/disposal", {
    headers: { Cookie: cookie }
  }), env);

  const disposalPostResponse = await worker.fetch(new Request("https://archive.example.com/documents/dispose-filtered", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://archive.example.com"
    },
    body: new URLSearchParams({
      csrf_token: csrfToken,
      categoryId: "1",
      reason: "test"
    })
  }), env);

  assert.equal(getResponse.status, 403);
  assert.equal(postResponse.status, 403);
  assert.equal(disposalGetResponse.status, 403);
  assert.equal(disposalPostResponse.status, 403);
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
  assert.equal(payload.items[0].location.label, "1구역 / 1-1번 랙 / 2열 / 3선반");
  assert.equal(payload.items[0].location.rackLabel, "1-1");
  assert.equal(payload.pagination.totalItems, 1);
  assert.equal(payload.facets.categories[0].label, "PV");
  assert.ok(payload.suggestions.length >= 1);
});

test("dashboard includes disposed documents only when the checkbox is explicit", async () => {
  const user = { username: "viewer", displayName: "Viewer", role: "User" };

  const defaultEnv = dashboardSearchEnv();
  const defaultCookie = await createSessionCookie(user, defaultEnv, false);
  const defaultResponse = await worker.fetch(new Request("https://archive.example.com/app?q=PV", {
    headers: { Cookie: defaultCookie }
  }), defaultEnv);
  const defaultHtml = await defaultResponse.text();
  const defaultSearch = authoritativeDocumentSearch(defaultEnv.state.calls);

  assert.equal(defaultResponse.status, 200);
  assert.ok(defaultSearch);
  assert.match(defaultSearch.sql, /d\.status = \?/);
  assert.equal(defaultSearch.args[0], "active");
  assert.doesNotMatch(defaultHtml, /폐기된 공정 밸리데이션 보고서/);

  const includedEnv = dashboardSearchEnv();
  const includedCookie = await createSessionCookie(user, includedEnv, false);
  const includedResponse = await worker.fetch(new Request("https://archive.example.com/app?q=PV&includeDisposed=1", {
    headers: { Cookie: includedCookie }
  }), includedEnv);
  const includedHtml = await includedResponse.text();
  const includedSearch = authoritativeDocumentSearch(includedEnv.state.calls);

  assert.equal(includedResponse.status, 200);
  assert.ok(includedSearch);
  assert.doesNotMatch(includedSearch.sql, /d\.status = \?/);
  assert.ok(!includedSearch.args.includes("active"));
  assert.match(includedHtml, /폐기된 공정 밸리데이션 보고서/);
});

test("document CSV import loads only active categories and tags", async () => {
  const env = adminImportEnv();
  const user = { username: "admin", displayName: "관리자", role: "Admin" };
  const cookie = await createSessionCookie(user, env, false);
  const csrfToken = csrfFromCookie(cookie);

  const response = await worker.fetch(new Request("https://archive.example.com/documents/import", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://archive.example.com"
    },
    body: new URLSearchParams({
      csrf_token: csrfToken,
      csvText: [
        "documentNumber,revisionNumber,documentName,category,rackCode,rackColumn,shelfNumber,rackFace",
        "DOC-1,Rev.0,문서,비활성분류,1-01,1,1,1"
      ].join("\n")
    })
  }), env);

  assert.equal(response.status, 200);
  assert.ok(env.state.sql.some((sql) => sql.includes("FROM categories") && sql.includes("WHERE is_active = 1")));
  assert.ok(env.state.sql.some((sql) => sql.includes("FROM tags") && sql.includes("WHERE is_active = 1")));
  assert.ok(!env.state.sql.some((sql) => sql.includes("INSERT INTO documents")));
});

test("locked accounts are redirected with a lock message and no new failure is recorded", async () => {
  const env = loginThrottleEnv({ locked: true });

  const response = await worker.fetch(loginRequest("someone", "wrong-password"), env);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("Location"), /error=locked/);
  assert.ok(!env.state.runs.some((sql) => sql.includes("INSERT INTO login_throttle")));
});

test("failed logins record a throttle failure", async () => {
  const env = loginThrottleEnv({ locked: false, user: null });

  const response = await worker.fetch(loginRequest("someone", "wrong-password"), env);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("Location"), /error=1/);
  assert.ok(env.state.runs.some((sql) => sql.includes("INSERT INTO login_throttle")));
});

test("successful logins clear recorded failures", async () => {
  const record = await createPasswordRecord("correct-password");
  const env = loginThrottleEnv({
    locked: false,
    user: {
      username: "someone",
      display_name: "사용자",
      password_salt: record.salt,
      password_hash: record.hash,
      status: "approved",
      role: "User"
    }
  });

  const response = await worker.fetch(loginRequest("someone", "correct-password"), env);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/app");
  assert.ok(env.state.runs.some((sql) => sql.includes("DELETE FROM login_throttle")));
});

function loginRequest(username, password) {
  return new Request("https://archive.example.com/login", {
    method: "POST",
    headers: { Origin: "https://archive.example.com" },
    body: new URLSearchParams({ username, password })
  });
}

function loginThrottleEnv({ locked, user = null }) {
  const state = { runs: [] };

  return {
    SESSION_SECRET,
    state,
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes("FROM login_throttle")) {
                  return locked ? { locked_until: "2999-01-01 00:00:00" } : null;
                }
                if (sql.includes("FROM app_users")) {
                  return user;
                }
                return null;
              },
              async all() {
                return { results: [] };
              },
              async run() {
                state.runs.push(sql);
                return { meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  };
}

function adminImportEnv() {
  const state = { sql: [] };

  function resultsFor(sql) {
    if (sql.includes("FROM rack_slots")) {
      return [{
        id: 30,
        slot_code: "1-1",
        column_number: 1,
        shelf_number: 1,
        code: "1-01",
        zone_number: 1,
        rack_number: 1,
        is_single_sided: 0
      }];
    }
    return [];
  }

  return {
    SESSION_SECRET,
    state,
    DB: {
      prepare(sql) {
        state.sql.push(sql);
        const methods = {
          async first() {
            if (sql.includes("FROM app_users")) {
              return {
                username: "admin",
                display_name: "관리자",
                status: "approved",
                role: "Admin"
              };
            }
            return null;
          },
          async all() {
            return { results: resultsFor(sql) };
          },
          async run() {
            return { meta: { changes: 1 } };
          }
        };
        return {
          ...methods,
          bind() {
            return methods;
          }
        };
      }
    }
  };
}

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

function dashboardSearchEnv() {
  const state = { calls: [] };
  const document = {
    id: 7,
    storage_code: "ARC-000007",
    document_number: "PV-2026-014",
    revision_number: "Rev.1",
    revision_date: "2026-04-14",
    disposal_due_year: 2031,
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
  };
  const disposedDocument = {
    ...document,
    id: 8,
    storage_code: "ARC-000008",
    document_number: "PV-2025-008",
    document_name: "폐기된 공정 밸리데이션 보고서",
    status: "disposed",
    updated_at: "2026-06-29"
  };

  return {
    SESSION_SECRET,
    state,
    DB: {
      prepare(sql) {
        const execution = (args = []) => ({
          async first() {
            state.calls.push({ type: "first", sql, args });
            if (sql.includes("FROM app_users")) {
              return {
                username: "viewer",
                display_name: "Viewer",
                status: "approved",
                role: "User"
              };
            }
            return null;
          },
          async all() {
            state.calls.push({ type: "all", sql, args });
            if (sql.includes("FROM documents d") && sql.includes("LIMIT ?")) {
              return {
                results: args.includes("active")
                  ? [{ ...document }]
                  : [{ ...document }, { ...disposedDocument }]
              };
            }
            return { results: [] };
          },
          async run() {
            state.calls.push({ type: "run", sql, args });
            return { meta: { changes: 1 } };
          }
        });
        return {
          ...execution(),
          bind(...args) {
            return execution(args);
          }
        };
      }
    }
  };
}

function authoritativeDocumentSearch(calls) {
  return calls.find((call) =>
    call.type === "all" &&
    call.sql.includes("FROM documents d") &&
    call.sql.includes("GROUP BY d.id") &&
    call.sql.includes("ORDER BY d.updated_at DESC, d.id DESC") &&
    call.sql.includes("LIMIT ?")
  );
}

function csrfFromCookie(cookie) {
  const value = cookie.match(/hanlim_session=([^;]+)/)[1];
  const [payload] = value.split(".", 1);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).csrfToken;
}
