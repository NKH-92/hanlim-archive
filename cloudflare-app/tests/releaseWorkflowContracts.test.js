import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const deploy = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const provisionAdmin = await readFile(new URL("../../.github/workflows/provision-admin.yml", import.meta.url), "utf8");
const remediateMainAdmin = await readFile(new URL("../../.github/workflows/remediate-main-admin.yml", import.meta.url), "utf8");
const owners = await readFile(new URL("../../.github/CODEOWNERS", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("PR required CI는 verify, audit, Worker dry-run과 증빙 보존을 강제한다", () => {
  assert.match(ci, /pull_request:[\s\S]*branches: \[main\]/);
  assert.match(ci, /name: required \/ verify/);
  for (const command of ["npm run verify", "npm run audit:dependencies", "npm run release:evidence", "npm run deploy:dry"]) {
    assert.ok(ci.includes(command), command);
  }
  assert.match(ci, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(ci, /fetch-depth: 0/);
  assert.match(ci, /github\.event\.pull_request\.base\.sha \|\| github\.event\.before/);
  assert.match(ci, /check-released-baseline-history\.mjs --base-ref "\$RELEASED_BASE_SHA"/);
  assert.match(ci, /CLOUDFLARE_ENV: production[\s\S]*D1_TARGET_DATABASE_ID: 1262ca00-b431-490c-aad2-539d77d4f73f[\s\S]*npm run deploy:dry/);
});

test("production deploy는 승인, 백업, migration, deploy, smoke, rollback 순서를 고정한다", () => {
  const markers = [
    "name: production",
    "Enforce production release from main",
    "Verify independent administrator before migration",
    "Verify independent administrator login before migration",
    "Enforce epoch-aware rollback target before database mutation",
    "Create encrypted pre-deploy D1 backup",
    "Upload pre-deploy backup",
    "Enforce production upgrade data preconditions",
    "Apply D1 migrations",
    "Verify independent administrator after migration",
    "Deploy Worker",
    "Post-deploy login and read-only search smoke",
    "Roll back Worker after release failure",
    "Upload release evidence"
  ];
  let previous = -1;
  for (const marker of markers) {
    const current = deploy.indexOf(marker);
    assert.ok(current > previous, marker);
    previous = current;
  }
  assert.match(deploy, /name: Deploy Worker\s+id: deploy_worker\s+continue-on-error: true/);
  assert.match(deploy, /name: Capture deployed Worker version\s+id: capture_deployed\s+continue-on-error: true/);
  assert.match(deploy, /id: smoke\s+if: steps\.deploy_worker\.outcome == 'success' && steps\.capture_deployed\.outcome == 'success'\s+continue-on-error: true/);
  assert.match(deploy, /always\(\) && \(steps\.deploy_worker\.outcome != 'success' \|\|[\s\S]*steps\.capture_deployed\.outcome != 'success' \|\| steps\.smoke\.outcome != 'success'\)/);
  assert.match(deploy, /if: always\(\)/);
  assert.match(deploy, /wrangler deployments status --env production --json/);
  assert.match(deploy, /select\(\.percentage == 100\).*\.version_id/);
  assert.match(deploy, /versions view "\$DEPLOYED_VERSION_ID" --env production --json/);
  assert.match(deploy, /test "\$DEPLOYED_VERSION_ID" != "\$PREVIOUS_VERSION_ID"/);
  assert.match(deploy, /\.annotations\["workers\/tag"\] == \$tag and \.annotations\["workers\/message"\] == \$message/);
  assert.match(deploy, /SMOKE_EXPECTED_WORKER_VERSION="\$DEPLOYED_VERSION_ID"/);
  assert.match(deploy, /Post-deploy login and read-only search smoke[\s\S]*SMOKE_HEALTH_ATTEMPTS: "60"[\s\S]*SMOKE_HEALTH_RETRY_MS: "2000"/);
  assert.doesNotMatch(deploy, /versions list --json > release-evidence\/versions-before\.json/);
  assert.ok((deploy.match(/set -o pipefail/g)?.length || 0) >= 10);
  assert.doesNotMatch(deploy, /123456|SESSION_SECRET/);
  assert.match(deploy, /id: backup_upload[\s\S]*steps\.backup_upload\.outputs\.artifact-id[\s\S]*steps\.backup_upload\.outputs\.artifact-digest/);
  assert.match(deploy, /D1_MIGRATE_APPROVAL_CONTEXT: github-environment:production:\$\{\{ github\.run_id \}\}:\$\{\{ github\.sha \}\}/);
  assert.match(deploy, /node scripts\/check-upgrade-readiness\.mjs[\s\S]*--sql-export "\$RAW_SQL"[\s\S]*release-evidence\/upgrade-readiness\.json/);
  assert.match(deploy, /UPGRADE_READINESS_STATUS[\s\S]*Enforce production upgrade data preconditions[\s\S]*Apply D1 migrations/);
  assert.match(deploy, /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]/);
  assert.match(deploy, /Verify released migrations against release base[\s\S]*check-released-baseline-history\.mjs --base-ref "\$RELEASED_BASE_SHA"/);
  assert.match(deploy, /PRODUCTION_URL: https:\/\/hanlim-archive\.skarhkdgus7\.workers\.dev[\s\S]*SMOKE_ALLOWED_HOSTS: hanlim-archive\.skarhkdgus7\.workers\.dev/);
  assert.ok((deploy.match(/SMOKE_REQUIRE_ADMIN: "1"/g)?.length || 0) >= 5);
  assert.ok((deploy.match(/SMOKE_REQUIRE_SESSION_EPOCH_COMPAT: "1"/g)?.length || 0) >= 4);
  assert.ok((deploy.match(/npm run smoke:release/g)?.length || 0) >= 6);

  const preMigrationSmoke = deploy.slice(
    deploy.indexOf("Verify independent administrator login before migration"),
    deploy.indexOf("Create encrypted pre-deploy D1 backup")
  );
  for (const envName of ["SMOKE_BASE_URL", "SMOKE_USERNAME", "SMOKE_PASSWORD", "SMOKE_ADMIN_USERNAME", "SMOKE_ADMIN_PASSWORD", "SMOKE_REQUIRE_ADMIN"]) {
    assert.ok(preMigrationSmoke.includes(envName), envName);
  }
  assert.match(preMigrationSmoke, /npm run smoke:release 2>&1 \| tee release-evidence\/pre-migration-admin-smoke\.txt/);
});

test("첫 session-epoch 릴리스는 무 migration 호환 Worker를 안전한 rollback 대상으로 먼저 세운다", () => {
  assert.match(deploy, /fetch-depth: 0/);
  assert.match(deploy, /Detect session-epoch rollback compatibility/);
  assert.match(deploy, /github\.event\.before/);
  assert.match(deploy, /git rev-parse "\$GITHUB_SHA\^1"/);
  assert.match(deploy, /vars\.PRODUCTION_SOURCE_SHA/);
  assert.match(deploy, /test "\$APPROVED_LIVE_SOURCE_SHA" = "\$COMPAT_BASE_SHA"/);
  assert.match(deploy, /apply-session-epoch-compat\.mjs --app-root/);
  assert.match(deploy, /verify-session-epoch-compat\.mjs/);
  assert.match(deploy, /session-epoch-compat-diff\.txt/);
  assert.match(deploy, /cloudflare-app\/wrangler\.jsonc/);
  assert.match(deploy, /deploy-guarded\.mjs" \\\s+--app-root "\$COMPAT_APP_ROOT" --dry-run/);
  assert.match(deploy, /session-epoch-compat-bundle\.txt[\s\S]*session-epoch-compat-final-diff\.txt/);
  assert.match(deploy, /git -C "\$COMPAT_ROOT" ls-files --others --exclude-standard/);
  assert.match(deploy, /test ! -s "\$FINAL_UNTRACKED"/);
  assert.match(deploy, /session-epoch-compat-final-hashes\.sha256[\s\S]*actual_hash[\s\S]*expected_hash/);
  assert.match(deploy, /Deploy session-epoch compatibility Worker without migrations/);
  assert.match(deploy, /PREVIOUS_VERSION_ID=\$COMPAT_VERSION_ID/);
  assert.match(deploy, /--arg id "\$COMPAT_VERSION_ID" --arg tag "\$WORKER_VERSION_TAG"[\s\S]*version-compat\.json/);
  assert.match(deploy, /rollback "\$ORIGINAL_VERSION_ID"/);
  assert.match(deploy, /test "\$ROLLED_BACK_VERSION_ID" = "\$ORIGINAL_VERSION_ID"/);
  assert.match(deploy, /SMOKE_EXPECTED_WORKER_VERSION="\$PREVIOUS_VERSION_ID"/);

  const compatibilityBlock = deploy.slice(
    deploy.indexOf("Prepare and verify session-epoch compatibility Worker"),
    deploy.indexOf("Create encrypted pre-deploy D1 backup")
  );
  assert.doesNotMatch(compatibilityBlock, /db:migrate|d1 migrations apply/);
  assert.match(compatibilityBlock, /SMOKE_REQUIRE_SESSION_EPOCH_COMPAT: "1"/);

  const finalRollback = deploy.slice(deploy.indexOf("Roll back Worker after release failure"));
  assert.match(finalRollback, /rollback "\$PREVIOUS_VERSION_ID"/);
  assert.match(finalRollback, /SMOKE_REQUIRE_SESSION_EPOCH_COMPAT: "1"/);
  assert.match(finalRollback, /deployment-rollback\.json[\s\S]*test "\$ROLLED_BACK_VERSION_ID" = "\$PREVIOUS_VERSION_ID"/);
  assert.match(finalRollback, /rollback-smoke\.txt/);
});

test("증빙을 tee로 보존하는 CI와 배포 단계는 원 명령의 실패를 전파한다", () => {
  assert.match(ci, /set -o pipefail\s+npm run deploy:dry 2>&1 \| tee/);
  for (const command of [
    "npm run deploy:dry",
    "npm run db:migrate:remote",
    "node scripts/deploy-guarded.mjs",
    "npm run smoke:release"
  ]) {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(deploy, new RegExp(`set -o pipefail\\s+${escaped}[^\\n]*\\| tee`), command);
  }
  assert.match(deploy, /set -o pipefail[\s\S]*npx wrangler rollback "\$PREVIOUS_VERSION_ID"[^\n]*[\s\S]*\| tee release-evidence\/rollback\.txt/);
  assert.doesNotMatch(deploy, /npx wrangler d1 migrations apply hanlim-archive --remote/);
  assert.doesNotMatch(deploy, /set -o pipefail\s+npx wrangler deploy/);
});

test("npm test는 생성 보고서가 아니라 tests 디렉터리만 실행한다", () => {
  assert.equal(packageJson.scripts.test, "node --test tests/*.test.js");
  assert.equal(packageJson.scripts["test:coverage"], "node --test --experimental-test-coverage tests/*.test.js");
});

test("독립 Admin provisioning은 수동 production Environment 승인과 guarded script만 사용한다", () => {
  assert.match(provisionAdmin, /workflow_dispatch/);
  assert.match(provisionAdmin, /environment:\s+name: production/);
  assert.match(provisionAdmin, /npm run admin:provision:remote/);
  assert.match(provisionAdmin, /npm run admin:check:remote/);
  assert.match(provisionAdmin, /ADMIN_PROVISION_PASSWORD: \$\{\{ secrets\.ADMIN_PROVISION_PASSWORD \}\}/);
  assert.match(provisionAdmin, /ADMIN_PROVISION_OPERATION_ID: github-run-\$\{\{ github\.run_id \}\}/);
  assert.doesNotMatch(provisionAdmin, /123456|nkh92@hanlim\.com/);
});

test("메인 Admin 보안 복구는 별도 secret·production 승인·독립 Admin 확인을 강제한다", () => {
  assert.match(remediateMainAdmin, /workflow_dispatch/);
  assert.match(remediateMainAdmin, /environment:\s+name: production/);
  assert.match(remediateMainAdmin, /npm run admin:check:remote/);
  assert.match(remediateMainAdmin, /npm run admin:remediate-main:remote/);
  assert.match(
    remediateMainAdmin,
    /MAIN_ADMIN_REMEDIATION_PASSWORD: \$\{\{ secrets\.MAIN_ADMIN_REMEDIATION_PASSWORD \}\}/
  );
  assert.match(
    remediateMainAdmin,
    /MAIN_ADMIN_REMEDIATION_OPERATION_ID: github-run-\$\{\{ github\.run_id \}\}/
  );
  assert.ok(
    remediateMainAdmin.indexOf("npm run admin:check:remote")
      < remediateMainAdmin.indexOf("npm run admin:remediate-main:remote")
  );
});

test("CODEOWNERS는 migration, security, audit, workflow 변경을 지정한다", () => {
  for (const path of ["/.github/workflows/", "/cloudflare-app/migrations/", "/cloudflare-app/src/platform/security/", "/cloudflare-app/src/domains/audit/"]) {
    assert.ok(owners.includes(path), path);
  }
});
