import { createPasswordRecord } from "../auth.js";
import { permissionFlags, PERMISSION_KEYS } from "../permissions.js";
import { clean } from "../utils.js";
import { createSystemAuditStatement } from "./systemAuditData.js";
import { actorUsername, canTransitionUser, transitionFor, validateNewPassword } from "../domains/identity/index.js";
import { createUserPermissionMutationPlan, createUserStatusMutationPlan } from "../domains/identity/infrastructure/userMutationPlans.js";

const USER_PERMISSION_COLUMNS = PERMISSION_KEYS.join(", ");

export async function getAppUsers(env) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      username,
      display_name,
      status,
      role,
      requested_at,
      approved_at,
      approved_by,
      rejected_at,
      rejected_by,
      updated_at,
      ${USER_PERMISSION_COLUMNS}
    FROM app_users
    ORDER BY
      CASE role WHEN 'Admin' THEN 0 ELSE 1 END,
      CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'disabled' THEN 2 ELSE 3 END,
      requested_at DESC,
      id DESC
  `).all();

  return result.results ?? [];
}

export async function getAppUser(env, id) {
  return env.DB.prepare(`
    SELECT
      id,
      username,
      display_name,
      status,
      role,
      requested_at,
      approved_at,
      approved_by,
      rejected_at,
      rejected_by,
      updated_at,
      ${USER_PERMISSION_COLUMNS}
    FROM app_users
    WHERE id = ?
  `).bind(id).first();
}

export async function createSignupRequest(env, values) {
  const username = clean(values.username);
  const displayName = clean(values.displayName) || username;
  const password = String(values.password ?? "");

  if (!username || username.length < 4) {
    return { ok: false, message: "아이디는 4자 이상이어야 합니다." };
  }

  const passwordValidation = validateNewPassword(password, { label: "비밀번호" });
  if (!passwordValidation.ok) return passwordValidation;

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

  if (existing?.status === "disabled") {
    return { ok: false, message: "사용이 중지된 아이디입니다. 관리자에게 문의하세요." };
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
  return transitionUserStatus(env, id, actor, {
    action: "approve",
    summary: "사용자 승인",
    updateSql: `
      status = 'approved',
      approved_at = CURRENT_TIMESTAMP,
      approved_by = ?,
      rejected_at = NULL,
      rejected_by = NULL,
      updated_at = CURRENT_TIMESTAMP
    `,
    updateBinds: [actorUsername(actor)]
  });
}

export async function rejectUser(env, id, actor) {
  return transitionUserStatus(env, id, actor, {
    action: "reject",
    summary: "가입 요청 반려",
    updateSql: `
      status = 'rejected',
      approved_at = NULL,
      approved_by = NULL,
      rejected_at = CURRENT_TIMESTAMP,
      rejected_by = ?,
      updated_at = CURRENT_TIMESTAMP
    `,
    updateBinds: [actorUsername(actor)]
  });
}

export async function disableUser(env, id, actor) {
  return transitionUserStatus(env, id, actor, {
    action: "disable",
    summary: "사용자 사용중지",
    updateSql: "status = 'disabled', updated_at = CURRENT_TIMESTAMP"
  });
}

export async function enableUser(env, id, actor) {
  return transitionUserStatus(env, id, actor, {
    action: "enable",
    summary: "사용자 다시 사용",
    updateSql: "status = 'approved', updated_at = CURRENT_TIMESTAMP"
  });
}

export async function updateUserPermissions(env, id, permissions, actor) {
  const user = await getAppUser(env, id);
  if (!user || user.role !== "User") {
    return { ok: false, message: "권한을 변경할 사용자를 찾을 수 없습니다." };
  }

  const beforePermissions = permissionFlags(user);
  const afterPermissions = permissionFlags(permissions);
  if (PERMISSION_KEYS.every((permission) => beforePermissions[permission] === afterPermissions[permission])) {
    return { ok: true, unchanged: true };
  }

  const expectedUpdatedAt = user.updated_at;
  const guardSql = "FROM app_users WHERE id = ? AND role = 'User' AND updated_at = ?";
  const audit = createSystemAuditStatement(env, {
    entityType: "user",
    entityId: user.id,
    entityReference: user.username,
    action: "permissions_update",
    actor,
    summary: "사용자 권한 변경",
    details: {
      before: { permissions: beforePermissions },
      after: { permissions: afterPermissions }
    }
  }, { guardSql, guardBinds: [user.id, expectedUpdatedAt] });
  const values = PERMISSION_KEYS.map((permission) => afterPermissions[permission] ? 1 : 0);
  const update = env.DB.prepare(`
    UPDATE app_users
    SET ${PERMISSION_KEYS.map((permission) => `${permission} = ?`).join(",\n        ")},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'User' AND updated_at = ?
  `).bind(...values, user.id, expectedUpdatedAt);
  const plan = createUserPermissionMutationPlan(audit, update, `app_users:${user.id}:${expectedUpdatedAt}`);
  const results = await env.DB.batch(plan.execution().statements);

  return changed(results[1])
    ? { ok: true }
    : { ok: false, message: "사용자 정보가 변경되었습니다. 새로고침 후 다시 시도하세요." };
}

async function transitionUserStatus(env, id, actor, spec) {
  const transition = transitionFor(spec.action);
  const user = await getAppUser(env, id);
  if (!canTransitionUser(user, spec.action)) {
    return { ok: false, message: "처리할 수 있는 사용자를 찾지 못했습니다." };
  }

  const placeholders = transition.from.map(() => "?").join(", ");
  const guardSql = `FROM app_users WHERE id = ? AND role = 'User' AND status IN (${placeholders})`;
  const guardBinds = [user.id, ...transition.from];
  const audit = createSystemAuditStatement(env, {
    entityType: "user",
    entityId: user.id,
    entityReference: user.username,
    action: spec.action,
    actor,
    summary: spec.summary,
    details: {
      before: userAuditSnapshot(user),
      after: { ...userAuditSnapshot(user), status: transition.to }
    }
  }, { guardSql, guardBinds });
  const update = env.DB.prepare(`
    UPDATE app_users
    SET ${spec.updateSql}
    WHERE id = ? AND role = 'User' AND status IN (${placeholders})
  `).bind(...(spec.updateBinds || []), user.id, ...transition.from);
  const plan = createUserStatusMutationPlan(spec.action, audit, update, `app_users:${user.id}:${transition.from.join("|")}`);
  const results = await env.DB.batch(plan.execution().statements);

  return changed(results[1])
    ? { ok: true }
    : { ok: false, message: "사용자 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
}

function userAuditSnapshot(user) {
  return {
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    permissions: permissionFlags(user)
  };
}

function changed(result) {
  return Number(result?.meta?.changes || 0) > 0;
}
