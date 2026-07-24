#!/usr/bin/env node
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { preflightDeploy, runWranglerCaptured } from "./deploy-guarded.mjs";

const APP_ROOT = path.resolve(import.meta.dirname, "..");

function required(environment, name) {
  const value = String(environment[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function safeSegment(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(value) || value.includes("..")) {
    throw new Error(`${label} contains an unsafe path segment.`);
  }
  return value;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function runOrThrow(result, label) {
  if (result.error || result.status !== 0) throw new Error(`${label} failed.`);
}

export function preflightBackup(environment = process.env) {
  const errors = [];
  let envName = "";
  let expectedDatabaseId = "";
  let expectedSearchDatabaseId = "";
  let bucket = "";
  let prefix = "";
  let recipient = "";
  let releaseSha = "";
  let runId = "";
  try {
    envName = required(environment, "D1_BACKUP_ENV");
    expectedDatabaseId = required(environment, "D1_TARGET_DATABASE_ID");
    expectedSearchDatabaseId = required(environment, "SEARCH_D1_TARGET_DATABASE_ID");
    bucket = safeSegment(required(environment, "R2_BACKUP_BUCKET"), "R2_BACKUP_BUCKET");
    prefix = safeSegment(required(environment, "R2_BACKUP_PREFIX"), "R2_BACKUP_PREFIX").replace(/\/+$/, "");
    recipient = required(environment, "BACKUP_AGE_RECIPIENT");
    releaseSha = required(environment, "GITHUB_SHA");
    runId = required(environment, "GITHUB_RUN_ID");
  } catch (error) {
    errors.push(error.message);
  }
  const target = preflightDeploy({
    envName,
    expectedDatabaseId,
    expectedSearchDatabaseId,
    requireSearchDatabase: true,
    dryRun: true
  });
  if (!target.ok) errors.push(...target.errors);
  if (!/^age1[0-9a-z]{20,}$/.test(recipient)) errors.push("BACKUP_AGE_RECIPIENT is not an age recipient.");
  if (!/^[a-f0-9]{40}$/i.test(releaseSha)) errors.push("GITHUB_SHA must be a 40-character commit SHA.");
  if (!/^\d+$/.test(runId)) errors.push("GITHUB_RUN_ID must be numeric.");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, envName, bucket, prefix, recipient, releaseSha: releaseSha.toLowerCase(), runId };
}

export async function runEncryptedBackup({
  environment = process.env,
  spawn = spawnSync,
  execPath = process.execPath
} = {}) {
  const checked = preflightBackup(environment);
  if (!checked.ok) return checked;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const directory = mkdtempSync(path.join(tmpdir(), "hanlim-d1-r2-"));
  const receiptPath = path.resolve(required(environment, "BACKUP_RECEIPT_PATH"));
  const replayPath = path.resolve(required(environment, "BACKUP_REPLAY_REPORT_PATH"));
  const databases = [
    { label: "core", binding: "hanlim-archive" },
    { label: "search", binding: "hanlim-archive-search-10k" }
  ];
  const receiptEntries = [];
  try {
    const exports = {};
    for (const database of databases) {
      const rawPath = path.join(directory, `${database.label}.sql`);
      const exported = runWranglerCaptured({
        appRoot: APP_ROOT,
        execPath,
        spawn,
        environment,
        args: [
          "d1", "export", database.binding,
          "--remote", "--env", checked.envName,
          "--skip-confirmation", "--output", rawPath
        ]
      });
      runOrThrow(exported, `${database.label} D1 export`);
      exports[database.label] = rawPath;
    }

    const replayed = spawn(execPath, [
      path.join(APP_ROOT, "scripts", "replay-pending-migrations.mjs"),
      "--core-export", exports.core,
      "--search-export", exports.search,
      "--out", replayPath
    ], { cwd: APP_ROOT, env: environment, stdio: "inherit", shell: false });
    runOrThrow(replayed, "pending migration replay");

    for (const database of databases) {
      const gzipPath = path.join(directory, `${database.label}.sql.gz`);
      const encryptedPath = path.join(directory, `${database.label}.sql.gz.age`);
      writeFileSync(gzipPath, gzipSync(readFileSync(exports[database.label]), { level: 9 }), { mode: 0o600 });
      const encrypted = spawn("age", [
        "--encrypt", "--recipient", checked.recipient,
        "--output", encryptedPath,
        gzipPath
      ], { cwd: APP_ROOT, env: environment, stdio: "ignore", shell: false });
      runOrThrow(encrypted, `${database.label} age encryption`);
      const digest = sha256File(encryptedPath);
      const key = `${checked.prefix}/${stamp}/${database.label}-${checked.releaseSha}-${digest.slice(0, 16)}.sql.gz.age`;
      const uploaded = runWranglerCaptured({
        appRoot: APP_ROOT,
        execPath,
        spawn,
        environment,
        args: [
          "r2", "object", "put", `${checked.bucket}/${key}`,
          "--remote", "--file", encryptedPath,
          "--content-type", "application/octet-stream",
          "--force"
        ]
      });
      runOrThrow(uploaded, `${database.label} R2 upload`);

      const verifiedPath = path.join(directory, `${database.label}.verify.age`);
      const downloaded = runWranglerCaptured({
        appRoot: APP_ROOT,
        execPath,
        spawn,
        environment,
        args: [
          "r2", "object", "get", `${checked.bucket}/${key}`,
          "--remote", "--file", verifiedPath
        ]
      });
      runOrThrow(downloaded, `${database.label} R2 verification download`);
      if (sha256File(verifiedPath) !== digest) throw new Error(`${database.label} R2 object checksum mismatch.`);
      receiptEntries.push({
        database: database.label,
        bucket: checked.bucket,
        key,
        ciphertextSha256: digest,
        ciphertextBytes: readFileSync(encryptedPath).byteLength
      });
    }

    const receipt = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      releaseSha: checked.releaseSha,
      runId: checked.runId,
      encryption: "age-x25519",
      replayReport: path.basename(replayPath),
      objects: receiptEntries
    };
    mkdirSync(path.dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { ok: true, receipt };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runEncryptedBackup();
  if (!result.ok) {
    for (const error of result.errors || []) console.error(`[d1-r2-backup] ${error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    action: "d1-r2-backup",
    objectCount: result.receipt.objects.length,
    releaseSha: result.receipt.releaseSha
  }));
}
