#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createPasswordRecord } from "../src/auth/passwords.js";
import { validateNewPassword } from "../src/domains/identity/index.js";
import { preflightDeploy } from "./deploy-guarded.mjs";

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
  if (String(password || "").length < 16 || !validateNewPassword(password).ok) errors.push("ADMIN_PROVISION_PASSWORD는 16자 이상이어야 합니다.");
  const expectedConfirmation = `PROVISION:${envName}:${expectedDatabaseId}`;
  if (String(confirmation || "") !== expectedConfirmation) errors.push("ADMIN_PROVISION_CONFIRM이 대상 환경·DB와 일치하지 않습니다.");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, envName, expectedDatabaseId, username: normalizedUsername, displayName: String(displayName).trim() };
}

export function buildAdminProvisionSql({ username, displayName, passwordRecord }) {
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
      CURRENT_TIMESTAMP, 'guarded-provisioning', 'Admin',
      1, 1, 1, 1, 1, 1, 1, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE username = ${sqlText(username)});
    SELECT changes() AS provisioned;
  `;
}

function provisionedCount(payload) {
  const executions = Array.isArray(payload) ? payload : [payload];
  const rows = executions.flatMap((execution) => execution?.results || execution?.result?.results || []);
  return Number(rows.at(-1)?.provisioned || 0);
}

export async function runAdminProvision({ spawn = spawnSync } = {}) {
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
  const passwordRecord = await createPasswordRecord(values.password);
  const directory = mkdtempSync(path.join(tmpdir(), "hanlim-admin-provision-"));
  const sqlPath = path.join(directory, "provision.sql");
  try {
    writeFileSync(sqlPath, buildAdminProvisionSql({ ...checked, passwordRecord }), { encoding: "utf8", mode: 0o600 });
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const executed = spawn(executable, [
      "wrangler", "d1", "execute", "hanlim-archive",
      "--remote", "--env", checked.envName, "--file", sqlPath, "--json"
    ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", env: process.env, shell: false });
    if (executed.status !== 0) return { ok: false, errors: ["원격 D1 Admin provisioning 실행에 실패했습니다."] };
    const count = provisionedCount(JSON.parse(executed.stdout || "[]"));
    if (count !== 1) return { ok: false, errors: ["동일 사용자명이 이미 있어 권한이나 비밀번호를 변경하지 않았습니다. 다른 독립 사용자명을 사용하세요."] };
    return { ok: true, envName: checked.envName, provisioned: count };
  } catch {
    return { ok: false, errors: ["Admin provisioning 결과를 확인할 수 없습니다."] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runAdminProvision();
  if (!result.ok) {
    for (const error of result.errors || []) console.error(`[admin:provision] ${error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ action: "admin-provision", env: result.envName, provisioned: result.provisioned }));
}
