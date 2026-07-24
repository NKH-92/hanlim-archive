import assert from "node:assert/strict";
import test from "node:test";

import { validateUser } from "../src/auth.js";
import { verifyPassword } from "../src/auth/passwords.js";

test("과대 로그인 입력은 DB 조회와 PBKDF2 전에 거부한다", async () => {
  let prepared = 0;
  let verified = 0;
  const env = {
    DB: {
      prepare() {
        prepared += 1;
        throw new Error("DB lookup must not run");
      }
    }
  };
  const result = await validateUser(env, "a".repeat(321), "x", {
    verifyPasswordFn: async () => {
      verified += 1;
      return true;
    }
  });
  assert.equal(result, null);
  assert.equal(prepared, 0);
  assert.equal(verified, 0);

  const overlongPassword = "가".repeat(400);
  assert.equal(await verifyPassword(overlongPassword, "unused", "unused"), false);
});
