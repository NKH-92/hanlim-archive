import { createPasswordRecord } from "../auth.js";
import { clean } from "../utils.js";

export async function getAppUsers(env) {
  const result = await env.DB.prepare(`
    SELECT id, username, display_name, status, role, requested_at, approved_at, approved_by, rejected_at, rejected_by
    FROM app_users
    ORDER BY
      CASE role WHEN 'Admin' THEN 0 ELSE 1 END,
      CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      requested_at DESC,
      id DESC
  `).all();

  return result.results ?? [];
}

export async function createSignupRequest(env, values) {
  const username = clean(values.username);
  const displayName = clean(values.displayName) || username;
  const password = String(values.password ?? "");

  if (!username || username.length < 4) {
    return { ok: false, message: "아이디는 4자 이상이어야 합니다." };
  }

  if (!password || password.length < 8) {
    return { ok: false, message: "비밀번호는 8자 이상이어야 합니다." };
  }

  const existing = await env.DB.prepare(`
    SELECT id, status
    FROM app_users
    WHERE username = ?
  `).bind(username).first();

  if (existing?.status === "pending") {
    return { ok: false, message: "이미 승인 대기 중인 아이디입니다." };
  }

  if (existing?.status === "approved") {
    return { ok: false, message: "이미 승인된 아이디입니다." };
  }

  const passwordRecord = await createPasswordRecord(password);

  if (existing?.status === "rejected") {
    await env.DB.prepare(`
      UPDATE app_users
      SET
        display_name = ?,
        password_salt = ?,
        password_hash = ?,
        status = 'pending',
        requested_at = CURRENT_TIMESTAMP,
        approved_at = NULL,
        approved_by = NULL,
        rejected_at = NULL,
        rejected_by = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(displayName, passwordRecord.salt, passwordRecord.hash, existing.id).run();

    return { ok: true };
  }

  await env.DB.prepare(`
    INSERT INTO app_users (username, display_name, password_salt, password_hash, status, updated_at)
    VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `).bind(username, displayName, passwordRecord.salt, passwordRecord.hash).run();

  return { ok: true };
}

export async function approveUser(env, id, actor) {
  const result = await env.DB.prepare(`
    UPDATE app_users
    SET status = 'approved',
        approved_at = CURRENT_TIMESTAMP,
        approved_by = ?,
        rejected_at = NULL,
        rejected_by = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'User' AND status IN ('pending', 'rejected')
  `).bind(actor, id).run();

  return { ok: result.meta.changes > 0 };
}

export async function rejectUser(env, id, actor) {
  const result = await env.DB.prepare(`
    UPDATE app_users
    SET status = 'rejected',
        rejected_at = CURRENT_TIMESTAMP,
        rejected_by = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'User' AND status IN ('pending', 'approved')
  `).bind(actor, id).run();

  return { ok: result.meta.changes > 0 };
}
