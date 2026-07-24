import { base64UrlToBytes, bytesToBase64Url, constantTimeEqual } from "../platform/crypto/encoding.js";
import { validateNewPassword } from "../domains/identity/index.js";

const LEGACY_PASSWORD_ITERATIONS = 100000;
const CURRENT_PASSWORD_ITERATIONS = 600000;
const PASSWORD_HASH_PREFIX = "pbkdf2-sha256";
export const MAX_PASSWORD_INPUT_BYTES = 1024;

export async function createPasswordRecord(password) {
  assertPasswordInputBounded(password);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64Url(saltBytes);
  const digest = await hashPassword(password, salt, CURRENT_PASSWORD_ITERATIONS);
  const hash = `${PASSWORD_HASH_PREFIX}$${CURRENT_PASSWORD_ITERATIONS}$${digest}`;

  return { salt, hash };
}

export async function verifyPassword(password, salt, expectedHash) {
  if (!isPasswordInputBounded(password)) return false;
  const record = parsePasswordHash(expectedHash);
  const actualHash = await hashPassword(password, salt, record.iterations);
  return constantTimeEqual(actualHash, record.digest);
}

export function passwordRecordNeedsUpgrade(expectedHash) {
  const record = parsePasswordHash(expectedHash);
  return record.legacy || record.iterations < CURRENT_PASSWORD_ITERATIONS;
}

async function hashPassword(password, salt, iterations) {
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
      iterations
    },
    keyMaterial,
    256
  );

  return bytesToBase64Url(new Uint8Array(bits));
}

function parsePasswordHash(expectedHash) {
  const value = String(expectedHash ?? "");
  const match = value.match(/^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)$/);
  if (!match) {
    return { digest: value, iterations: LEGACY_PASSWORD_ITERATIONS, legacy: true };
  }
  const iterations = Number(match[1]);
  if (!Number.isInteger(iterations) || iterations < LEGACY_PASSWORD_ITERATIONS || iterations > 2_000_000) {
    return { digest: "", iterations: CURRENT_PASSWORD_ITERATIONS, legacy: false };
  }
  return { digest: match[2], iterations, legacy: false };
}

export function isPasswordInputBounded(password) {
  return new TextEncoder().encode(String(password ?? "")).byteLength <= MAX_PASSWORD_INPUT_BYTES;
}

function assertPasswordInputBounded(password) {
  if (!isPasswordInputBounded(password)) throw new RangeError("Password input is too large.");
}

export async function changeUserPassword(env, username, currentPassword, newPassword) {
  const user = await env.DB.prepare(`
    SELECT password_salt, password_hash, session_epoch
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

  // 길이 검사보다 먼저: 현재와 동일하면 forced-change를 해제하지 않는다.
  if (await verifyPassword(newPassword, user.password_salt, user.password_hash)) {
    return { ok: false, message: "새 비밀번호는 현재 비밀번호와 달라야 합니다." };
  }

  const passwordValidation = validateNewPassword(newPassword);
  if (!passwordValidation.ok) return passwordValidation;

  const record = await createPasswordRecord(newPassword);
  const currentSessionEpoch = Number(user.session_epoch || 0);
  const nextSessionEpoch = currentSessionEpoch + 1;
  const updated = await env.DB.prepare(`
    UPDATE app_users
    SET password_salt = ?,
        password_hash = ?,
        must_change_password = 0,
        session_epoch = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE username = ? AND status = 'approved' AND session_epoch = ?
  `).bind(record.salt, record.hash, nextSessionEpoch, username, currentSessionEpoch).run();

  if (Number(updated?.meta?.changes || 0) !== 1) {
    return { ok: false, message: "사용자 인증 상태가 변경되었습니다. 다시 로그인한 뒤 시도하세요." };
  }

  return { ok: true, sessionEpoch: nextSessionEpoch };
}
