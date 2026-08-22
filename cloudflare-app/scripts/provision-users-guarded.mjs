#!/usr/bin/env node
/**
 * 승인된 일반 사용자(조회 권한) 일괄 등록.
 *
 * - 명단과 초기 비밀번호는 production Environment secret으로만 전달한다. 저장소·로그에 남기지 않는다.
 * - 기존 계정은 절대 덮어쓰지 않는다(INSERT ... WHERE NOT EXISTS). 팀 값만 최신 명단으로 맞춘다.
 * - 알려진 bootstrap/smoke 계정은 생성 대상에서 fail-closed로 제외한다.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createPasswordRecord } from "../src/auth/passwords.js";
import { validateNewPassword } from "../src/domains/identity/index.js";
import { preflightDeploy, runWranglerCaptured } from "./deploy-guarded.mjs";

export const PROTECTED_PROVISION_USERNAMES = new Set([
  "nkh92@hanlim.com",
  "release-smoke@hanlim.internal"
]);

const MAX_ROSTER_ENTRIES = 200;
const VIEWER_TEMPLATE_KEY = "viewer";
const PERMISSION_COLUMNS = [
  "can_manage_documents",
  "can_move_documents",
  "can_manage_disposals",
  "can_manage_sets",
  "can_manage_masters",
  "can_manage_users",
  "can_view_audit",
  "can_apply_document_snapshots"
];

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlTextOrNull(value) {
  return value ? sqlText(value) : "NULL";
}

export function parseRoster(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ""));
  } catch {
    return { ok: false, errors: ["USER_PROVISION_ROSTER는 JSON 배열이어야 합니다."] };
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    return { ok: false, errors: ["USER_PROVISION_ROSTER에 최소 1명이 필요합니다."] };
  }
  if (parsed.length > MAX_ROSTER_ENTRIES) {
    return { ok: false, errors: [`USER_PROVISION_ROSTER는 한 번에 ${MAX_ROSTER_ENTRIES}명까지 처리합니다.`] };
  }

  const errors = [];
  const seen = new Set();
  const entries = [];
  parsed.forEach((candidate, index) => {
    const position = index + 1;
    const username = String(candidate?.username || "").trim().toLowerCase();
    const displayName = String(candidate?.displayName || "").trim();
    const team = String(candidate?.team || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      errors.push(`${position}번 항목의 username이 유효한 이메일 형식이 아닙니다.`);
      return;
    }
    if (!displayName || displayName.length > 60) {
      errors.push(`${position}번 항목의 displayName은 1~60자여야 합니다.`);
      return;
    }
    if (team.length > 40) {
      errors.push(`${position}번 항목의 team은 40자 이하여야 합니다.`);
      return;
    }
    if (seen.has(username)) {
      errors.push(`${position}번 항목의 username이 중복됩니다.`);
      return;
    }
    seen.add(username);
    entries.push({ username, displayName, team, protected: PROTECTED_PROVISION_USERNAMES.has(username) });
  });

  if (errors.length) return { ok: false, errors };
  if (entries.every((entry) => entry.protected)) {
    return { ok: false, errors: ["생성 대상 사용자가 없습니다. 보호 계정만 포함되어 있습니다."] };
  }
  return { ok: true, entries };
}

export function preflightUserProvision({
  envName,
  expectedDatabaseId,
  roster,
  password,
  confirmation,
  operationId
} = {}) {
  const errors = [];
  const target = preflightDeploy({ envName, expectedDatabaseId, dryRun: true });
  if (!target.ok) errors.push(...target.errors);

  const parsedRoster = parseRoster(roster);
  if (!parsedRoster.ok) errors.push(...parsedRoster.errors);
  if (!validateNewPassword(password).ok) {
    errors.push("USER_PROVISION_PASSWORD는 비밀번호 정책(6자 이상)을 만족해야 합니다.");
  }
  const expectedConfirmation = `PROVISION-USERS:${envName}:${expectedDatabaseId}`;
  if (String(confirmation || "") !== expectedConfirmation) {
    errors.push("USER_PROVISION_CONFIRM이 대상 환경·DB와 일치하지 않습니다.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/i.test(String(operationId || ""))) {
    errors.push("USER_PROVISION_OPERATION_ID 형식이 올바르지 않습니다.");
  }

  return errors.length
    ? { ok: false, errors }
    : {
      ok: true,
      envName,
      expectedDatabaseId,
      entries: parsedRoster.entries,
      operationId: String(operationId)
    };
}

/**
 * 신규 계정은 조회 권한·최초 비밀번호 변경 강제로 생성하고, 이미 있는 계정은 팀 값만 맞춘다.
 * @param {{ entries: Array<{username: string, displayName: string, team: string, protected?: boolean}>,
 *   passwordRecords: Map<string, {salt: string, hash: string}>, provisioningActor: string }} input
 */
export function buildUserProvisionSql({ entries, passwordRecords, provisioningActor }) {
  const statements = [];
  for (const entry of entries) {
    if (!entry.protected) {
      const record = passwordRecords.get(entry.username);
      if (!record) throw new Error(`password record missing for ${entry.username}`);
      statements.push(`
    INSERT INTO app_users (
      username, display_name, team, password_salt, password_hash, status,
      approved_at, approved_by, role, role_template_key,
      must_change_password, security_review_required,
      ${PERMISSION_COLUMNS.join(", ")},
      updated_at
    )
    SELECT
      ${sqlText(entry.username)}, ${sqlText(entry.displayName)}, ${sqlTextOrNull(entry.team)},
      ${sqlText(record.salt)}, ${sqlText(record.hash)}, 'approved',
      CURRENT_TIMESTAMP, ${sqlText(provisioningActor)}, 'User', ${sqlText(VIEWER_TEMPLATE_KEY)},
      1, 0,
      ${PERMISSION_COLUMNS.map(() => "0").join(", ")},
      CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE username = ${sqlText(entry.username)});`);
    }
    if (entry.team) {
      // 이미 있는 계정(보호 계정 포함)은 credential·역할·권한을 건드리지 않고 팀만 맞춘다.
      statements.push(`
    UPDATE app_users
    SET team = ${sqlText(entry.team)}, updated_at = CURRENT_TIMESTAMP
    WHERE username = ${sqlText(entry.username)}
      AND (team IS NULL OR team <> ${sqlText(entry.team)});`);
    }
  }
  return `${statements.join("\n")}\n`;
}

export function userProvisionPrecheckSql({ entries, provisioningActor }) {
  const usernames = entries.map(({ username }) => sqlText(username)).join(", ");
  return `
    SELECT
      (SELECT COUNT(*) FROM app_users WHERE username IN (${usernames})) AS existing_count,
      (SELECT COUNT(*) FROM app_users WHERE approved_by = ${sqlText(provisioningActor)}) AS marker_count
  `;
}

export function userProvisionVerificationSql({ entries, provisioningActor }) {
  const usernames = entries.map(({ username }) => sqlText(username)).join(", ");
  return `
    SELECT
      (SELECT COUNT(*) FROM app_users WHERE username IN (${usernames})) AS present_count,
      (SELECT COUNT(*) FROM app_users WHERE approved_by = ${sqlText(provisioningActor)}) AS marker_count,
      (
        SELECT COUNT(*) FROM app_users
        WHERE approved_by = ${sqlText(provisioningActor)}
          AND status = 'approved'
          AND role = 'User'
          AND security_review_required = 0
          AND must_change_password = 1
          AND role_template_key = ${sqlText(VIEWER_TEMPLATE_KEY)}
          AND ${PERMISSION_COLUMNS.map((column) => `${column} = 0`).join("\n          AND ")}
      ) AS ready_count
  `;
}

export function userProvisionCleanupSql({ provisioningActor }) {
  return `
    DELETE FROM app_users WHERE approved_by = ${sqlText(provisioningActor)};
    SELECT changes() AS removed;
    SELECT COUNT(*) AS remaining FROM app_users WHERE approved_by = ${sqlText(provisioningActor)};
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

export async function runUserProvision({ execPath = process.execPath, spawn = spawnSync } = {}) {
  const checked = preflightUserProvision({
    envName: process.env.D1_PROVISION_ENV || process.env.CLOUDFLARE_ENV,
    expectedDatabaseId: process.env.D1_TARGET_DATABASE_ID,
    roster: process.env.USER_PROVISION_ROSTER,
    password: process.env.USER_PROVISION_PASSWORD,
    confirmation: process.env.USER_PROVISION_CONFIRM,
    operationId: process.env.USER_PROVISION_OPERATION_ID
  });
  if (!checked.ok) return checked;

  const provisioningActor = `guarded-user-provisioning:${checked.operationId}`;
  const creatable = checked.entries.filter((entry) => !entry.protected);
  const passwordRecords = new Map();
  for (const entry of creatable) {
    passwordRecords.set(entry.username, await createPasswordRecord(process.env.USER_PROVISION_PASSWORD));
  }

  const directory = mkdtempSync(path.join(tmpdir(), "hanlim-user-provision-"));
  const sqlPath = path.join(directory, "provision-users.sql");
  const appRoot = path.resolve(import.meta.dirname, "..");
  let mutationStarted = false;

  const recover = (reason) => {
    try {
      const cleaned = runWranglerCaptured({
        appRoot,
        execPath,
        spawn,
        args: [
          "d1", "execute", checked.expectedDatabaseId,
          "--remote", "--env", checked.envName,
          "--command", userProvisionCleanupSql({ provisioningActor }),
          "--json"
        ]
      });
      if (cleaned.status !== 0) throw new Error("cleanup command failed");
      const payload = JSON.parse(cleaned.stdout || "[]");
      if (resultCount(payload, "remaining") !== 0) throw new Error("cleanup result is ambiguous");
      return {
        ok: false,
        rolledBack: true,
        errors: [`${reason} 이번 작업이 만든 계정은 원격에서 보상 정리되었습니다.`]
      };
    } catch {
      return {
        ok: false,
        remoteStateUnknown: true,
        recovery: { operationId: checked.operationId },
        errors: [
          `${reason} 원격 상태가 불확정합니다. approved_by = '${provisioningActor}'로 조회한 뒤 같은 OPERATION_ID로 재시도하세요.`
        ]
      };
    }
  };

  try {
    writeFileSync(sqlPath, buildUserProvisionSql({
      entries: checked.entries,
      passwordRecords,
      provisioningActor
    }), { encoding: "utf8", mode: 0o600 });

    const prechecked = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", checked.expectedDatabaseId,
        "--remote", "--env", checked.envName,
        "--command", userProvisionPrecheckSql({ entries: checked.entries, provisioningActor }),
        "--json"
      ]
    });
    if (prechecked.status !== 0) {
      return { ok: false, errors: ["원격 D1 사용자 provisioning 사전 조회에 실패했습니다."] };
    }
    const precheckPayload = JSON.parse(prechecked.stdout || "[]");
    const existingBefore = resultCount(precheckPayload, "existing_count");
    const markerBefore = resultCount(precheckPayload, "marker_count");
    if (![existingBefore, markerBefore].every(Number.isInteger)) {
      return { ok: false, errors: ["원격 D1 사용자 provisioning 사전 조회 결과를 확인할 수 없습니다."] };
    }

    mutationStarted = true;
    const executed = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", checked.expectedDatabaseId,
        "--remote", "--env", checked.envName, "--file", sqlPath, "--json"
      ]
    });
    if (executed.status !== 0) return recover("원격 D1 사용자 provisioning 실행에 실패했습니다.");

    const verified = runWranglerCaptured({
      appRoot,
      execPath,
      spawn,
      args: [
        "d1", "execute", checked.expectedDatabaseId,
        "--remote", "--env", checked.envName,
        "--command", userProvisionVerificationSql({ entries: checked.entries, provisioningActor }),
        "--json"
      ]
    });
    if (verified.status !== 0) return recover("원격 D1 사용자 provisioning 검증에 실패했습니다.");
    const verifyPayload = JSON.parse(verified.stdout || "[]");
    const present = resultCount(verifyPayload, "present_count");
    const marker = resultCount(verifyPayload, "marker_count");
    const ready = resultCount(verifyPayload, "ready_count");
    if (![present, marker, ready].every(Number.isInteger)) {
      return recover("원격 D1 사용자 provisioning 검증 결과를 확인할 수 없습니다.");
    }
    // 모든 명단 계정이 존재하고, 이번 작업이 만든 계정은 전부 조회 권한 형태여야 한다.
    if (present !== checked.entries.length || marker !== ready) {
      return recover("원격 D1 사용자 provisioning 결과가 명단과 일치하지 않습니다.");
    }

    return {
      ok: true,
      envName: checked.envName,
      rosterCount: checked.entries.length,
      created: Math.max(0, present - existingBefore),
      alreadyPresent: existingBefore,
      operationTotal: marker
    };
  } catch {
    if (mutationStarted) return recover("사용자 provisioning 결과를 확인할 수 없습니다.");
    return { ok: false, errors: ["사용자 provisioning 결과를 확인할 수 없습니다."] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runUserProvision();
  if (!result.ok) {
    if (result.remoteStateUnknown && result.recovery) {
      console.error(JSON.stringify({ action: "user-provision-recovery", ...result.recovery }));
    }
    for (const error of result.errors || []) console.error(`[users:provision] ${error}`);
    process.exit(1);
  }
  // 개인정보는 출력하지 않고 건수만 증적으로 남긴다.
  console.log(JSON.stringify({
    action: "user-provision",
    env: result.envName,
    roster: result.rosterCount,
    created: result.created,
    alreadyPresent: result.alreadyPresent,
    operationTotal: result.operationTotal
  }));
}
