import assert from "node:assert/strict";
import test from "node:test";

import { handleLogin } from "../src/handlers/sessionHandlers.js";

test("로그인 실패 제한은 같은 이메일도 접속 IP별로 격리해 한 실패당 4-step batch 한 번만 실행한다", async () => {
  const env = recordingEnv();

  const first = await handleLogin(loginRequest("NKH92@HANLIM.COM", "203.0.113.10"), env);
  const second = await handleLogin(loginRequest("nkh92@hanlim.com", "203.0.113.11"), env);

  assert.equal(first.status, 302);
  assert.equal(second.status, 302);
  assert.equal(env.state.batches.length, 2);
  assert.ok(env.state.batches.every((statements) => statements.length === 4));

  const [firstFailure, secondFailure] = env.state.batches;
  assert.notEqual(firstFailure[0].args[0], secondFailure[0].args[0], "다른 IP의 pair bucket은 격리되어야 한다");
  assert.equal(firstFailure[1].args[0], secondFailure[1].args[0], "account bucket은 IP가 바뀌어도 유지되어야 한다");
  assert.notEqual(firstFailure[2].args[0], secondFailure[2].args[0], "IP bucket은 접속 IP별로 격리되어야 한다");
  assert.equal(firstFailure[3].args[0], secondFailure[3].args[0], "global bucket은 모든 접속이 공유해야 한다");
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
  const state = { calls: [], batches: [] };
  return {
    SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    state,
    DB: {
      prepare(sql) {
        return statement(sql);
      },
      async batch(statements) {
        state.batches.push(statements.map(({ sql, args }) => ({ sql, args })));
        return Promise.all(statements.map((item) => item.run()));
      }
    }
  };

  function statement(sql, args = []) {
    return {
      sql,
      args,
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
