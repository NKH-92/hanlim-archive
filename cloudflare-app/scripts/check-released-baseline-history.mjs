#!/usr/bin/env node
/**
 * Compare the checked-in released migration baseline with a trusted Git base.
 * This closes the local co-edit loophole where SQL, manifest, and baseline are
 * all changed together in one pull request.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hashMigrationSql } from "./check-migrations.mjs";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(APP_ROOT, "..");
const MIGRATION_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

function parseBaseRef(argv) {
  const index = argv.indexOf("--base-ref");
  const value = index >= 0 ? argv[index + 1] : "";
  if (!/^[a-f0-9]{40}$/i.test(value || "")) {
    throw new Error("--base-ref must be a trusted 40-character Git commit SHA");
  }
  return value;
}

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

export function verifyReleasedBaselineAgainstBase({ currentBaseline, baseMigrations }) {
  const errors = [];
  const checksums = currentBaseline?.checksums;
  const baseNames = Object.keys(baseMigrations || {}).sort();

  if (!currentBaseline || currentBaseline.version !== 1 || !checksums || typeof checksums !== "object") {
    return { ok: false, errors: ["current released baseline is missing or malformed"] };
  }
  if (!baseNames.length) {
    return { ok: false, errors: ["trusted base contains no migrations"] };
  }

  const currentNames = Object.keys(checksums);
  const currentBasePrefix = currentNames.slice(0, baseNames.length);
  if (JSON.stringify(currentBasePrefix) !== JSON.stringify(baseNames)) {
    errors.push("released baseline must retain every migration from the trusted base in order");
  }

  for (const name of baseNames) {
    const expected = hashMigrationSql(baseMigrations[name]);
    if (checksums[name] !== expected) {
      errors.push(`${name}: released baseline differs from the trusted base`);
    }
  }

  const releasedThroughIndex = currentNames.indexOf(currentBaseline.releasedThrough);
  if (releasedThroughIndex < baseNames.length - 1) {
    errors.push("releasedThrough cannot move behind the trusted base migration tail");
  }

  return { ok: errors.length === 0, errors };
}

export function loadBaseMigrations(baseRef) {
  const output = git([
    "ls-tree",
    "-r",
    "--name-only",
    baseRef,
    "--",
    "cloudflare-app/migrations"
  ]);
  const paths = output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => MIGRATION_PATTERN.test(path.split("/").at(-1)))
    .sort();

  return Object.fromEntries(paths.map((path) => [
    path.split("/").at(-1),
    git(["show", `${baseRef}:${path}`])
  ]));
}

export async function checkReleasedBaselineHistory({ baseRef }) {
  const currentBaseline = JSON.parse(
    await readFile(join(APP_ROOT, "migrations", "released-baseline.json"), "utf8")
  );
  return verifyReleasedBaselineAgainstBase({
    currentBaseline,
    baseMigrations: loadBaseMigrations(baseRef)
  });
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const result = await checkReleasedBaselineHistory({ baseRef: parseBaseRef(process.argv.slice(2)) });
    if (!result.ok) {
      for (const error of result.errors) console.error(`[released-baseline] ${error}`);
      process.exit(1);
    }
    console.log("released migration baseline matches the trusted Git base");
  } catch (error) {
    console.error(`[released-baseline] ${error.message}`);
    process.exit(1);
  }
}
