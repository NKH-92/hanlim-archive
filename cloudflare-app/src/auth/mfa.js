import { normalizeRole } from "./shared.js";
import { verifyPassword } from "./passwords.js";
import {
  decryptMfaSecret,
  digestRecoveryCode,
  encryptMfaSecret,
  generateRecoveryCodes,
  normalizeRecoveryCode
} from "./mfaCrypto.js";
import { generateTotpSecret, verifyTotpCode } from "./totp.js";
import { createBatchPlan } from "../platform/d1/batchPlan.js";
import { executeMutationBatch } from "../platform/d1/requestGateway.js";

export async function getMfaStatus(env, userId) {
  const row = await env.DB.prepare(`
    SELECT status, enabled_at
    FROM user_mfa
    WHERE user_id = ?
  `).bind(Number(userId)).first();
  return {
    enabled: row?.status === "enabled",
    pending: row?.status === "pending",
    enabledAt: row?.enabled_at || ""
  };
}

export async function beginMfaEnrollment(env, session, { currentPassword } = {}) {
  const user = await approvedUser(env, session);
  if (!user) return { ok: false, message: "사용자 인증 상태를 확인할 수 없습니다." };
  if (!await verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
    return { ok: false, authFailed: true, message: "현재 비밀번호가 올바르지 않습니다." };
  }
  const existing = await getMfaStatus(env, user.id);
  if (existing.enabled) return { ok: false, message: "이미 2단계 인증이 활성화되어 있습니다." };

  const secret = generateTotpSecret();
  const encrypted = await encryptMfaSecret(env, user.id, secret);
  const enrollmentStatement = env.DB.prepare(`
    INSERT INTO user_mfa (
      user_id, status, encrypted_secret, encryption_key_version,
      last_totp_counter, pending_expires_at, enabled_at, updated_at
    )
    VALUES (?, 'pending', ?, 'v1', NULL, datetime('now', '+10 minutes'), NULL, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE SET
      status = 'pending',
      encrypted_secret = excluded.encrypted_secret,
      encryption_key_version = 'v1',
      last_totp_counter = NULL,
      pending_expires_at = datetime('now', '+10 minutes'),
      enabled_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_mfa.status = 'pending'
  `).bind(user.id, encrypted);
  try {
    await executeMutationBatch(
      env,
      createBatchPlan("identity.mfa.enrollment.begin")
        .step("session.epoch.guard", env.DB.prepare(`
          UPDATE app_users
          SET session_epoch = session_epoch
          WHERE id = ? AND username = ? AND session_epoch = ?
        `).bind(user.id, user.username, Number(session.sessionEpoch || 0)))
        .expectChanged("session.epoch.guard")
        .step("mfa.pending.write", enrollmentStatement)
        .expectChanged("mfa.pending.write")
        .withBudget(2)
    );
  } catch (error) {
    if (error?.code === "STALE_VERSION") {
      return { ok: false, message: "이미 2단계 인증이 활성화되어 있습니다." };
    }
    throw error;
  }
  const label = encodeURIComponent(`한림문서고:${user.username}`);
  const issuer = encodeURIComponent("한림문서고");
  return {
    ok: true,
    secret,
    otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
  };
}

export async function confirmMfaEnrollment(env, session, { currentPassword, code }) {
  const row = await env.DB.prepare(`
    SELECT u.*, m.encrypted_secret, m.encryption_key_version, m.last_totp_counter
    FROM app_users u
    JOIN user_mfa m ON m.user_id = u.id
    WHERE u.id = ?
      AND u.username = ?
      AND u.status = 'approved'
      AND COALESCE(u.security_review_required, 0) = 0
      AND u.session_epoch = ?
      AND m.status = 'pending'
      AND m.pending_expires_at > datetime('now')
  `).bind(Number(session.userId), session.username, Number(session.sessionEpoch || 0)).first();
  if (!row || !await verifyPassword(currentPassword, row.password_salt, row.password_hash)) {
    return { ok: false, message: "현재 비밀번호 또는 인증 설정이 올바르지 않습니다." };
  }
  const secret = await decryptMfaSecret(env, row.id, row.encrypted_secret);
  const counter = await verifyTotpCode(secret, code, { lastCounter: row.last_totp_counter });
  if (counter === null) return { ok: false, message: "인증 코드가 올바르지 않습니다." };

  const recoveryCodes = generateRecoveryCodes();
  const digests = await Promise.all(recoveryCodes.map((value) => digestRecoveryCode(env, row.id, value)));
  let plan = createBatchPlan("identity.mfa.enrollment.confirm")
    .step("mfa.enable", env.DB.prepare(`
      UPDATE user_mfa
      SET status = 'enabled',
          last_totp_counter = ?,
          pending_expires_at = NULL,
          enabled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND status = 'pending'
        AND encrypted_secret = ?
        AND encryption_key_version = ?
        AND pending_expires_at > datetime('now')
    `).bind(
      counter,
      row.id,
      row.encrypted_secret,
      row.encryption_key_version
    ))
    .expectChanged("mfa.enable")
    .step(
      "mfa.recovery.clear",
      env.DB.prepare("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?").bind(row.id)
    );
  for (const [index, digest] of digests.entries()) {
    plan = plan.step(`mfa.recovery.insert.${index + 1}`, env.DB.prepare(`
      INSERT INTO user_mfa_recovery_codes (user_id, code_digest)
      VALUES (?, ?)
    `).bind(row.id, digest));
  }
  plan = plan
    .step("mfa.session-epoch.rotate", env.DB.prepare(`
      UPDATE app_users
      SET session_epoch = session_epoch + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND session_epoch = ?
    `).bind(row.id, Number(session.sessionEpoch || 0)))
    .expectChanged("mfa.session-epoch.rotate")
    .withBudget(13);
  try {
    await executeMutationBatch(env, plan);
  } catch (error) {
    if (error?.code !== "STALE_VERSION") throw error;
    return { ok: false, message: "사용자 인증 상태가 변경되었습니다. 다시 로그인해 주세요." };
  }
  return {
    ok: true,
    recoveryCodes,
    sessionEpoch: Number(session.sessionEpoch || 0) + 1
  };
}

export async function verifyMfaLogin(env, challenge, code) {
  const row = await env.DB.prepare(`
    SELECT u.*, m.encrypted_secret, m.last_totp_counter
    FROM app_users u
    JOIN user_mfa m ON m.user_id = u.id
    WHERE u.id = ?
      AND u.username = ?
      AND u.status = 'approved'
      AND COALESCE(u.security_review_required, 0) = 0
      AND u.session_epoch = ?
      AND m.status = 'enabled'
  `).bind(
    Number(challenge.userId),
    String(challenge.username),
    Number(challenge.sessionEpoch || 0)
  ).first();
  if (!row || !await consumeSecondFactor(env, row, code)) return null;
  return sessionUser(row);
}

export async function disableMfa(env, session, { currentPassword, code }) {
  const row = await env.DB.prepare(`
    SELECT u.*, m.encrypted_secret, m.last_totp_counter
    FROM app_users u
    JOIN user_mfa m ON m.user_id = u.id
    WHERE u.id = ?
      AND u.username = ?
      AND u.status = 'approved'
      AND COALESCE(u.security_review_required, 0) = 0
      AND u.session_epoch = ?
      AND m.status = 'enabled'
  `).bind(Number(session.userId), session.username, Number(session.sessionEpoch || 0)).first();
  if (!row || !await verifyPassword(currentPassword, row.password_salt, row.password_hash)) {
    return { ok: false, message: "현재 비밀번호 또는 2단계 인증 코드가 올바르지 않습니다." };
  }
  const factorClaim = await secondFactorClaimStatement(env, row, code);
  if (!factorClaim) {
    return { ok: false, message: "현재 비밀번호 또는 2단계 인증 코드가 올바르지 않습니다." };
  }
  const plan = createBatchPlan("identity.mfa.disable")
    .step("mfa.factor.claim", factorClaim)
    .expectChanged("mfa.factor.claim")
    .step(
      "mfa.recovery.clear",
      env.DB.prepare("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?").bind(row.id)
    )
    .step(
      "mfa.disable",
      env.DB.prepare("DELETE FROM user_mfa WHERE user_id = ? AND status = 'enabled'").bind(row.id)
    )
    .expectChanged("mfa.disable")
    .step("mfa.session-epoch.rotate", env.DB.prepare(`
      UPDATE app_users
      SET session_epoch = session_epoch + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND session_epoch = ?
    `).bind(row.id, Number(session.sessionEpoch || 0)))
    .expectChanged("mfa.session-epoch.rotate")
    .withBudget(4);
  try {
    await executeMutationBatch(env, plan);
  } catch (error) {
    if (error?.code !== "STALE_VERSION") throw error;
    return { ok: false, message: "사용자 인증 상태가 변경되었습니다. 다시 로그인해 주세요." };
  }
  return { ok: true, sessionEpoch: Number(session.sessionEpoch || 0) + 1 };
}

export async function cleanupPendingMfa(env, { limit = 100 } = {}) {
  const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  return env.DB.prepare(`
    DELETE FROM user_mfa
    WHERE user_id IN (
      SELECT user_id
      FROM user_mfa
      WHERE status = 'pending' AND pending_expires_at <= datetime('now')
      ORDER BY pending_expires_at
      LIMIT ?
    )
  `).bind(boundedLimit).run();
}

async function consumeSecondFactor(env, row, code) {
  const statement = await secondFactorClaimStatement(env, row, code);
  if (!statement) return false;
  const updated = await statement.run();
  return Number(updated?.meta?.changes || 0) === 1;
}

async function secondFactorClaimStatement(env, row, code) {
  const value = String(code ?? "").trim();
  if (/^\d{6}$/.test(value)) {
    const secret = await decryptMfaSecret(env, row.id, row.encrypted_secret);
    const counter = await verifyTotpCode(secret, value, { lastCounter: row.last_totp_counter });
    if (counter === null) return null;
    return env.DB.prepare(`
      UPDATE user_mfa
      SET last_totp_counter = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND status = 'enabled'
        AND (last_totp_counter IS NULL OR last_totp_counter < ?)
    `).bind(counter, row.id, counter);
  }
  if (normalizeRecoveryCode(value).length !== 12) return null;
  const digest = await digestRecoveryCode(env, row.id, value);
  return env.DB.prepare(`
    UPDATE user_mfa_recovery_codes
    SET used_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND code_digest = ? AND used_at IS NULL
  `).bind(row.id, digest);
}

async function approvedUser(env, session) {
  return env.DB.prepare(`
    SELECT id, username, password_salt, password_hash, session_epoch
    FROM app_users
    WHERE id = ?
      AND username = ?
      AND status = 'approved'
      AND COALESCE(security_review_required, 0) = 0
      AND session_epoch = ?
  `).bind(
    Number(session.userId),
    String(session.username || ""),
    Number(session.sessionEpoch || 0)
  ).first();
}

function sessionUser(row) {
  return {
    userId: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: normalizeRole(row.role),
    mustChangePassword: Number(row.must_change_password) === 1,
    sessionEpoch: Number(row.session_epoch || 0)
  };
}
