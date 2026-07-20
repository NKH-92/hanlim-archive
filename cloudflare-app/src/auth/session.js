import {
  base64UrlToBytes,
  bytesToBase64Url,
  constantTimeEqual
} from "../platform/crypto/encoding.js";
import { parseCookies } from "../platform/http/cookies.js";
import { permissionFlags } from "../permissions.js";
import { normalizeRole } from "./shared.js";

export const SESSION_COOKIE = "hanlim_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const CSRF_TOKEN_BYTES = 32;

export function getMissingSetup(env) {
  const required = ["SESSION_SECRET"];
  const missing = required.filter((key) => !env[key]);

  if (missing.length) {
    return `Cloudflare secret/variable 설정이 필요합니다: ${missing.join(", ")}`;
  }

  if (env.SESSION_SECRET.length < 32) {
    return "SESSION_SECRET는 최소 32자 이상의 랜덤 문자열이어야 합니다.";
  }

  return "";
}

export async function createSessionCookie(user, env, secure = true) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    csrfToken: createCsrfToken(),
    exp
  })));
  const signature = await sign(payload, env);

  const secureAttribute = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly${secureAttribute}; SameSite=Lax`;
}

export async function readSession(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const value = cookies[SESSION_COOKIE];

  if (!value || !value.includes(".")) {
    return null;
  }

  const [payload, signature] = value.split(".", 2);
  const expected = await sign(payload, env);

  if (!constantTimeEqual(expected, signature)) {
    return null;
  }

  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payload));
    const session = JSON.parse(json);

    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    if (!["Admin", "User"].includes(session.role)) {
      return null;
    }

    if (typeof session.csrfToken !== "string" || session.csrfToken.length < 32) {
      return null;
    }

    const user = await env.DB.prepare(`
      SELECT
        id,
        username,
        display_name,
        status,
        role,
        must_change_password,
        can_manage_documents,
        can_move_documents,
        can_manage_disposals,
        can_manage_sets,
        can_manage_masters,
        can_manage_users,
        can_view_audit,
        can_apply_document_snapshots
      FROM app_users
      WHERE username = ?
      LIMIT 1
    `).bind(session.username).first();

    if (!user || user.status !== "approved") {
      return null;
    }

    return {
      ...session,
      userId: Number(user.id) || null,
      username: user.username,
      displayName: user.display_name,
      role: normalizeRole(user.role),
      mustChangePassword: Number(user.must_change_password) === 1,
      ...permissionFlags(user)
    };
  } catch {
    return null;
  }
}

export function expiredSessionCookie(secure = true) {
  const secureAttribute = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly${secureAttribute}; SameSite=Lax`;
}

function createCsrfToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(CSRF_TOKEN_BYTES));
  return bytesToBase64Url(bytes);
}

async function sign(payload, env) {
  const secret = getSessionSecret(env);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));

  return bytesToBase64Url(new Uint8Array(signature));
}

function getSessionSecret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
  }

  return env.SESSION_SECRET;
}
