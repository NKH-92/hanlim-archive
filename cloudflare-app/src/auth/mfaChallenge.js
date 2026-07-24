import {
  base64UrlToBytes,
  bytesToBase64Url,
  constantTimeEqual
} from "../platform/crypto/encoding.js";
import { parseCookies } from "../platform/http/cookies.js";

export const MFA_CHALLENGE_COOKIE = "hanlim_mfa_challenge";
const CHALLENGE_TTL_SECONDS = 5 * 60;

export async function createMfaChallengeCookie(claims, env, secure = true) {
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(claims.exp) > now
    ? Number(claims.exp)
    : now + CHALLENGE_TTL_SECONDS;
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    purpose: "mfa-login",
    userId: Number(claims.userId),
    username: String(claims.username),
    sessionEpoch: Number(claims.sessionEpoch || 0),
    returnUrl: String(claims.returnUrl || "/app"),
    attempts: Number(claims.attempts || 0),
    exp
  })));
  const signature = await signChallenge(payload, env);
  return cookie(`${payload}.${signature}`, Math.max(0, exp - now), secure);
}

export async function readMfaChallenge(request, env) {
  const value = parseCookies(request.headers.get("Cookie") || "")[MFA_CHALLENGE_COOKIE];
  if (!value || !value.includes(".")) return null;
  const [payload, signature] = value.split(".", 2);
  if (!constantTimeEqual(await signChallenge(payload, env), signature)) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    if (
      claims.purpose !== "mfa-login" ||
      !Number.isSafeInteger(Number(claims.userId)) ||
      Number(claims.userId) <= 0 ||
      !claims.username ||
      Number(claims.exp) <= Math.floor(Date.now() / 1000) ||
      Number(claims.attempts || 0) >= 5
    ) return null;
    return claims;
  } catch {
    return null;
  }
}

export function expiredMfaChallengeCookie(secure = true) {
  return cookie("", 0, secure);
}

async function signChallenge(payload, env) {
  const secret = String(env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`mfa-challenge\0${payload}`)
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function cookie(value, maxAge, secure) {
  return `${MFA_CHALLENGE_COOKIE}=${value}; Path=/login/mfa; Max-Age=${maxAge}; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}
