import assert from "node:assert/strict";
import test from "node:test";

import {
  changedFilesBetween,
  classifyReleaseFiles,
  detectProductionCoreTransition,
  productionCoreBindingAt
} from "../scripts/classify-release.mjs";

function wranglerConfig(databaseId, databaseName = "core") {
  return JSON.stringify({
    env: {
      production: {
        d1_databases: [{
          binding: "DB",
          database_id: databaseId,
          database_name: databaseName
        }]
      }
    }
  });
}

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
    "cloudflare-app/tests/index.test.js",
    "docs/DESIGN.md"
  ]);

  assert.equal(result.releaseClass, "runtime-only");
  assert.equal(result.requiresMigration, false);
  assert.equal(result.requiresSmokePrincipals, true);
  assert.equal(result.recoveryScope, "core");
});

test("release classifier는 문서와 저장소 관리 파일을 배포 범위 판정에서 제외한다", () => {
  const assetResult = classifyReleaseFiles([
    "cloudflare-app/public/assets/app.css",
    "docs/DESIGN.md",
    "README.md",
    ".github/CODEOWNERS",
    ".github/pull_request_template.md"
  ]);

  assert.equal(assetResult.releaseClass, "asset-only");
  assert.deepEqual(assetResult.changedFiles, [
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    "README.md",
    "cloudflare-app/public/assets/app.css",
    "docs/DESIGN.md"
  ]);
  assert.equal(classifyReleaseFiles(["docs/OPERATIONS.md"]).releaseClass, "database");
  assert.equal(classifyReleaseFiles([
    "docs/DESIGN.md",
    "unexpected/release-input.txt"
  ]).releaseClass, "database");
});

test("release classifier는 migration, binding, workflow, 미지 경로를 전체 보호 경로로 닫는다", () => {
  for (const file of [
    "cloudflare-app/migrations/0045_example.sql",
    "cloudflare-app/wrangler.jsonc",
    ".github/workflows/deploy.yml",
    "unexpected/release-input.txt"
  ]) {
    const result = classifyReleaseFiles([file]);
    assert.equal(result.releaseClass, "database", file);
    assert.equal(result.requiresMigration, true, file);
    // 검색 색인이 Core D1 안으로 들어왔으므로 복구 대상은 Core 하나다.
    assert.equal(result.recoveryScope, "core", file);
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

test("production Core binding 전환은 base와 head의 실제 Wrangler 설정으로 판정한다", () => {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const ref = args[1].split(":", 1)[0];
    return {
      status: 0,
      stdout: ref === "base-sha"
        ? wranglerConfig("1262ca00-b431-490c-aad2-539d77d4f73f", "hanlim-archive")
        : wranglerConfig("a07324c0-7547-48a6-836e-3f0c50b85c36", "hanlim-archive-core-20260823")
    };
  };

  const result = detectProductionCoreTransition("base-sha", "head-sha", {
    repositoryRoot: "repo-root",
    spawn
  });

  assert.equal(result.changed, true);
  assert.equal(result.previous.databaseId, "1262ca00-b431-490c-aad2-539d77d4f73f");
  assert.equal(result.target.databaseId, "a07324c0-7547-48a6-836e-3f0c50b85c36");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["show", "base-sha:cloudflare-app/wrangler.jsonc"]);
  assert.equal(calls[0].options.shell, false);
});

test("production Core binding 판정은 설정 누락 시 실패해 배포를 닫는다", () => {
  assert.throws(
    () => productionCoreBindingAt("bad-ref", {
      spawn: () => ({ status: 0, stdout: wranglerConfig("", "") })
    }),
    /binding이 비어 있습니다/
  );
});
