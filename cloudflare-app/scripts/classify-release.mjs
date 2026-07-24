#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const REPOSITORY_ROOT = path.resolve(APP_ROOT, "..");

const DATABASE_PATHS = Object.freeze([
  /^cloudflare-app\/migrations\//,
  /^cloudflare-app\/search-migrations\//,
  /^cloudflare-app\/wrangler\.jsonc$/,
  /^\.github\/workflows\/deploy\.yml$/
]);
const ASSET_PATH = /^cloudflare-app\/public\//;
const RUNTIME_PATHS = Object.freeze([
  /^cloudflare-app\/src\//,
  /^cloudflare-app\/scripts\//,
  /^cloudflare-app\/tests\//,
  /^cloudflare-app\/package(?:-lock)?\.json$/,
  /^cloudflare-app\/jsconfig\.check\.json$/,
  /^cloudflare-app\/eslint\.config\.js$/,
  /^cloudflare-app\/public\//
]);

export function classifyReleaseFiles(files) {
  const changedFiles = [...new Set((files || []).map(normalizePath).filter(Boolean))].sort();
  if (!changedFiles.length) {
    return releaseResult("database", changedFiles, "변경 파일을 확인할 수 없어 전체 보호 경로를 사용합니다.");
  }
  if (changedFiles.some((file) => DATABASE_PATHS.some((pattern) => pattern.test(file)))) {
    return releaseResult("database", changedFiles, "스키마·binding·배포 절차 변경이 있어 전체 보호 경로를 사용합니다.");
  }
  if (changedFiles.every((file) => ASSET_PATH.test(file))) {
    return releaseResult("asset-only", changedFiles, "공개 정적 자산만 변경되었습니다.");
  }
  if (changedFiles.every((file) => RUNTIME_PATHS.some((pattern) => pattern.test(file)))) {
    return releaseResult("runtime-only", changedFiles, "D1 스키마와 binding을 바꾸지 않는 Worker 변경입니다.");
  }
  return releaseResult("database", changedFiles, "분류되지 않은 경로가 있어 전체 보호 경로를 사용합니다.");
}

export function changedFilesBetween(baseRef, headRef = "HEAD", {
  spawn = spawnSync,
  repositoryRoot = REPOSITORY_ROOT
} = {}) {
  const base = String(baseRef || "").trim();
  const head = String(headRef || "HEAD").trim();
  if (!base || !head) throw new Error("base와 head Git ref가 필요합니다.");
  const result = spawn("git", [
    "diff", "--name-only", "--diff-filter=ACMR", `${base}..${head}`
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false
  });
  if (result.error || result.status !== 0) {
    throw new Error("release 변경 파일을 읽지 못했습니다.");
  }
  return String(result.stdout || "").split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
}

function releaseResult(releaseClass, changedFiles, reason) {
  return Object.freeze({
    schemaVersion: 1,
    releaseClass,
    requiresMigration: releaseClass === "database",
    requiresSmokePrincipals: releaseClass !== "asset-only",
    recoveryScope: releaseClass === "database"
      ? "core-and-search"
      : releaseClass === "runtime-only"
        ? "core"
        : "none",
    changedFiles: Object.freeze(changedFiles),
    reason
  });
}

function normalizePath(file) {
  return String(file || "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const baseRef = readArgument("--base");
    const headRef = readArgument("--head") || "HEAD";
    const result = classifyReleaseFiles(changedFilesBetween(baseRef, headRef));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`[release-classifier] ${error.message}`);
    process.exit(1);
  }
}
