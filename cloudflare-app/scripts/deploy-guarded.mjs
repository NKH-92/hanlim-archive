#!/usr/bin/env node
/**
 * Wrangler deploy 안전 래퍼.
 * 기본 deploy가 top-level(프로덕션 DB 바인딩)로 나가지 않게 명시적 --env를 강제하고,
 * 선택된 env의 D1 database_id가 placeholder/불일치가 아닌지 검사한다.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadWranglerConfig(appRoot = ROOT) {
  const raw = readFileSync(join(appRoot, "wrangler.jsonc"), "utf8");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

function databaseIdsForEnv(config, envName) {
  const envBlock = config?.env?.[envName];
  if (!envBlock) throw new Error(`wrangler env '${envName}'가 없습니다.`);
  const binding = (envBlock.d1_databases || []).find((item) => item.binding === "DB")
    || (envBlock.d1_databases || [])[0];
  const searchBinding = (envBlock.d1_databases || []).find((item) => item.binding === "SEARCH_DB");
  const coreId = String(binding?.database_id || "").trim();
  const searchId = String(searchBinding?.database_id || "").trim();
  if (!coreId) throw new Error(`wrangler env '${envName}'에 Core D1 database_id가 없습니다.`);
  return { coreId, searchId, hasSearchBinding: Boolean(searchBinding) };
}

export function resolveWranglerEntrypoint(appRoot) {
  const packagePath = join(appRoot, "node_modules", "wrangler", "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const relativeBin = typeof packageJson.bin === "string"
    ? packageJson.bin
    : packageJson.bin?.wrangler;
  if (!relativeBin) throw new Error("설치된 Wrangler 실행 파일을 찾을 수 없습니다.");
  return resolve(dirname(packagePath), relativeBin);
}

export function runWranglerDeploy({
  appRoot,
  args,
  environment = process.env,
  execPath = process.execPath,
  spawn = spawnSync
}) {
  const wranglerEntrypoint = resolveWranglerEntrypoint(appRoot);
  return spawn(execPath, [wranglerEntrypoint, ...args], {
    stdio: "inherit",
    shell: false,
    env: environment,
    cwd: appRoot
  });
}

export function runWranglerCaptured({
  appRoot,
  args,
  environment = process.env,
  execPath = process.execPath,
  spawn = spawnSync
}) {
  const wranglerEntrypoint = resolveWranglerEntrypoint(appRoot);
  return spawn(execPath, [wranglerEntrypoint, ...args], {
    encoding: "utf8",
    shell: false,
    env: environment,
    cwd: appRoot
  });
}

export function preflightDeploy({
  envName = process.env.CLOUDFLARE_ENV || process.env.DEPLOY_ENV,
  expectedDatabaseId = process.env.D1_TARGET_DATABASE_ID || "",
  expectedSearchDatabaseId = process.env.SEARCH_D1_TARGET_DATABASE_ID || "",
  versionTag = process.env.WORKER_VERSION_TAG || "",
  versionMessage = process.env.WORKER_VERSION_MESSAGE || "",
  requireSearchDatabase = false,
  dryRun = false,
  appRoot = ROOT,
  config = loadWranglerConfig(appRoot)
} = {}) {
  const errors = [];
  if (!envName || !["staging", "production"].includes(String(envName))) {
    errors.push("CLOUDFLARE_ENV(또는 DEPLOY_ENV)는 staging 또는 production이어야 합니다. 기본 unscoped deploy는 금지됩니다.");
  }
  if (errors.length) return { ok: false, errors, dryRun };

  let configuredId;
  let configuredSearchId = "";
  let hasSearchBinding = false;
  try {
    const databaseIds = databaseIdsForEnv(config, envName);
    configuredId = databaseIds.coreId;
    configuredSearchId = databaseIds.searchId;
    hasSearchBinding = databaseIds.hasSearchBinding;
  } catch (error) {
    return { ok: false, errors: [error.message], dryRun };
  }

  if (/REPLACE_WITH_|TODO|CHANGE_ME|YOUR_/i.test(configuredId)) {
    return { ok: false, errors: [`wrangler env '${envName}' database_id가 placeholder입니다.`], dryRun };
  }
  if (!String(expectedDatabaseId || "").trim()) {
    return {
      ok: false,
      errors: ["D1_TARGET_DATABASE_ID는 필수입니다. 선택된 wrangler env database_id와 일치해야 합니다."],
      dryRun
    };
  }
  if (/REPLACE_WITH_|TODO|CHANGE_ME|YOUR_/i.test(expectedDatabaseId)) {
    return { ok: false, errors: ["D1_TARGET_DATABASE_ID가 placeholder입니다."], dryRun };
  }
  if (String(expectedDatabaseId) !== String(configuredId)) {
    return {
      ok: false,
      errors: [
        `D1_TARGET_DATABASE_ID(${expectedDatabaseId})가 wrangler env '${envName}' database_id(${configuredId})와 일치하지 않습니다.`
      ],
      dryRun
    };
  }
  if (hasSearchBinding && requireSearchDatabase) {
    if (!configuredSearchId || /REPLACE_WITH_|TODO|CHANGE_ME|YOUR_/i.test(configuredSearchId)) {
      return { ok: false, errors: [`wrangler env '${envName}' SEARCH_DB database_id가 placeholder입니다.`], dryRun };
    }
    if (!String(expectedSearchDatabaseId || "").trim()) {
      return { ok: false, errors: ["SEARCH_D1_TARGET_DATABASE_ID는 필수입니다."], dryRun };
    }
    if (String(expectedSearchDatabaseId) !== String(configuredSearchId)) {
      return {
        ok: false,
        errors: [`SEARCH_D1_TARGET_DATABASE_ID가 wrangler env '${envName}' SEARCH_DB database_id와 일치하지 않습니다.`],
        dryRun
      };
    }
  }

  if (versionTag && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(versionTag)) {
    errors.push("WORKER_VERSION_TAG는 64자 이하 영문·숫자·점·밑줄·하이픈만 허용합니다.");
  }
  if (versionMessage && (versionMessage.length > 200 || /[\r\n]/.test(versionMessage))) {
    errors.push("WORKER_VERSION_MESSAGE는 줄바꿈 없는 200자 이하여야 합니다.");
  }
  if (errors.length) return { ok: false, errors, dryRun };

  return {
    ok: true,
    envName,
    configuredId,
    configuredSearchId,
    expectedDatabaseId,
    dryRun,
    appRoot: resolve(appRoot),
    versionTag,
    versionMessage
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  const appRoot = argumentValue("--app-root") || ROOT;
  const result = preflightDeploy({ dryRun, appRoot, requireSearchDatabase: true });
  if (!result.ok) {
    for (const error of result.errors) console.error(`[deploy] ${error}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    action: "wrangler-deploy-preflight",
    env: result.envName,
    databaseId: result.configuredId,
    dryRun: result.dryRun,
    appRoot: result.appRoot,
    versionTag: result.versionTag || null
  }));

  const args = ["deploy", "--env", result.envName];
  if (dryRun) args.push("--dry-run");
  if (result.versionTag) args.push("--tag", result.versionTag);
  if (result.versionMessage) args.push("--message", result.versionMessage);
  let spawned;
  try {
    spawned = runWranglerDeploy({
      appRoot: result.appRoot,
      args,
      environment: {
        ...process.env,
        CLOUDFLARE_D1_DATABASE_ID: result.configuredId,
        CLOUDFLARE_SEARCH_D1_DATABASE_ID: result.configuredSearchId
      }
    });
  } catch (error) {
    console.error(`[deploy] ${error.message}`);
    process.exit(1);
  }
  if (spawned.error) {
    console.error(`[deploy] Wrangler 실행 실패: ${spawned.error.message}`);
    process.exit(1);
  }
  process.exit(spawned.status ?? 1);
}
