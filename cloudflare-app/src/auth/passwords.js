import { base64UrlToBytes, bytesToBase64Url, constantTimeEqual } from "../utils.js";

const PASSWORD_ITERATIONS = 100000;

export async function createPasswordRecord(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64Url(saltBytes);
  const hash = await hashPassword(password, salt);

  return { salt, hash };
}

export async function verifyPassword(password, salt, expectedHash) {
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
        must_change_password = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE username = ?
  `).bind(record.salt, record.hash, username).run();

  return { ok: true };
}
