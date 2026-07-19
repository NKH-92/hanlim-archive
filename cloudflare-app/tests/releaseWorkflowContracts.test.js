import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const deploy = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const owners = await readFile(new URL("../../.github/CODEOWNERS", import.meta.url), "utf8");

test("PR required CI는 verify, audit, Worker dry-run과 증빙 보존을 강제한다", () => {
  assert.match(ci, /pull_request:[\s\S]*branches: \[main\]/);
  assert.match(ci, /name: required \/ verify/);
  for (const command of ["npm run verify", "npm run audit:dependencies", "npm run release:evidence", "npm run deploy:dry"]) {
    assert.ok(ci.includes(command), command);
  }
  assert.match(ci, /actions\/upload-artifact@[a-f0-9]{40}/);
});

test("production deploy는 승인, 백업, migration, deploy, smoke, rollback 순서를 고정한다", () => {
  const markers = [
    "name: production",
    "Create encrypted pre-deploy D1 backup",
    "Upload pre-deploy backup",
    "Apply D1 migrations",
    "Deploy Worker",
    "Post-deploy login and read-only search smoke",
    "Roll back Worker after smoke failure",
    "Upload release evidence"
  ];
  let previous = -1;
  for (const marker of markers) {
    const current = deploy.indexOf(marker);
    assert.ok(current > previous, marker);
    previous = current;
  }
  assert.match(deploy, /if: steps\.smoke\.outcome == 'failure'/);
  assert.match(deploy, /if: always\(\)/);
  assert.match(deploy, /wrangler deployments status --json/);
  assert.match(deploy, /select\(\.percentage == 100\).*\.version_id/);
  assert.doesNotMatch(deploy, /versions list --json > release-evidence\/versions-before\.json/);
  assert.equal(deploy.match(/set -o pipefail/g)?.length, 5);
  assert.doesNotMatch(deploy, /123456|SESSION_SECRET/);
});

test("증빙을 tee로 보존하는 CI와 배포 단계는 원 명령의 실패를 전파한다", () => {
  assert.match(ci, /set -o pipefail\s+npm run deploy:dry 2>&1 \| tee/);
  for (const command of [
    "npm run deploy:dry",
    "npx wrangler d1 migrations apply",
    "npx wrangler deploy",
    "npm run smoke:release",
    "npx wrangler rollback"
  ]) {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(deploy, new RegExp(`set -o pipefail\\s+${escaped}[^\\n]*\\| tee`), command);
  }
});

test("CODEOWNERS는 migration, security, audit, workflow 변경을 지정한다", () => {
  for (const path of ["/.github/workflows/", "/cloudflare-app/migrations/", "/cloudflare-app/src/platform/security/", "/cloudflare-app/src/domains/audit/"]) {
    assert.ok(owners.includes(path), path);
  }
});
