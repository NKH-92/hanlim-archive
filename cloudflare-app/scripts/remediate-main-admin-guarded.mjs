#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createPasswordRecord } from "../src/auth/passwords.js";
import { preflightDeploy, runWranglerCaptured } from "./deploy-guarded.mjs";

export const MAIN_ADMIN_USERNAME = "nkh92@hanlim.com";
const MAIN_ADMIN_DISPLAY_NAME = "메인 관리자";
const MINIMUM_FORCED_CHANGE_PASSWORD_LENGTH = 6;
const MAXIMUM_PASSWORD_LENGTH = 128;

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function preflightMainAdminRemediation({
  envName,
  expectedDatabaseId,
  password,
  confirmation
} = {}) {
  const errors = [];
  const target = preflightDeploy({ envName, expectedDatabaseId, dryRun: true });
  if (!target.ok) errors.push(...target.errors);
  if (envName !== "production") {
    errors.push("메인 관리자 보안 복구는 production Environment에서만 실행할 수 있습니다.");
  }
  const passwordLength = String(password || "").length;
  if (
    passwordLength < MINIMUM_FORCED_CHANGE_PASSWORD_LENGTH
    || passwordLength > MAXIMUM_PASSWORD_LENGTH
  ) {
    errors.push(
      `MAIN_ADMIN_REMEDIATION_PASSWORD는 ${MINIMUM_FORCED_CHANGE_PASSWORD_LENGTH}~${MAXIMUM_PASSWORD_LENGTH}자여야 합니다.`
    );
  }
  const expectedConfirmation = `REMEDIATE-MAIN-ADMIN:${envName}:${expectedDatabaseId}:${MAIN_ADMIN_USERNAME}`;
  if (String(confirmation || "") !== expectedConfirmation) {
    errors.push("MAIN_ADMIN_REMEDIATION_CONFIRM이 대상 환경·DB·계정과 일치하지 않습니다.");
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, envName, expectedDatabaseId, username: MAIN_ADMIN_USERNAME };
}

export function buildMainAdminRemediationSql({ passwordRecord, operationId }) {
  const actor = `security-remediation:${operationId}`;
  return `
    INSERT INTO identity_security_remediations (
      operation_id,
      target_username,
      requested_by,
      reason
    )
    VALUES (
      ${sqlText(operationId)},
      ${sqlText(MAIN_ADMIN_USERNAME)},
      'github-production-environment',
      'Restore quarantined main administrator with a new forced-change credential'
    )
    ON CONFLICT(operation_id) DO NOTHING;

    UPDATE app_users
    SET
      display_name = ${sqlText(MAIN_ADMIN_DISPLAY_NAME)},
      password_salt = ${sqlText(passwordRecord.salt)},
      password_hash = ${sqlText(passwordRecord.hash)},
      status = 'approved',
      approved_at = CURRENT_TIMESTAMP,
      approved_by = ${sqlText(actor)},
      rejected_at = NULL,
      rejected_by = NULL,
      role = 'Admin',
      can_manage_documents = 1,
      can_move_documents = 1,
      can_manage_disposals = 1,
      can_manage_sets = 1,
      can_manage_masters = 1,
      can_manage_users = 1,
      can_view_audit = 1,
      can_apply_document_snapshots = 1,
      must_change_password = 1,
      security_review_required = 0,
      session_epoch = session_epoch + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE username = ${sqlText(MAIN_ADMIN_USERNAME)}
      AND status = 'rejected'
      AND role = 'User'
      AND rejected_by = 'system-bootstrap-quarantine'
      AND security_review_required = 1
      AND EXISTS (
        SELECT 1
        FROM identity_security_remediations
        WHERE operation_id = ${sqlText(operationId)}
          AND target_username = ${sqlText(MAIN_ADMIN_USERNAME)}
          AND requested_by = 'github-production-environment'
      );
  `;
}

function resultRows(payload) {
  const executions = Array.isArray(payload) ? payload : [payload];
  return executions.flatMap((execution) => execution?.results || execution?.result?.results || []);
}

function resultCount(payload, field) {
  const row = resultRows(payload).findLast((candidate) => Object.hasOwn(candidate || {}, field));
  return Number(row?.[field]);
}

function mainAdminPrecheckSql(operationId) {
  return `
    SELECT
      COUNT(*) AS username_count,
      COALESCE(SUM(CASE
        WHEN status = 'rejected'
          AND role = 'User'
          AND rejected_by = 'system-bootstrap-quarantine'
          AND security_review_required = 1
        THEN 1 ELSE 0 END), 0) AS quarantined_count,
      COALESCE(SUM(CASE
        WHEN status = 'approved'
          AND role = 'Admin'
          AND security_review_required = 0
          AND can_manage_documents = 1
          AND can_move_documents = 1
          AND can_manage_disposals = 1
          AND can_manage_sets = 1
          AND can_manage_masters = 1
          AND can_manage_users = 1
          AND can_view_audit = 1
          AND can_apply_document_snapshots = 1
          AND approved_by LIKE 'security-remediation:%'
        THEN 1 ELSE 0 END), 0) AS ready_count,
      (
        SELECT COUNT(*)
        FROM identity_security_remediations
        WHERE operation_id = ${sqlText(operationId)}
          AND target_username = ${sqlText(MAIN_ADMIN_USERNAME)}
      ) AS authorization_count
    FROM app_users
    WHERE username = ${sqlText(MAIN_ADMIN_USERNAME)}
  `;
}

function mainAdminVerificationSql(operationId) {
  return `
    SELECT COUNT(*) AS remediated
    FROM app_users
    WHERE username = ${sqlText(MAIN_ADMIN_USERNAME)}
      AND status = 'approved'
      AND role = 'Admin'
      AND security_review_required = 0
      AND can_manage_documents = 1
      AND can_move_documents = 1
      AND can_manage_disposals = 1
      AND can_manage_sets = 1
      AND can_manage_masters = 1
      AND can_manage_users = 1
      AND can_view_audit = 1
      AND can_apply_document_snapshots = 1
      AND approved_by = ${sqlText(`security-remediation:${operationId}`)}
  `;
}

export async function runMainAdminRemediation({
  execPath = process.execPath,
  spawn = spawnSync
} = {}) {
  const values = {
    envName: process.env.D1_MAIN_ADMIN_REMEDIATION_ENV || process.env.CLOUDFLARE_ENV,
    expectedDatabaseId: process.env.D1_TARGET_DATABASE_ID,
    password: process.env.MAIN_ADMIN_REMEDIATION_PASSWORD,
    confirmation: process.env.MAIN_ADMIN_REMEDIATION_CONFIRM
  };
  const checked = preflightMainAdminRemediation(values);
  if (!checked.ok) return checked;

  const operationId = String(process.env.MAIN_ADMIN_REMEDIATION_OPERATION_ID || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/i.test(operationId)) {
    return { ok: false, errors: ["MAIN_ADMIN_REMEDIATION_OPERATION_ID 형식이 올바르지 않습니다."] };
  }

  const appRoot = path.resolve(import.meta.dirname, "..");
  const directory = mkdtempSync(path.join(tmpdir(), "hanlim-main-admin-remediation-"));
  const sqlPath = path.join(directory, "remediate.sql");
  try {
    const prechecked = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", "hanlim-archive",
        "--remote", "--env", checked.envName,
        "--command", mainAdminPrecheckSql(operationId),
        "--json"
      ]
    });
    if (prechecked.status !== 0) {
      return {
        ok: false,
        errors: ["원격 D1 메인 관리자 사전 조회에 실패했습니다. 0039 migration 적용 여부를 확인하세요."]
      };
    }
    const payload = JSON.parse(prechecked.stdout || "[]");
    const usernameCount = resultCount(payload, "username_count");
    const quarantinedCount = resultCount(payload, "quarantined_count");
    const readyCount = resultCount(payload, "ready_count");
    const authorizationCount = resultCount(payload, "authorization_count");
    if (![usernameCount, quarantinedCount, readyCount, authorizationCount].every(Number.isInteger)) {
      return { ok: false, errors: ["원격 D1 메인 관리자 사전 조회 결과를 확인할 수 없습니다."] };
    }
    if (usernameCount === 1 && readyCount === 1) {
      return { ok: true, envName: checked.envName, remediated: 1, idempotent: true };
    }
    if (usernameCount !== 1 || quarantinedCount !== 1) {
      return {
        ok: false,
        errors: ["메인 관리자 계정이 알려진 quarantine 상태와 일치하지 않아 자동 복구하지 않았습니다."]
      };
    }
    if (authorizationCount > 1) {
      return { ok: false, errors: ["보안 복구 authorization 상태가 모호하여 실행하지 않았습니다."] };
    }

    const passwordRecord = await createPasswordRecord(values.password);
    writeFileSync(sqlPath, buildMainAdminRemediationSql({ passwordRecord, operationId }), {
      encoding: "utf8",
      mode: 0o600
    });
    const executed = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", "hanlim-archive",
        "--remote", "--env", checked.envName,
        "--file", sqlPath,
        "--json"
      ]
    });
    if (executed.status !== 0) {
      return {
        ok: false,
        remoteStateUnknown: true,
        recovery: { operationId },
        errors: ["메인 관리자 보안 복구 실행 결과가 불확정합니다. 같은 workflow run을 재실행하세요."]
      };
    }

    const verified = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", "hanlim-archive",
        "--remote", "--env", checked.envName,
        "--command", mainAdminVerificationSql(operationId),
        "--json"
      ]
    });
    if (verified.status !== 0) {
      return {
        ok: false,
        remoteStateUnknown: true,
        recovery: { operationId },
        errors: ["메인 관리자 보안 복구 검증 결과가 불확정합니다. 같은 workflow run을 재실행하세요."]
      };
    }
    const count = resultCount(JSON.parse(verified.stdout || "[]"), "remediated");
    if (count !== 1) {
      return {
        ok: false,
        remoteStateUnknown: true,
        recovery: { operationId },
        errors: ["메인 관리자 보안 복구 결과가 일치하지 않습니다. 같은 workflow run을 재실행하세요."]
      };
    }
    return { ok: true, envName: checked.envName, remediated: count };
  } catch {
    return {
      ok: false,
      remoteStateUnknown: true,
      recovery: { operationId },
      errors: ["메인 관리자 보안 복구 결과를 확인할 수 없습니다. 같은 workflow run을 재실행하세요."]
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runMainAdminRemediation();
  if (!result.ok) {
    if (result.remoteStateUnknown && result.recovery) {
      console.error(JSON.stringify({ action: "main-admin-remediation-recovery", ...result.recovery }));
    }
    for (const error of result.errors || []) console.error(`[main-admin:remediate] ${error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    action: "main-admin-remediation",
    env: result.envName,
    remediated: result.remediated,
    idempotent: Boolean(result.idempotent)
  }));
}
