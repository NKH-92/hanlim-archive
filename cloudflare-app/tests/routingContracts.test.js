import assert from "node:assert/strict";
import test from "node:test";

import { createSessionCookie } from "../src/auth.js";
import worker from "../src/index.js";

const ORIGIN = "https://archive.example.com";
const SESSION_SECRET = "test-session-secret-with-at-least-32-characters";

test("전역 CSS와 JS asset은 인증 없이 정적 asset binding에서 제공한다", async (t) => {
  const contentTypes = new Map([
    ["/assets/app.css", "text/css; charset=utf-8"],
    ["/assets/app.js", "application/javascript; charset=utf-8"]
  ]);
  const env = {
    ASSETS: {
      fetch(request) {
        const path = new URL(request.url).pathname;
        return new Response(`asset:${path}`, {
          headers: { "Content-Type": contentTypes.get(path) || "application/octet-stream" }
        });
      }
    }
  };

  for (const [path, contentType] of contentTypes) {
    await t.test(path, async () => {
      const response = await worker.fetch(new Request(`${ORIGIN}${path}`), env);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), contentType);
      assert.equal(await response.text(), `asset:${path}`);
    });
  }
});

test("진입점의 공개·인증 경계는 라우터 분리 후에도 응답 우선순위를 유지한다", async (t) => {
  const normalEnv = sessionEnv(false);
  const forcedEnv = sessionEnv(true);
  const normalCookie = await sessionCookie(normalEnv, false);
  const forcedCookie = await sessionCookie(forcedEnv, true);
  const unauthenticatedUrl = new URL(`${ORIGIN}/missing?q=한글`);
  const unauthenticatedLocation = `/login?returnUrl=${encodeURIComponent(unauthenticatedUrl.pathname + unauthenticatedUrl.search)}`;

  const cases = [
    {
      name: "미인증 경로는 원래 경로와 검색어를 보존해 로그인으로 보낸다",
      request: new Request(`${ORIGIN}/missing?q=한글`),
      env: {},
      status: 302,
      location: unauthenticatedLocation
    },
    {
      name: "가입 GET은 세션 조회 전에 404로 닫혀 있다",
      request: new Request(`${ORIGIN}/signup`),
      env: {},
      status: 404,
      location: null
    },
    {
      name: "신뢰한 출처의 가입 POST도 404로 닫혀 있다",
      request: new Request(`${ORIGIN}/signup`, { method: "POST", headers: { Origin: ORIGIN } }),
      env: {},
      status: 404,
      location: null
    },
    {
      name: "비밀번호 변경 대상은 미지원 경로보다 변경 화면이 우선한다",
      request: authenticatedRequest("/missing", forcedCookie),
      env: forcedEnv,
      status: 302,
      location: "/account/password?required=1"
    },
    {
      name: "일반 인증 사용자의 미지원 경로는 최종 라우터에서 404가 된다",
      request: authenticatedRequest("/missing", normalCookie),
      env: normalEnv,
      status: 404,
      location: null
    },
    {
      name: "강제 변경 세션의 GET 로그아웃은 기존처럼 홈으로 돌린다",
      request: authenticatedRequest("/logout", forcedCookie),
      env: forcedEnv,
      status: 302,
      location: "/app"
    },
    {
      name: "인증 POST의 CSRF 검사는 미지원 경로 404보다 먼저 수행된다",
      request: authenticatedRequest("/missing", normalCookie, {
        method: "POST",
        headers: { Origin: ORIGIN }
      }),
      env: normalEnv,
      status: 403,
      location: null
    },
    {
      name: "교차 출처 POST는 세션·라우트 판정보다 먼저 거부된다",
      request: new Request(`${ORIGIN}/signup`, {
        method: "POST",
        headers: { Origin: "https://evil.example.com" }
      }),
      env: {},
      status: 403,
      location: null
    }
  ];

  for (const contract of cases) {
    await t.test(contract.name, async () => {
      const response = await worker.fetch(contract.request, contract.env);
      assert.equal(response.status, contract.status);
      assert.equal(response.headers.get("Location"), contract.location);
    });
  }
});

async function sessionCookie(env, mustChangePassword) {
  return createSessionCookie({
    username: "user@hanlim.com",
    displayName: "사용자",
    role: "User",
    mustChangePassword
  }, env, false);
}

function authenticatedRequest(path, cookie, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie.split(";", 1)[0]);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

function sessionEnv(mustChangePassword) {
  return {
    SESSION_SECRET,
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return {
                  id: 1,
                  username: "user@hanlim.com",
                  display_name: "사용자",
                  status: "approved",
                  role: "User",
                  must_change_password: mustChangePassword ? 1 : 0,
                  can_manage_documents: 0,
                  can_move_documents: 0,
                  can_manage_disposals: 0,
                  can_manage_sets: 0,
                  can_manage_masters: 0,
                  can_manage_users: 0,
                  can_view_audit: 0
                };
              }
            };
          }
        };
      }
    }
  };
}
