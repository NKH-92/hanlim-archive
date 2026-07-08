import {
  base64UrlToBytes,
  bytesToBase64Url,
  constantTimeEqual,
  parseCookies
} from "./utils.js";

export const SESSION_COOKIE = "hanlim_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const PASSWORD_ITERATIONS = 100000;
const CSRF_TOKEN_BYTES = 32;

export function getMissingSetup(env) {
  const required = [
    "SESSION_SECRET"
  ];
  const missing = required.filter((key) => !env[key]);

  if (missing.length) {
    return `Cloudflare secret/variable 설정이 필요합니다: ${missing.join(", ")}`;
  }

  if (env.SESSION_SECRET.length < 32) {
    return "SESSION_SECRET는 최소 32자 이상의 랜덤 문자열이어야 합니다.";
  }

  return "";
}

export async function validateUser(env, username, password) {
  const normalizedUsername = username.trim();

  const user = await env.DB.prepare(`
    SELECT username, display_name, password_salt, password_hash, status, role
    FROM app_users
    WHERE username = ?
    LIMIT 1
  `).bind(normalizedUsername).first();

  if (!user || user.status !== "approved") {
    return null;
  }

  const validPassword = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!validPassword) {
    return null;
  }

  return {
    username: user.username,
    displayName: user.display_name,
    role: normalizeRole(user.role)
  };
}

export async function createPasswordRecord(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64Url(saltBytes);
  const hash = await hashPassword(password, salt);

  return { salt, hash };
}

export async function createSessionCookie(user, env, secure = true) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    username: user.username,
    displayName: user.displayName,
    role: user.role,
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
      SELECT username, display_name, status, role
      FROM app_users
      WHERE username = ?
      LIMIT 1
    `).bind(session.username).first();

    if (!user || user.status !== "approved") {
      return null;
    }

    return {
      ...session,
      username: user.username,
      displayName: user.display_name,
      role: normalizeRole(user.role)
    };
  } catch {
    return null;
  }
}

function createCsrfToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(CSRF_TOKEN_BYTES));
  return bytesToBase64Url(bytes);
}

export function expiredSessionCookie(secure = true) {
  const secureAttribute = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly${secureAttribute}; SameSite=Lax`;
}

async function verifyPassword(password, salt, expectedHash) {
  const actualHash = await hashPassword(password, salt);
  return constantTimeEqual(actualHash, expectedHash);
}

async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToBytes(salt),
      iterations: PASSWORD_ITERATIONS
    },
    keyMaterial,
    256
  );

  return bytesToBase64Url(new Uint8Array(bits));
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

function normalizeRole(role) {
  return role === "Admin" ? "Admin" : "User";
}

export async function changeUserPassword(env, username, currentPassword, newPassword) {
  const user = await env.DB.prepare(`
    SELECT password_salt, password_hash
    FROM app_users
    WHERE username = ? AND status = 'approved'
  `).bind(username).first();

  if (!user) {
    return { ok: false, message: "사용자를 찾을 수 없습니다." };
  }

  const valid = await verifyPassword(currentPassword, user.password_salt, user.password_hash);
  if (!valid) {
    return { ok: false, message: "현재 비밀번호가 올바르지 않습니다." };
  }

  if (newPassword.length < 8) {
    return { ok: false, message: "새 비밀번호는 8자 이상이어야 합니다." };
  }

  const record = await createPasswordRecord(newPassword);
  await env.DB.prepare(`
    UPDATE app_users
    SET password_salt = ?,
        password_hash = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE username = ?
  `).bind(record.salt, record.hash, username).run();

  return { ok: true };
}
