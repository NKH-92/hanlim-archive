import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const deploy = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const backup = await readFile(new URL("../../.github/workflows/d1-backup.yml", import.meta.url), "utf8");
const provisionAdmin = await readFile(new URL("../../.github/workflows/provision-admin.yml", import.meta.url), "utf8");
const remediateMainAdmin = await readFile(new URL("../../.github/workflows/remediate-main-admin.yml", import.meta.url), "utf8");
const owners = await readFile(new URL("../../.github/CODEOWNERS", import.meta.url), "utf8");
const smokeRelease = await readFile(new URL("../scripts/smoke-release.mjs", import.meta.url), "utf8");
const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
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
  assert.match(
    deploy,
    /push:\s+branches: \[main\]\s+paths:\s+- "cloudflare-app\/\*\*"\s+- "\.github\/workflows\/deploy\.yml"/
  );
  assert.match(deploy, /workflow_dispatch: \{\}/);
  assert.doesNotMatch(deploy.slice(0, deploy.indexOf("permissions:")), /docs\/\*\*|README\.md/);

  const markers = [
    "name: production-backup",
    "Export, replay pending migrations, encrypt, and upload both D1 databases",
    "Upload non-sensitive backup receipt",
    "name: approved production release",
    "Enforce production release from main",
    "Verify independent administrator before migration",
    "Verify independent administrator login before migration",
    "Enforce epoch-aware rollback target before database mutation",
    "Download verified R2 backup receipt",
    "Enforce backup and migration replay receipt",
    "Apply D1 migrations",
    "Verify independent administrator after migration",
    "Upload and stage immutable Worker version at zero traffic",
    "Smoke zero-traffic Worker version through canonical production route",
    "Promote verified Worker version to 100 percent production traffic",
    "Post-deploy transport, assets, login and read-only search smoke",
    "Roll back Worker after release failure",
    "Upload release evidence"
  ];
  let previous = -1;
  for (const marker of markers) {
    const current = deploy.indexOf(marker);
    assert.ok(current > previous, marker);
    previous = current;
  }
  assert.match(deploy, /name: Upload and stage immutable Worker version at zero traffic\s+id: deploy_worker\s+continue-on-error: true/);
  assert.match(deploy, /name: Capture deployed Worker version\s+id: capture_deployed\s+if: steps\.promote_worker\.outcome == 'success'\s+continue-on-error: true/);
  assert.match(deploy, /id: smoke\s+if: steps\.deploy_worker\.outcome == 'success' && steps\.capture_deployed\.outcome == 'success'\s+continue-on-error: true/);
  assert.match(deploy, /always\(\) && \(steps\.deploy_worker\.outcome == 'failure' \|\|[\s\S]*steps\.version_smoke\.outcome == 'failure'[\s\S]*steps\.promote_worker\.outcome == 'failure'[\s\S]*steps\.smoke\.outcome == 'failure'\)/);
  assert.match(deploy, /if: always\(\)/);
  assert.match(deploy, /wrangler deployments status --env production --json/);
  assert.match(deploy, /select\(\.percentage == 100\).*\.version_id/);
  assert.match(deploy, /versions view "\$DEPLOYED_VERSION_ID" --env production --json/);
  assert.match(deploy, /test "\$DEPLOYED_VERSION_ID" != "\$PREVIOUS_VERSION_ID"/);
  assert.match(deploy, /\.annotations\["workers\/tag"\] == \$tag and \.annotations\["workers\/message"\] == \$message/);
  assert.match(deploy, /SMOKE_EXPECTED_WORKER_VERSION="\$DEPLOYED_VERSION_ID"/);
  assert.match(deploy, /Post-deploy transport, assets, login and read-only search smoke[\s\S]*SMOKE_HEALTH_ATTEMPTS: "60"[\s\S]*SMOKE_HEALTH_RETRY_MS: "2000"/);
  assert.match(deploy, /Post-deploy transport, assets, login and read-only search smoke[\s\S]*SMOKE_VERIFY_PUBLIC_SURFACE: "1"/);
  assert.match(smokeRelease, /verifyPublicSurface: process\.env\.SMOKE_VERIFY_PUBLIC_SURFACE === "1"/);
  assert.doesNotMatch(smokeRelease, /verifyPublicSurface: true/);
  assert.match(deploy, /verify_legacy_tls_blocked --tlsv1\.0 1\.0/);
  assert.match(deploy, /verify_legacy_tls_blocked --tlsv1\.1 1\.1/);
  assert.match(deploy, /\} 2>&1 \| tee -a release-evidence\/smoke\.txt/);
  assert.doesNotMatch(deploy, /versions list --json > release-evidence\/versions-before\.json/);
  assert.ok((deploy.match(/set -o pipefail/g)?.length || 0) >= 10);
  assert.doesNotMatch(deploy, /123456|SESSION_SECRET/);
  assert.match(
    deploy,
    /outputs:[\s\S]*artifact_id: \$\{\{ steps\.receipt\.outputs\['artifact-id'\] \}\}[\s\S]*artifact_digest: \$\{\{ steps\.receipt\.outputs\['artifact-digest'\] \}\}[\s\S]*needs\.backup\.outputs\.artifact_id[\s\S]*needs\.backup\.outputs\.artifact_digest/
  );
  assert.doesNotMatch(deploy, /\.outputs\.[A-Za-z0-9_]+-[A-Za-z0-9_-]+/);
  assert.match(deploy, /D1_MIGRATE_APPROVAL_CONTEXT: github-environment:production:\$\{\{ github\.run_id \}\}:\$\{\{ github\.sha \}\}/);
  assert.match(deploy, /npm run backup:d1:r2/);
  assert.match(deploy, /migration-replay\.json[\s\S]*pendingReplayed[\s\S]*Apply D1 migrations/);
  assert.doesNotMatch(deploy, /D1_BACKUP_PASSPHRASE|secrets\.SMOKE_/);
  assert.match(deploy, /versions upload|release:worker-version -- --action upload/);
  assert.match(deploy, /release:worker-version -- --action promote/);
  assert.match(deploy, /release:worker-version -- --action stage/);
  assert.match(deploy, /SMOKE_WORKER_VERSION_OVERRIDE_NAME: hanlim-archive/);
  assert.match(deploy, /SMOKE_WORKER_VERSION_OVERRIDE_ID="\$DEPLOYED_VERSION_ID"/);
  assert.doesNotMatch(deploy, /WORKER_PREVIEW_ALIAS|PREVIEW_URL|--preview-alias/);
  assert.match(deploy, /SMOKE_REQUIRE_READINESS: "1"/);
  assert.match(deploy, /Remove release-scoped smoke principals[\s\S]*if: always\(\)/);
  assert.match(deploy, /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]/);
  assert.match(deploy, /Verify released migrations against release base[\s\S]*check-released-baseline-history\.mjs --base-ref "\$RELEASED_BASE_SHA"/);
  assert.match(deploy, /PRODUCTION_URL: https:\/\/hanlim-archive\.skarhkdgus7\.workers\.dev[\s\S]*SMOKE_ALLOWED_HOSTS: hanlim-archive\.skarhkdgus7\.workers\.dev/);
  assert.ok((deploy.match(/SMOKE_REQUIRE_ADMIN: "1"/g)?.length || 0) >= 5);
  assert.ok((deploy.match(/SMOKE_REQUIRE_SESSION_EPOCH_COMPAT: "1"/g)?.length || 0) >= 4);
  assert.ok((deploy.match(/npm run smoke:release/g)?.length || 0) >= 6);

  const preMigrationSmoke = deploy.slice(
    deploy.indexOf("Verify independent administrator login before migration"),
    deploy.indexOf("Download verified R2 backup receipt")
  );
  for (const envName of ["SMOKE_BASE_URL", "SMOKE_USERNAME", "SMOKE_PASSWORD", "SMOKE_ADMIN_USERNAME", "SMOKE_ADMIN_PASSWORD", "SMOKE_REQUIRE_ADMIN"]) {
    assert.ok(preMigrationSmoke.includes(envName), envName);
  }
  assert.match(preMigrationSmoke, /npm run smoke:release 2>&1 \| tee release-evidence\/pre-migration-admin-smoke\.txt/);
});

test("backup과 release token은 최소 job·step scope에만 있고 DB ciphertext는 artifact에 올리지 않는다", () => {
  const deployJobStart = deploy.indexOf("\n  deploy:");
  const deployStepsStart = deploy.indexOf("\n    steps:", deployJobStart);
  const deployJobEnvironment = deploy.slice(deployJobStart, deployStepsStart);
  assert.doesNotMatch(deployJobEnvironment, /CLOUDFLARE_API_TOKEN/);
  assert.match(deploy, /name: production-backup[\s\S]*CLOUDFLARE_D1_BACKUP_API_TOKEN/);
  assert.match(deploy, /CLOUDFLARE_D1_MIGRATE_API_TOKEN/);
  assert.match(deploy, /CLOUDFLARE_WORKERS_DEPLOY_API_TOKEN/);
  assert.doesNotMatch(deploy, /secrets\.CLOUDFLARE_API_TOKEN|D1_BACKUP_PASSPHRASE|secrets\.SMOKE_/);
  assert.match(deploy, /Upload non-sensitive backup receipt[\s\S]*backup-receipt\.json[\s\S]*migration-replay\.json/);
  assert.doesNotMatch(deploy, /release-backup\/|\*\.sql|\*\.enc|\*\.age/);

  assert.match(backup, /npm run backup:d1:r2/);
  assert.match(backup, /SEARCH_D1_TARGET_DATABASE_ID/);
  assert.match(backup, /BACKUP_AGE_RECIPIENT/);
  assert.match(backup, /R2_BACKUP_BUCKET/);
  assert.doesNotMatch(backup, /D1_BACKUP_PASSPHRASE|openssl enc|backup-artifact|\*\.enc|\*\.age/);
});

test("기본 Wrangler 환경은 운영 Worker와 D1을 직접 가리키지 않고 production preview를 차단한다", () => {
  const topLevel = wrangler.slice(0, wrangler.indexOf('"env"'));
  assert.match(topLevel, /"name": "hanlim-archive-local"/);
  assert.match(topLevel, /"workers_dev": false/);
  assert.match(topLevel, /"preview_urls": false/);
  assert.doesNotMatch(topLevel, /1262ca00-b431-490c-aad2-539d77d4f73f/);
  assert.doesNotMatch(topLevel, /e9dc4469-30ca-47c7-ad01-6aa9aea0b3ac/);
  assert.match(
    wrangler,
    /"production": \{[\s\S]*"name": "hanlim-archive"[\s\S]*"workers_dev": true[\s\S]*"preview_urls": false/
  );
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
    deploy.indexOf("Download verified R2 backup receipt")
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
    "npm run release:worker-version -- --action upload",
    "npm run release:worker-version -- --action promote",
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
