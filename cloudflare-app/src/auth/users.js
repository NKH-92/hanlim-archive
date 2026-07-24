import {
  createPasswordRecord,
  isPasswordInputBounded,
  passwordRecordNeedsUpgrade,
  verifyPassword
} from "./passwords.js";
import { normalizeRole } from "./shared.js";
import { createBatchPlan } from "../platform/d1/batchPlan.js";
import { executeMutationBatch } from "../platform/d1/requestGateway.js";

// 존재하지 않거나 승인되지 않은 계정도 승인 계정과 같은 PBKDF2 작업을 수행한다.
const DUMMY_PASSWORD_RECORD = Object.freeze({
  salt: "AAAAAAAAAAAAAAAAAAAAAA",
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
});

export async function validateUser(env, username, password, { verifyPasswordFn = verifyPassword } = {}) {
  const normalizedUsername = String(username ?? "").trim();
  if (normalizedUsername.length > 320 || !isPasswordInputBounded(password)) return null;

  let user;
  try {
    user = await env.DB.prepare(`
      SELECT u.*,
        EXISTS (
          SELECT 1 FROM user_mfa m
          WHERE m.user_id = u.id AND m.status = 'enabled'
        ) AS mfa_enabled
      FROM app_users u
      WHERE u.username = ?
      LIMIT 1
    `).bind(normalizedUsername).first();
  } catch (error) {
    if (!/no such table:\s*user_mfa/i.test(String(error?.message || error))) throw error;
    user = await env.DB.prepare(`
      SELECT *
      FROM app_users
      WHERE username = ?
      LIMIT 1
    `).bind(normalizedUsername).first();
  }

  // 보안 검토 대상은 승인·비밀번호가 맞아도 로그인하지 않는다(fail-closed).
  // pre-0034 스키마에는 security_review_required가 없을 수 있다.
  const canAuthenticate = Boolean(
    user
    && user.status === "approved"
    && Number(user.security_review_required || 0) !== 1
    && !isExpired(user.expires_at)
  );
  const passwordRecord = canAuthenticate
    ? { salt: user.password_salt, hash: user.password_hash }
    : DUMMY_PASSWORD_RECORD;
  const validPassword = await verifyPasswordFn(password, passwordRecord.salt, passwordRecord.hash);
  if (!canAuthenticate || !validPassword) {
    return null;
  }
  if (verifyPasswordFn === verifyPassword && passwordRecordNeedsUpgrade(user.password_hash)) {
    const upgraded = await createPasswordRecord(password);
    await env.DB.prepare(`
      UPDATE app_users
      SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND password_hash = ?
    `).bind(upgraded.salt, upgraded.hash, user.id, user.password_hash).run();
  }

  return {
    userId: Number(user.id) || null,
    username: user.username,
    displayName: user.display_name,
    role: normalizeRole(user.role),
    mustChangePassword: Number(user.must_change_password) === 1,
    sessionEpoch: Number(user.session_epoch || 0),
    mfaEnabled: Number(user.mfa_enabled || 0) === 1
  };
}

export async function cleanupExpiredReleaseSmokePrincipals(env) {
  const expiredUsers = `
    SELECT username
    FROM app_users
    WHERE approved_by LIKE 'release-smoke:%'
      AND expires_at IS NOT NULL
      AND expires_at <= CURRENT_TIMESTAMP
  `;
  const plan = createBatchPlan("identity.release-smoke.expired.cleanup")
    .step("legacy-throttle.clear", env.DB.prepare(`
      DELETE FROM login_throttle
      WHERE username IN (${expiredUsers})
    `))
    .step("users.delete", env.DB.prepare(`
      DELETE FROM app_users
      WHERE approved_by LIKE 'release-smoke:%'
        AND expires_at IS NOT NULL
        AND expires_at <= CURRENT_TIMESTAMP
    `))
    .withBudget(2);
  await executeMutationBatch(env, plan);
  return { ok: true };
}

function isExpired(value) {
  if (!value) return false;
  const normalized = String(value).includes("T") ? String(value) : `${String(value).replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}
