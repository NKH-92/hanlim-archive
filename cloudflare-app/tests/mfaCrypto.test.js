import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptMfaSecret,
  digestRecoveryCode,
  encryptMfaSecret
} from "../src/auth/mfaCrypto.js";
import {
  createMfaChallengeCookie,
  readMfaChallenge
} from "../src/auth/mfaChallenge.js";
import { totpAtCounter, verifyTotpCode } from "../src/auth/totp.js";
import { bytesToBase64Url } from "../src/platform/crypto/encoding.js";

const env = {
  SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
  AUTH_HMAC_SECRET: "test-auth-hmac-secret-with-at-least-32-characters",
  MFA_ENCRYPTION_KEY_V1: bytesToBase64Url(new Uint8Array(32).fill(7))
};

test("TOTP는 RFC 6238 SHA-1 벡터와 replay counter 계약을 지킨다", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(await totpAtCounter(secret, 1), "287082");
  assert.equal(await verifyTotpCode(secret, "287082", { nowMs: 59_000, window: 0 }), 1);
  assert.equal(await verifyTotpCode(secret, "287082", {
    nowMs: 59_000,
    window: 0,
    lastCounter: 1
  }), null);
});

test("MFA secret은 user-bound AES-GCM으로 round-trip하고 변조를 거부한다", async () => {
  const encrypted = await encryptMfaSecret(env, 7, "JBSWY3DPEHPK3PXP");
  assert.doesNotMatch(encrypted, /JBSWY3DPEHPK3PXP/);
  assert.equal(await decryptMfaSecret(env, 7, encrypted), "JBSWY3DPEHPK3PXP");
  await assert.rejects(() => decryptMfaSecret(env, 8, encrypted));
  const parts = encrypted.split(".");
  parts[2] = `${parts[2].startsWith("A") ? "B" : "A"}${parts[2].slice(1)}`;
  const tampered = parts.join(".");
  await assert.rejects(() => decryptMfaSecret(env, 7, tampered));
  assert.equal(
    await digestRecoveryCode(env, 7, "ABCD-EFGH-IJKL"),
    await digestRecoveryCode(env, 7, "abcdefghijkl")
  );
});

test("MFA challenge cookie는 서명된 최소 claim만 수락한다", async () => {
  const cookie = await createMfaChallengeCookie({
    userId: 7,
    username: "user@hanlim.com",
    sessionEpoch: 3,
    returnUrl: "/app?q=x"
  }, env, true);
  const request = new Request("https://archive.example.com/login/mfa", {
    headers: { Cookie: cookie.split(";", 1)[0] }
  });
  const challenge = await readMfaChallenge(request, env);
  assert.equal(challenge.userId, 7);
  assert.equal(challenge.sessionEpoch, 3);
  assert.equal(challenge.returnUrl, "/app?q=x");
  assert.doesNotMatch(cookie, /user@hanlim\.com/);
  const retryCookie = await createMfaChallengeCookie({ ...challenge, attempts: 1 }, env, true);
  const retry = await readMfaChallenge(new Request("https://archive.example.com/login/mfa", {
    headers: { Cookie: retryCookie.split(";", 1)[0] }
  }), env);
  assert.equal(retry.exp, challenge.exp, "실패 재시도는 challenge 만료 시각을 연장하지 않는다");
});
