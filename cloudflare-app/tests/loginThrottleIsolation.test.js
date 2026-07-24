import assert from "node:assert/strict";
import test from "node:test";

import { handleLogin } from "../src/handlers/sessionHandlers.js";

test("로그인 실패 제한은 같은 이메일도 접속 IP별로 격리한다", async () => {
  const env = recordingEnv();

  const first = await handleLogin(loginRequest("NKH92@HANLIM.COM", "203.0.113.10"), env);
  const second = await handleLogin(loginRequest("nkh92@hanlim.com", "203.0.113.11"), env);

  assert.equal(first.status, 302);
  assert.equal(second.status, 302);

  const throttleKeys = env.state.calls
    .filter(({ sql }) => sql.includes("login_throttle"))
    .map(({ args }) => args[0]);
  assert.equal(throttleKeys.length, 10);
  assert.notEqual(throttleKeys[0], throttleKeys[5], "다른 IP의 pair bucket은 격리되어야 한다");
  assert.equal(throttleKeys[2], throttleKeys[7], "account bucket은 IP가 바뀌어도 유지되어야 한다");
  assert.equal(throttleKeys[4], throttleKeys[9], "global bucket은 모든 접속이 공유해야 한다");
  assert.doesNotMatch(
    JSON.stringify(env.state.calls.filter(({ sql }) => sql.includes("login_throttle"))),
    /nkh92@hanlim\.com|203\.0\.113\./
  );
});

function loginRequest(username, clientAddress) {
  return new Request("https://archive.example.com/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": clientAddress },
    body: new URLSearchParams({ username, password: "wrong-password", returnUrl: "/app" })
  });
}

function recordingEnv() {
  const state = { calls: [] };
  return {
    SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    state,
    DB: {
      prepare(sql) {
        return statement(sql);
      }
    }
  };

  function statement(sql, args = []) {
    return {
      bind(...nextArgs) {
        return statement(sql, nextArgs);
      },
      async first() {
        state.calls.push({ sql, args, operation: "first" });
        return null;
      },
      async run() {
        state.calls.push({ sql, args, operation: "run" });
        return { meta: { changes: 1 } };
      }
    };
  }
}
