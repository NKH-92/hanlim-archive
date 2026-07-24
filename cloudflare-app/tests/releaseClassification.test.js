import assert from "node:assert/strict";
import test from "node:test";

import {
  changedFilesBetween,
  classifyReleaseFiles
} from "../scripts/classify-release.mjs";

test("release classifier는 정적 자산만 바뀌면 D1 mutation 없는 경로를 선택한다", () => {
  const result = classifyReleaseFiles([
    "cloudflare-app/public/assets/app.css",
    "cloudflare-app/public/images/logo.svg"
  ]);

  assert.equal(result.releaseClass, "asset-only");
  assert.equal(result.requiresMigration, false);
  assert.equal(result.requiresSmokePrincipals, false);
  assert.equal(result.recoveryScope, "none");
});

test("release classifier는 일반 Worker 변경에 Core recovery만 요구한다", () => {
  const result = classifyReleaseFiles([
    "cloudflare-app/src/index.js",
    "cloudflare-app/tests/index.test.js"
  ]);

  assert.equal(result.releaseClass, "runtime-only");
  assert.equal(result.requiresMigration, false);
  assert.equal(result.requiresSmokePrincipals, true);
  assert.equal(result.recoveryScope, "core");
});

test("release classifier는 migration, binding, workflow, 미지 경로를 전체 보호 경로로 닫는다", () => {
  for (const file of [
    "cloudflare-app/migrations/0045_example.sql",
    "cloudflare-app/search-migrations/0004_example.sql",
    "cloudflare-app/wrangler.jsonc",
    ".github/workflows/deploy.yml",
    "unexpected/release-input.txt"
  ]) {
    const result = classifyReleaseFiles([file]);
    assert.equal(result.releaseClass, "database", file);
    assert.equal(result.requiresMigration, true, file);
    assert.equal(result.recoveryScope, "core-and-search", file);
  }
});

test("release classifier는 빈 diff와 혼합 asset/runtime 변경도 안전하게 분류한다", () => {
  assert.equal(classifyReleaseFiles([]).releaseClass, "database");
  assert.equal(classifyReleaseFiles([
    "cloudflare-app/public/assets/app.css",
    "cloudflare-app/src/index.js"
  ]).releaseClass, "runtime-only");
});

test("changedFilesBetween은 shell 없이 Git diff의 파일 목록만 읽는다", () => {
  const calls = [];
  const files = changedFilesBetween("base-sha", "head-sha", {
    repositoryRoot: "repo-root",
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: "cloudflare-app/src/index.js\r\ncloudflare-app/public/assets/app.css\r\n"
      };
    }
  });

  assert.deepEqual(files, [
    "cloudflare-app/src/index.js",
    "cloudflare-app/public/assets/app.css"
  ]);
  assert.equal(calls[0].command, "git");
  assert.deepEqual(calls[0].args, [
    "diff", "--name-only", "--diff-filter=ACMR", "base-sha..head-sha"
  ]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, "repo-root");
});
