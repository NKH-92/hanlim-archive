#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createPasswordRecord } from "../src/auth/passwords.js";
import { validateNewPassword } from "../src/domains/identity/index.js";
import { preflightDeploy, runWranglerCaptured } from "./deploy-guarded.mjs";

const DENIED_USERNAMES = new Set(["nkh92@hanlim.com", "release-smoke@hanlim.internal"]);

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function preflightAdminProvision({ envName, expectedDatabaseId, username, displayName, password, confirmation } = {}) {
  const errors = [];
  const target = preflightDeploy({ envName, expectedDatabaseId, dryRun: true });
  if (!target.ok) errors.push(...target.errors);
  const normalizedUsername = String(username || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedUsername)) errors.push("ADMIN_PROVISION_USERNAME은 유효한 이메일 형식이어야 합니다.");
  if (DENIED_USERNAMES.has(normalizedUsername)) errors.push("알려진 bootstrap/smoke 사용자명은 Admin provisioning에 사용할 수 없습니다.");
  if (!String(displayName || "").trim()) errors.push("ADMIN_PROVISION_DISPLAY_NAME이 필요합니다.");
  if (!validateNewPassword(password).ok) errors.push("ADMIN_PROVISION_PASSWORD는 6자 이상이어야 합니다.");
  const expectedConfirmation = `PROVISION:${envName}:${expectedDatabaseId}`;
  if (String(confirmation || "") !== expectedConfirmation) errors.push("ADMIN_PROVISION_CONFIRM이 대상 환경·DB와 일치하지 않습니다.");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, envName, expectedDatabaseId, username: normalizedUsername, displayName: String(displayName).trim() };
}

export function buildAdminProvisionSql({
  username,
  displayName,
  passwordRecord,
  provisioningActor = "guarded-provisioning"
}) {
  return `
    INSERT INTO app_users (
      username, display_name, password_salt, password_hash, status,
      approved_at, approved_by, role,
      can_manage_documents, can_move_documents, can_manage_disposals,
      can_manage_sets, can_manage_masters, can_manage_users, can_view_audit,
      updated_at
    )
    SELECT
      ${sqlText(username)}, ${sqlText(displayName)}, ${sqlText(passwordRecord.salt)}, ${sqlText(passwordRecord.hash)}, 'approved',
      CURRENT_TIMESTAMP, ${sqlText(provisioningActor)}, 'Admin',
      1, 1, 1, 1, 1, 1, 1, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE username = ${sqlText(username)});
    SELECT changes() AS provisioned;
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

function adminProvisionPrecheckSql({ username, provisioningActor }) {
  return `
    SELECT
      COALESCE(SUM(CASE WHEN username = ${sqlText(username)} THEN 1 ELSE 0 END), 0) AS username_count,
      COALESCE(SUM(CASE WHEN approved_by = ${sqlText(provisioningActor)} THEN 1 ELSE 0 END), 0) AS marker_count,
      COALESCE(SUM(CASE
        WHEN username = ${sqlText(username)}
          AND approved_by = ${sqlText(provisioningActor)}
          AND status = 'approved'
          AND role = 'Admin'
          AND can_manage_users = 1
        THEN 1 ELSE 0 END), 0) AS ready_count
    FROM app_users
    WHERE username = ${sqlText(username)}
       OR approved_by = ${sqlText(provisioningActor)}
  `;
}

function adminProvisionVerificationSql({ username, provisioningActor }) {
  return `
    SELECT COUNT(*) AS provisioned
    FROM app_users
    WHERE username = ${sqlText(username)}
      AND approved_by = ${sqlText(provisioningActor)}
      AND status = 'approved'
      AND role = 'Admin'
      AND can_manage_users = 1
  `;
}

function adminProvisionCleanupSql({ username, provisioningActor }) {
  return `
    DELETE FROM app_users
    WHERE username = ${sqlText(username)}
      AND approved_by = ${sqlText(provisioningActor)};
    SELECT changes() AS removed;
    SELECT COUNT(*) AS remaining
    FROM app_users
    WHERE username = ${sqlText(username)}
      AND approved_by = ${sqlText(provisioningActor)};
  `;
}

export async function runAdminProvision({
  execPath = process.execPath,
  spawn = spawnSync
} = {}) {
  const values = {
    envName: process.env.D1_PROVISION_ENV || process.env.CLOUDFLARE_ENV,
    expectedDatabaseId: process.env.D1_TARGET_DATABASE_ID,
    username: process.env.ADMIN_PROVISION_USERNAME,
    displayName: process.env.ADMIN_PROVISION_DISPLAY_NAME,
    password: process.env.ADMIN_PROVISION_PASSWORD,
    confirmation: process.env.ADMIN_PROVISION_CONFIRM
  };
  const checked = preflightAdminProvision(values);
  if (!checked.ok) return checked;
  const operationId = String(process.env.ADMIN_PROVISION_OPERATION_ID || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/i.test(operationId)) {
    return { ok: false, errors: ["ADMIN_PROVISION_OPERATION_ID 형식이 올바르지 않습니다."] };
  }
  const passwordRecord = await createPasswordRecord(values.password);
  const provisioningActor = `guarded-provisioning:${operationId}`;
  const directory = mkdtempSync(path.join(tmpdir(), "hanlim-admin-provision-"));
  const sqlPath = path.join(directory, "provision.sql");
  let appRoot;
  let mutationStarted = false;
  const recoverProvision = (reason) => {
    try {
      const cleaned = runWranglerCaptured({
        appRoot,
        execPath,
        spawn,
        args: [
          "d1", "execute", "hanlim-archive",
          "--remote", "--env", checked.envName,
          "--command", adminProvisionCleanupSql({ username: checked.username, provisioningActor }),
          "--json"
        ]
      });
      if (cleaned.status !== 0) throw new Error("cleanup command failed");
      const cleanupPayload = JSON.parse(cleaned.stdout || "[]");
      const removed = resultCount(cleanupPayload, "removed");
      const remaining = resultCount(cleanupPayload, "remaining");
      if (![0, 1].includes(removed) || remaining !== 0) throw new Error("cleanup result is ambiguous");
      return {
        ok: false,
        rolledBack: true,
        errors: [`${reason} 생성 시도는 원격에서 보상 정리되었습니다.`]
      };
    } catch {
      return {
        ok: false,
        remoteStateUnknown: true,
        recovery: { username: checked.username, operationId },
        errors: [
          `${reason} 원격 상태가 불확정합니다. 같은 ADMIN_PROVISION_USERNAME과 ADMIN_PROVISION_OPERATION_ID로 조회하거나 재시도하세요.`
        ]
      };
    }
  };
  try {
    writeFileSync(sqlPath, buildAdminProvisionSql({ ...checked, passwordRecord, provisioningActor }), {
      encoding: "utf8",
      mode: 0o600
    });
    appRoot = path.resolve(import.meta.dirname, "..");
    const prechecked = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", "hanlim-archive",
        "--remote", "--env", checked.envName,
        "--command", adminProvisionPrecheckSql({ username: checked.username, provisioningActor }),
        "--json"
      ]
    });
    if (prechecked.status !== 0) {
      return { ok: false, errors: ["원격 D1 Admin provisioning 사전 조회에 실패했습니다."] };
    }
    const precheckPayload = JSON.parse(prechecked.stdout || "[]");
    const usernameCount = resultCount(precheckPayload, "username_count");
    const markerCount = resultCount(precheckPayload, "marker_count");
    const readyCount = resultCount(precheckPayload, "ready_count");
    if (![usernameCount, markerCount, readyCount].every(Number.isInteger)) {
      return { ok: false, errors: ["원격 D1 Admin provisioning 사전 조회 결과를 확인할 수 없습니다."] };
    }
    if (usernameCount === 1 && markerCount === 1 && readyCount === 1) {
      return { ok: true, envName: checked.envName, provisioned: 1, idempotent: true };
    }
    if (markerCount > 0) {
      return { ok: false, errors: ["ADMIN_PROVISION_OPERATION_ID가 다른 사용자 또는 준비되지 않은 계정에 이미 연결되어 있습니다."] };
    }
    if (usernameCount > 0) {
      return { ok: false, errors: ["동일 사용자명이 이미 있어 권한이나 비밀번호를 변경하지 않았습니다. 다른 독립 사용자명을 사용하세요."] };
    }

    mutationStarted = true;
    const executed = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", "hanlim-archive",
        "--remote", "--env", checked.envName, "--file", sqlPath, "--json"
      ]
    });
    if (executed.status !== 0) return recoverProvision("원격 D1 Admin provisioning 실행에 실패했습니다.");
    const verified = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", "hanlim-archive",
        "--remote", "--env", checked.envName,
        "--command", adminProvisionVerificationSql({ username: checked.username, provisioningActor }),
        "--json"
      ]
    });
    if (verified.status !== 0) return recoverProvision("원격 D1 Admin provisioning 검증에 실패했습니다.");
    const count = resultCount(JSON.parse(verified.stdout || "[]"), "provisioned");
    if (count !== 1) return recoverProvision("원격 D1 Admin provisioning 결과가 일치하지 않습니다.");
    return { ok: true, envName: checked.envName, provisioned: count };
  } catch {
    if (mutationStarted && appRoot) return recoverProvision("Admin provisioning 결과를 확인할 수 없습니다.");
    return { ok: false, errors: ["Admin provisioning 결과를 확인할 수 없습니다."] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runAdminProvision();
  if (!result.ok) {
    if (result.remoteStateUnknown && result.recovery) {
      console.error(JSON.stringify({ action: "admin-provision-recovery", ...result.recovery }));
    }
    for (const error of result.errors || []) console.error(`[admin:provision] ${error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ action: "admin-provision", env: result.envName, provisioned: result.provisioned }));
}
