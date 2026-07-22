#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { preflightDeploy } from "./deploy-guarded.mjs";

const KNOWN_BOOTSTRAP_USERNAME = "nkh92@hanlim.com";

export function adminReadinessSql(phase = "post-migration") {
  if (!new Set(["pre-migration", "post-migration"]).has(phase)) {
    throw new TypeError("D1_ADMIN_CHECK_PHASE는 pre-migration 또는 post-migration이어야 합니다.");
  }
  const reviewClause = phase === "post-migration" ? "AND COALESCE(security_review_required, 0) = 0" : "";
  return `
    SELECT COUNT(*) AS approved_admin_count
    FROM app_users
    WHERE status = 'approved'
      AND role = 'Admin'
      AND can_manage_users = 1
      AND username <> '${KNOWN_BOOTSTRAP_USERNAME}'
      ${reviewClause}
  `;
}

export function evaluateAdminReadiness(payload) {
  const executions = Array.isArray(payload) ? payload : [payload];
  const rows = executions.flatMap((execution) => execution?.results || execution?.result?.results || []);
  const count = Number(rows.at(-1)?.approved_admin_count || 0);
  return Object.freeze({ ok: Number.isInteger(count) && count > 0, approvedAdminCount: count });
}

export function runAdminReadinessCheck({
  envName = process.env.D1_ADMIN_CHECK_ENV || process.env.CLOUDFLARE_ENV,
  expectedDatabaseId = process.env.D1_TARGET_DATABASE_ID,
  phase = process.env.D1_ADMIN_CHECK_PHASE || "post-migration",
  spawn = spawnSync
} = {}) {
  const target = preflightDeploy({ envName, expectedDatabaseId, dryRun: true });
  if (!target.ok) return { ok: false, errors: target.errors };

  let sql;
  try {
    sql = adminReadinessSql(phase);
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const executed = spawn(executable, [
    "wrangler", "d1", "execute", "hanlim-archive",
    "--remote", "--env", envName, "--command", sql, "--json"
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", env: process.env, shell: false });
  if (executed.status !== 0) {
    return { ok: false, errors: ["원격 D1 관리자 readiness 조회에 실패했습니다."] };
  }
  try {
    const readiness = evaluateAdminReadiness(JSON.parse(executed.stdout || "[]"));
    return readiness.ok
      ? { ...readiness, envName, phase, databaseId: target.configuredId }
      : { ...readiness, errors: ["승인된 독립 Admin 계정이 없습니다. migration 전에 guarded provisioning을 완료하세요."] };
  } catch {
    return { ok: false, errors: ["원격 D1 관리자 readiness 응답을 해석할 수 없습니다."] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = runAdminReadinessCheck();
  if (!result.ok) {
    for (const error of result.errors || []) console.error(`[admin:check] ${error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    action: "admin-readiness-check",
    env: result.envName,
    phase: result.phase,
    approvedAdminCount: result.approvedAdminCount
  }));
}
