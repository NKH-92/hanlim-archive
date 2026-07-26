import { createPasswordRecord } from "../../../auth/passwords.js";
import { permissionFlags, PERMISSION_KEYS } from "../../../permissions.js";
import { createSystemAuditStatement } from "../../audit/index.js";
import { actorUsername } from "../domain/actor.js";
import { validateNewPassword } from "../domain/passwordPolicy.js";
import { canTransitionUser, transitionFor } from "../domain/userState.js";
import {
  createUserPasswordResetMutationPlan,
  createUserPermissionMutationPlan,
  createUserStatusMutationPlan
} from "./userMutationPlans.js";
import { executeMutationBatch } from "../../../platform/d1/requestGateway.js";

// app_users.row_version은 역할·권한 화면이 OCC로 사용하는 값이다. 권한 판단 근거를 바꾸는
// 상태·역할·템플릿·권한 변경은 증가시키고 credential/session_epoch 전용 변경은 증가시키지 않는다.
const USER_PERMISSION_COLUMNS = PERMISSION_KEYS.join(", ");
const MATCHED_ROLE_TEMPLATE_LABEL = `(
  SELECT label
  FROM user_role_templates
  WHERE key = app_users.role_template_key
    AND ${PERMISSION_KEYS.map((permission) => (
      `user_role_templates.${permission} = app_users.${permission}`
    )).join("\n    AND ")}
)`;

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
      must_change_password,
      security_review_required,
      session_epoch,
      team,
      role_template_key,
      row_version,
      ${MATCHED_ROLE_TEMPLATE_LABEL} AS role_template_label,
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
      must_change_password,
      security_review_required,
      session_epoch,
      team,
      role_template_key,
      row_version,
      ${MATCHED_ROLE_TEMPLATE_LABEL} AS role_template_label,
      updated_at,
      ${USER_PERMISSION_COLUMNS}
    FROM app_users
    WHERE id = ?
  `).bind(id).first();
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
      row_version = row_version + 1,
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
      row_version = row_version + 1,
      updated_at = CURRENT_TIMESTAMP
    `,
    updateBinds: [actorUsername(actor)]
  });
}

export async function disableUser(env, id, actor) {
  return transitionUserStatus(env, id, actor, {
    action: "disable",
    summary: "사용자 사용중지",
    updateSql: "status = 'disabled', session_epoch = session_epoch + 1, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP"
  });
}

export async function enableUser(env, id, actor) {
  return transitionUserStatus(env, id, actor, {
    action: "enable",
    summary: "사용자 다시 사용",
    updateSql: "status = 'approved', session_epoch = session_epoch + 1, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP"
  });
}

export async function updateUserPermissions(env, id, values, actor) {
  const user = await getAppUser(env, id);
  const expectedRowVersion = Number(values?.expectedRowVersion);
  if (
    !user
    || user.role !== "User"
    || Number(user.security_review_required || 0) === 1
    || !Number.isSafeInteger(expectedRowVersion)
    || expectedRowVersion < 1
  ) {
    return { ok: false, message: "권한을 변경할 사용자를 찾을 수 없습니다." };
  }
  if (Number(user.row_version) !== expectedRowVersion) {
    return { ok: false, stale: true, message: "사용자 정보가 변경되었습니다. 새로고침 후 다시 시도하세요." };
  }

  const beforePermissions = permissionFlags(user);
  const afterPermissions = permissionFlags(values?.permissions);
  const beforeRoleTemplateKey = user.role_template_key || null;
  const roleTemplateKey = /^[a-z0-9_]{1,40}$/.test(String(values?.roleTemplateKey || ""))
    ? String(values.roleTemplateKey)
    : null;
  if (
    beforeRoleTemplateKey === roleTemplateKey
    && PERMISSION_KEYS.every((permission) => beforePermissions[permission] === afterPermissions[permission])
  ) {
    return { ok: true, unchanged: true };
  }

  const guardSql = "FROM app_users WHERE id = ? AND role = 'User' AND security_review_required = 0 AND row_version = ?";
  const guardBinds = [user.id, expectedRowVersion];
  const audit = createSystemAuditStatement(env, {
    entityType: "user",
    entityId: user.id,
    entityReference: user.username,
    action: "permissions_update",
    actor,
    summary: "사용자 역할·권한 변경",
    details: {
      before: {
        roleTemplateKey: beforeRoleTemplateKey,
        permissions: beforePermissions,
        rowVersion: expectedRowVersion
      },
      after: {
        roleTemplateKey,
        permissions: afterPermissions,
        rowVersion: expectedRowVersion + 1
      }
    }
  }, { guardSql, guardBinds });
  const valuesToBind = PERMISSION_KEYS.map((permission) => afterPermissions[permission] ? 1 : 0);
  const update = env.DB.prepare(`
    UPDATE app_users
    SET role_template_key = ?,
        ${PERMISSION_KEYS.map((permission) => `${permission} = ?`).join(",\n        ")},
        row_version = row_version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role = 'User' AND security_review_required = 0 AND row_version = ?
  `).bind(roleTemplateKey, ...valuesToBind, user.id, expectedRowVersion);
  const plan = createUserPermissionMutationPlan(audit, update, `app_users:${user.id}:${expectedRowVersion}`);

  try {
    await executeMutationBatch(env, plan);
    return { ok: true };
  } catch (error) {
    if (error?.code === "STALE_VERSION") {
      return { ok: false, stale: true, message: "사용자 정보가 변경되었습니다. 새로고침 후 다시 시도하세요." };
    }
    throw error;
  }
}

export async function resetUserPassword(env, id, temporaryPassword, actor) {
  if (actor?.role !== "Admin") {
    return { ok: false, message: "비밀번호 초기화는 시스템 관리자만 수행할 수 있습니다." };
  }

  const user = await getAppUser(env, id);
  if (
    !user
    || !["approved", "disabled"].includes(user.status)
    || Number(user.security_review_required || 0) === 1
  ) {
    return { ok: false, message: "비밀번호를 초기화할 사용자를 찾을 수 없습니다." };
  }
  if (Number(user.id) === Number(actor.userId) || user.username === actor.username) {
    return { ok: false, message: "현재 로그인한 계정은 비밀번호 변경 화면을 이용하세요." };
  }

  const passwordValidation = validateNewPassword(temporaryPassword, { label: "임시 비밀번호" });
  if (!passwordValidation.ok) return passwordValidation;

  const passwordRecord = await createPasswordRecord(temporaryPassword);
  const currentSessionEpoch = Number(user.session_epoch || 0);
  const nextSessionEpoch = currentSessionEpoch + 1;
  const guardSql = `
    FROM app_users
    WHERE id = ?
      AND username = ?
      AND status IN ('approved', 'disabled')
      AND security_review_required = 0
      AND session_epoch = ?
  `;
  const guardBinds = [user.id, user.username, currentSessionEpoch];
  const audit = createSystemAuditStatement(env, {
    entityType: "user",
    entityId: user.id,
    entityReference: user.username,
    action: "password_reset",
    actor,
    summary: "사용자 비밀번호 초기화",
    details: {
      before: {
        status: user.status,
        role: user.role,
        mustChangePassword: Number(user.must_change_password || 0) === 1,
        sessionEpoch: currentSessionEpoch
      },
      after: {
        status: user.status,
        role: user.role,
        mustChangePassword: true,
        sessionEpoch: nextSessionEpoch
      }
    }
  }, { guardSql, guardBinds });
  const clearThrottle = env.DB.prepare(`
    DELETE FROM login_throttle
    WHERE username = ?
       OR substr(username, 1, length(?) + 1) = ? || '|'
  `).bind(user.username, user.username, user.username);
  const update = env.DB.prepare(`
    UPDATE app_users
    SET password_salt = ?,
        password_hash = ?,
        must_change_password = 1,
        session_epoch = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND username = ?
      AND status IN ('approved', 'disabled')
      AND security_review_required = 0
      AND session_epoch = ?
  `).bind(
    passwordRecord.salt,
    passwordRecord.hash,
    nextSessionEpoch,
    user.id,
    user.username,
    currentSessionEpoch
  );
  const plan = createUserPasswordResetMutationPlan(
    audit,
    clearThrottle,
    update,
    `app_users:${user.id}:password:${currentSessionEpoch}`
  );
  const results = await executeMutationBatch(env, plan);

  return changed(results[2])
    ? { ok: true }
    : { ok: false, message: "사용자 인증 상태가 변경되었습니다. 새로고침 후 다시 시도하세요." };
}

async function transitionUserStatus(env, id, actor, spec) {
  const transition = transitionFor(spec.action);
  const user = await getAppUser(env, id);
  if (!canTransitionUser(user, spec.action)) {
    return { ok: false, message: "처리할 수 있는 사용자를 찾지 못했습니다." };
  }

  const placeholders = transition.from.map(() => "?").join(", ");
  const guardSql = `FROM app_users WHERE id = ? AND role = 'User' AND security_review_required = 0 AND status IN (${placeholders})`;
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
    WHERE id = ? AND role = 'User' AND security_review_required = 0 AND status IN (${placeholders})
  `).bind(...(spec.updateBinds || []), user.id, ...transition.from);
  const plan = createUserStatusMutationPlan(spec.action, audit, update, `app_users:${user.id}:${transition.from.join("|")}`);
  const results = await executeMutationBatch(env, plan);

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
