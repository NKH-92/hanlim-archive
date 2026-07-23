#!/usr/bin/env node
/**
 * 원격 D1 migration 안전 래퍼.
 * Wrangler env의 database_id와 D1_TARGET_DATABASE_ID를 비교하고,
 * backup·승인·placeholder를 mutation 실행 전에 거부한다.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    console.error(`[db:migrate:remote] ${name} 환경변수가 필요합니다.`);
    process.exit(1);
  }
  return value;
}

function loadWranglerConfig() {
  const raw = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

function databaseIdsForEnv(config, envName) {
  const envBlock = config?.env?.[envName];
  if (!envBlock) {
    throw new Error(`wrangler env '${envName}'가 없습니다.`);
  }
  const binding = (envBlock.d1_databases || []).find((item) => item.binding === "DB")
    || (envBlock.d1_databases || [])[0];
  const searchBinding = (envBlock.d1_databases || []).find((item) => item.binding === "SEARCH_DB");
  const coreId = String(binding?.database_id || "").trim();
  const searchId = String(searchBinding?.database_id || "").trim();
  if (!coreId) throw new Error(`wrangler env '${envName}'에 Core D1 database_id가 없습니다.`);
  return { coreId, searchId, hasSearchBinding: Boolean(searchBinding) };
}

function assertSafeDatabaseId(id, label) {
  if (!id || /REPLACE_WITH_|TODO|CHANGE_ME|YOUR_/i.test(id)) {
    console.error(`[db:migrate:remote] ${label}이 placeholder이거나 비어 있습니다: ${id}`);
    process.exit(1);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    console.error(`[db:migrate:remote] ${label}이 UUID 형식이 아닙니다.`);
    process.exit(1);
  }
}

export function preflightRemoteMigrate({
  envName = process.env.D1_MIGRATE_ENV,
  expectedDatabaseId = process.env.D1_TARGET_DATABASE_ID,
  expectedSearchDatabaseId = process.env.SEARCH_D1_TARGET_DATABASE_ID,
  backupEvidenceId = process.env.D1_BACKUP_EVIDENCE_ID,
  backupEvidenceDigest = process.env.D1_BACKUP_EVIDENCE_DIGEST,
  runId = process.env.GITHUB_RUN_ID,
  releaseSha = process.env.GITHUB_SHA,
  approvalContext = process.env.D1_MIGRATE_APPROVAL_CONTEXT,
  dryRun = String(process.env.D1_MIGRATE_DRY_RUN || "1") !== "0",
  config = loadWranglerConfig()
} = {}) {
  const errors = [];
  if (!envName || !["staging", "production"].includes(String(envName))) {
    errors.push("D1_MIGRATE_ENV는 staging 또는 production만 허용합니다.");
  }
  if (!expectedDatabaseId) errors.push("D1_TARGET_DATABASE_ID가 필요합니다.");
  if (!/^\d+$/.test(String(backupEvidenceId || "")) || Number(backupEvidenceId) < 1) {
    errors.push("D1_BACKUP_EVIDENCE_ID는 현재 GitHub Actions backup artifact ID여야 합니다.");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(backupEvidenceDigest || ""))) {
    errors.push("D1_BACKUP_EVIDENCE_DIGEST는 업로드된 backup artifact의 SHA-256이어야 합니다.");
  }
  if (!/^\d+$/.test(String(runId || ""))) {
    errors.push("GITHUB_RUN_ID가 필요합니다.");
  }
  if (!/^[a-f0-9]{40}$/i.test(String(releaseSha || ""))) {
    errors.push("GITHUB_SHA는 40자리 release commit SHA여야 합니다.");
  }
  const expectedApprovalContext = `github-environment:${envName}:${runId}:${releaseSha}`;
  if (String(approvalContext || "") !== expectedApprovalContext) {
    errors.push("D1_MIGRATE_APPROVAL_CONTEXT가 현재 GitHub Environment 승인 실행과 일치하지 않습니다.");
  }
  if (errors.length) {
    return { ok: false, errors, dryRun: true };
  }

  let configuredId;
  let configuredSearchId = "";
  let hasSearchBinding = false;
  try {
    const databaseIds = databaseIdsForEnv(config, envName);
    configuredId = databaseIds.coreId;
    configuredSearchId = databaseIds.searchId;
    hasSearchBinding = databaseIds.hasSearchBinding;
  } catch (error) {
    return { ok: false, errors: [error.message], dryRun: true };
  }

  if (/REPLACE_WITH_|TODO|CHANGE_ME|YOUR_/i.test(configuredId)) {
    return { ok: false, errors: [`wrangler env '${envName}' database_id가 placeholder입니다.`], dryRun: true };
  }
  if (/REPLACE_WITH_|TODO|CHANGE_ME|YOUR_/i.test(expectedDatabaseId)) {
    return { ok: false, errors: ["D1_TARGET_DATABASE_ID가 placeholder입니다."], dryRun: true };
  }
  if (String(configuredId) !== String(expectedDatabaseId)) {
    return {
      ok: false,
      errors: [
        `D1_TARGET_DATABASE_ID(${expectedDatabaseId})가 wrangler env '${envName}' database_id(${configuredId})와 일치하지 않습니다.`
      ],
      dryRun: true,
      configuredId,
      expectedDatabaseId
    };
  }
  if (hasSearchBinding) {
    if (!configuredSearchId || /REPLACE_WITH_|TODO|CHANGE_ME|YOUR_/i.test(configuredSearchId)) {
      return { ok: false, errors: [`wrangler env '${envName}' SEARCH_DB database_id가 placeholder입니다.`], dryRun: true };
    }
    if (!expectedSearchDatabaseId) {
      return { ok: false, errors: ["SEARCH_D1_TARGET_DATABASE_ID가 필요합니다."], dryRun: true };
    }
    if (String(configuredSearchId) !== String(expectedSearchDatabaseId)) {
      return {
        ok: false,
        errors: ["SEARCH_D1_TARGET_DATABASE_ID가 선택된 SEARCH_DB database_id와 일치하지 않습니다."],
        dryRun: true
      };
    }
  }

  return {
    ok: true,
    envName,
    expectedDatabaseId,
    configuredId,
    configuredSearchId,
    backupEvidenceId: String(backupEvidenceId),
    backupEvidenceDigest: String(backupEvidenceDigest).toLowerCase(),
    runId: String(runId),
    releaseSha: String(releaseSha).toLowerCase(),
    dryRun,
    approvalContext: expectedApprovalContext
  };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const envName = required("D1_MIGRATE_ENV");
  const expectedDatabaseId = required("D1_TARGET_DATABASE_ID");
  required("D1_BACKUP_EVIDENCE_ID");
  required("D1_BACKUP_EVIDENCE_DIGEST");
  required("GITHUB_RUN_ID");
  required("GITHUB_SHA");
  required("D1_MIGRATE_APPROVAL_CONTEXT");

  const result = preflightRemoteMigrate();
  if (!result.ok) {
    for (const error of result.errors) console.error(`[db:migrate:remote] ${error}`);
    process.exit(1);
  }

  assertSafeDatabaseId(result.expectedDatabaseId, "D1_TARGET_DATABASE_ID");
  assertSafeDatabaseId(result.configuredId, `wrangler env.${envName}.database_id`);
  if (result.configuredSearchId) {
    assertSafeDatabaseId(required("SEARCH_D1_TARGET_DATABASE_ID"), "SEARCH_D1_TARGET_DATABASE_ID");
    assertSafeDatabaseId(result.configuredSearchId, `wrangler env.${envName}.SEARCH_DB.database_id`);
  }

  console.log(JSON.stringify({
    action: "d1-migrate-remote-preflight",
    env: result.envName,
    databaseId: result.expectedDatabaseId,
    configuredDatabaseId: result.configuredId,
    backupEvidenceId: result.backupEvidenceId,
    backupEvidenceDigest: result.backupEvidenceDigest,
    runId: result.runId,
    releaseSha: result.releaseSha,
    dryRun: result.dryRun,
    approvalContext: result.approvalContext
  }));

  const args = [
    "d1", "migrations", "apply", "hanlim-archive",
    "--remote",
    "--env", envName
  ];
  if (result.dryRun) args.push("--dry-run");

  const spawned = spawnSync("npx", ["wrangler", ...args], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      CLOUDFLARE_D1_DATABASE_ID: expectedDatabaseId
    }
  });
  if ((spawned.status ?? 1) !== 0 || !result.configuredSearchId) {
    process.exit(spawned.status ?? 1);
  }
  const searchArgs = [
    "d1", "migrations", "apply", "hanlim-archive-search-10k",
    "--remote",
    "--env", envName
  ];
  if (result.dryRun) searchArgs.push("--dry-run");
  const searchSpawned = spawnSync("npx", ["wrangler", ...searchArgs], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      CLOUDFLARE_D1_DATABASE_ID: result.configuredSearchId
    }
  });
  process.exit(searchSpawned.status ?? 1);
}
