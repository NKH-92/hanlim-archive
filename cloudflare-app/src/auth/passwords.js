import { base64UrlToBytes, bytesToBase64Url, constantTimeEqual } from "../platform/crypto/encoding.js";
import { validateNewPassword } from "../domains/identity/index.js";

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
