#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  preflightDeploy,
  runWranglerCaptured
} from "./deploy-guarded.mjs";

const APP_ROOT = path.resolve(import.meta.dirname, "..");

function required(environment, name) {
  const value = String(environment[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function validateVersionId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function structuredUpload(outputPath) {
  const entries = readFileSync(outputPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return entries.findLast((entry) => entry.type === "version-upload");
}

export function preflightVersionRelease({
  action,
  environment = process.env
} = {}) {
  const envName = environment.CLOUDFLARE_ENV;
  const target = preflightDeploy({
    envName,
    expectedDatabaseId: environment.D1_TARGET_DATABASE_ID,
    expectedSearchDatabaseId: environment.SEARCH_D1_TARGET_DATABASE_ID,
    versionTag: environment.WORKER_VERSION_TAG,
    versionMessage: environment.WORKER_VERSION_MESSAGE,
    requireSearchDatabase: true
  });
  const errors = target.ok ? [] : [...target.errors];
  if (!["upload", "stage", "promote"].includes(action)) {
    errors.push("action must be upload, stage or promote.");
  }
  if (action === "upload") {
    if (!String(environment.WORKER_VERSION_OUTPUT_PATH || "").trim()) {
      errors.push("WORKER_VERSION_OUTPUT_PATH is required.");
    }
  }
  if (["stage", "promote"].includes(action) && !validateVersionId(String(environment.WORKER_VERSION_ID || ""))) {
    errors.push("WORKER_VERSION_ID must be a Worker version UUID.");
  }
  if (action === "stage" && !validateVersionId(String(environment.WORKER_PREVIOUS_VERSION_ID || ""))) {
    errors.push("WORKER_PREVIOUS_VERSION_ID must be a Worker version UUID.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, action, target };
}

export function runVersionRelease({
  action,
  environment = process.env,
  spawn = spawnSync,
  execPath = process.execPath
} = {}) {
  const checked = preflightVersionRelease({ action, environment });
  if (!checked.ok) return checked;
  const { target } = checked;

  if (action === "upload") {
    const outputPath = path.resolve(required(environment, "WORKER_VERSION_OUTPUT_PATH"));
    const wranglerOutputPath = `${outputPath}.wrangler.ndjson`;
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const uploaded = runWranglerCaptured({
      appRoot: APP_ROOT,
      execPath,
      spawn,
      environment: { ...environment, WRANGLER_OUTPUT_FILE_PATH: wranglerOutputPath },
      args: [
        "versions", "upload",
        "--env", target.envName,
        "--strict",
        "--tag", target.versionTag,
        "--message", target.versionMessage
      ]
    });
    if (uploaded.error || uploaded.status !== 0) {
      return { ok: false, errors: ["Worker version upload failed."] };
    }
    let result;
    try {
      result = structuredUpload(wranglerOutputPath);
    } catch {
      return { ok: false, errors: ["Wrangler structured version output could not be parsed."] };
    }
    const versionId = String(result?.version_id || "");
    if (!validateVersionId(versionId)) {
      return { ok: false, errors: ["Wrangler did not return a valid Worker version ID."] };
    }
    const output = {
      schemaVersion: 2,
      versionId,
      tag: target.versionTag,
      message: target.versionMessage
    };
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { ok: true, action, ...output };
  }

  const versionId = required(environment, "WORKER_VERSION_ID");
  const versionSpecs = action === "stage"
    ? [
        `${required(environment, "WORKER_PREVIOUS_VERSION_ID")}@100%`,
        `${versionId}@0%`
      ]
    : [`${versionId}@100%`];
  const promoted = runWranglerCaptured({
    appRoot: APP_ROOT,
    execPath,
    spawn,
    environment,
    args: [
      "versions", "deploy", ...versionSpecs,
      "--env", target.envName,
      "--yes",
      "--message", target.versionMessage
    ]
  });
  if (promoted.error || promoted.status !== 0) {
    return { ok: false, errors: [`Worker version ${action} failed.`] };
  }
  return { ok: true, action, versionId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const actionIndex = process.argv.indexOf("--action");
  const action = actionIndex >= 0 ? process.argv[actionIndex + 1] : "";
  const result = runVersionRelease({ action });
  if (!result.ok) {
    for (const error of result.errors || []) console.error(`[worker-version] ${error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    action: `worker-version-${result.action}`,
    versionId: result.versionId
  }));
}
