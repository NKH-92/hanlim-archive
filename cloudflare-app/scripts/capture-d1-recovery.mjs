#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { preflightDeploy, runWranglerCaptured } from "./deploy-guarded.mjs";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const BOOKMARK_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/i;

function required(environment, name) {
  const value = String(environment[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseBookmark(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label} Time Travel bookmark capture failed.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} Time Travel response is not valid JSON.`);
  }
  const bookmark = String(parsed?.bookmark || "");
  if (!BOOKMARK_PATTERN.test(bookmark)) {
    throw new Error(`${label} Time Travel response does not contain a valid bookmark.`);
  }
  return bookmark.toLowerCase();
}

export function validateD1RecoveryEvidence(evidence, {
  envName,
  coreDatabaseId,
  searchDatabaseId,
  releaseSha,
  runId,
  scope = evidence?.scope || "core-and-search"
}) {
  const errors = [];
  if (evidence?.schemaVersion !== 1) errors.push("D1 recovery evidence schemaVersion must be 1.");
  if (!["core", "core-and-search"].includes(scope)) errors.push("D1 recovery evidence scope is invalid.");
  if ((evidence?.scope || "core-and-search") !== scope) errors.push("D1 recovery evidence scope does not match.");
  if (evidence?.environment !== envName) errors.push("D1 recovery evidence environment does not match.");
  if (evidence?.releaseSha !== String(releaseSha || "").toLowerCase()) {
    errors.push("D1 recovery evidence release SHA does not match.");
  }
  if (String(evidence?.runId || "") !== String(runId || "")) {
    errors.push("D1 recovery evidence run ID does not match.");
  }
  const expected = [["core", "hanlim-archive", coreDatabaseId]];
  if (scope === "core-and-search") {
    expected.push(["search", "hanlim-archive-search-10k", searchDatabaseId]);
  }
  for (const [label, name, databaseId] of expected) {
    const entry = evidence?.databases?.[label];
    if (entry?.name !== name) errors.push(`${label} D1 recovery database name does not match.`);
    if (entry?.databaseId !== databaseId) errors.push(`${label} D1 recovery database ID does not match.`);
    if (!BOOKMARK_PATTERN.test(String(entry?.bookmark || ""))) {
      errors.push(`${label} D1 recovery bookmark is invalid.`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function preflightD1Recovery({
  environment = process.env,
  config
} = {}) {
  const errors = [];
  const envName = String(environment.D1_RECOVERY_ENV || "");
  const scope = String(environment.D1_RECOVERY_SCOPE || "core-and-search");
  const coreDatabaseId = String(environment.D1_TARGET_DATABASE_ID || "");
  const searchDatabaseId = String(environment.SEARCH_D1_TARGET_DATABASE_ID || "");
  const releaseSha = String(environment.GITHUB_SHA || "").toLowerCase();
  const runId = String(environment.GITHUB_RUN_ID || "");
  const outputPath = String(environment.D1_RECOVERY_EVIDENCE_PATH || "");
  const target = preflightDeploy({
    envName,
    expectedDatabaseId: coreDatabaseId,
    expectedSearchDatabaseId: searchDatabaseId,
    requireSearchDatabase: scope === "core-and-search",
    dryRun: true,
    ...(config ? { config } : {})
  });
  if (!["core", "core-and-search"].includes(scope)) errors.push("D1_RECOVERY_SCOPE must be core or core-and-search.");
  if (!target.ok) errors.push(...target.errors);
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) errors.push("GITHUB_SHA must be a 40-character commit SHA.");
  if (!/^\d+$/.test(runId)) errors.push("GITHUB_RUN_ID must be numeric.");
  if (!outputPath.trim()) errors.push("D1_RECOVERY_EVIDENCE_PATH is required.");
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        envName,
        scope,
        coreDatabaseId,
        searchDatabaseId,
        releaseSha,
        runId,
        outputPath: path.resolve(outputPath)
      };
}

export function captureD1Recovery({
  environment = process.env,
  spawn = spawnSync,
  execPath = process.execPath,
  config
} = {}) {
  const checked = preflightD1Recovery({ environment, config });
  if (!checked.ok) return checked;
  const databases = [{ label: "core", name: "hanlim-archive", databaseId: checked.coreDatabaseId }];
  if (checked.scope === "core-and-search") {
    databases.push({
      label: "search",
      name: "hanlim-archive-search-10k",
      databaseId: checked.searchDatabaseId
    });
  }
  const captured = {};
  try {
    for (const database of databases) {
      const result = runWranglerCaptured({
        appRoot: APP_ROOT,
        execPath,
        spawn,
        environment,
        args: [
          "d1", "time-travel", "info", database.name,
          "--env", checked.envName,
          "--json"
        ]
      });
      captured[database.label] = {
        name: database.name,
        databaseId: database.databaseId,
        bookmark: parseBookmark(result, database.label)
      };
    }
    const evidence = {
      schemaVersion: 1,
      scope: checked.scope,
      capturedAt: new Date().toISOString(),
      environment: checked.envName,
      releaseSha: checked.releaseSha,
      runId: checked.runId,
      retentionNote: "Cloudflare D1 Time Travel retention is plan-dependent; Workers Free retains 7 days.",
      databases: captured
    };
    mkdirSync(path.dirname(checked.outputPath), { recursive: true });
    writeFileSync(checked.outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    return { ok: true, evidence };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = captureD1Recovery();
  if (!result.ok) {
    for (const error of result.errors || []) console.error(`[d1-recovery] ${error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    action: "d1-time-travel-recovery-capture",
    releaseSha: result.evidence.releaseSha,
    databases: Object.keys(result.evidence.databases)
  }));
}
