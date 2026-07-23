import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { preflightRemoteMigrate } from "../scripts/migrate-remote-guarded.mjs";
import { preflightDeploy, runWranglerCaptured, runWranglerDeploy } from "../scripts/deploy-guarded.mjs";
import { verifyReleasedBaselineAgainstBase } from "../scripts/check-released-baseline-history.mjs";
import { applyExactTransforms, COMPATIBILITY_FILES } from "../scripts/apply-session-epoch-compat.mjs";

// Synthetic UUID: contract tests must not duplicate a real production D1 identifier.
const TEST_PRODUCTION_ID = "00000000-0000-4000-8000-000000000001";
const RELEASE_SHA = "a".repeat(40);
const BACKUP_DIGEST = "b".repeat(64);

function migrationEvidence(overrides = {}) {
  return {
    backupEvidenceId: "123456",
    backupEvidenceDigest: BACKUP_DIGEST,
    runId: "987654321",
    releaseSha: RELEASE_SHA,
    approvalContext: `github-environment:production:987654321:${RELEASE_SHA}`,
    ...overrides
  };
}

function baseConfig() {
  return {
    env: {
      staging: {
        d1_databases: [{ binding: "DB", database_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }]
      },
      production: {
        d1_databases: [{ binding: "DB", database_id: TEST_PRODUCTION_ID }]
      }
    }
  };
}

test("remote migrate는 env database_id 불일치·placeholder·누락 승인을 mutation 전에 거부한다", () => {
  const config = baseConfig();
  assert.equal(preflightRemoteMigrate({
    envName: "production",
    expectedDatabaseId: "11111111-2222-3333-4444-555555555555",
    ...migrationEvidence(),
    config
  }).ok, false);

  assert.equal(preflightRemoteMigrate({
    envName: "staging",
    expectedDatabaseId: "REPLACE_WITH_STAGING_D1_DATABASE_ID",
    ...migrationEvidence({ approvalContext: `github-environment:staging:987654321:${RELEASE_SHA}` }),
    config: {
      env: {
        staging: {
          d1_databases: [{ binding: "DB", database_id: "REPLACE_WITH_STAGING_D1_DATABASE_ID" }]
        }
      }
    }
  }).ok, false);

  assert.equal(preflightRemoteMigrate({
    envName: "production",
    expectedDatabaseId: TEST_PRODUCTION_ID,
    ...migrationEvidence({ backupEvidenceId: "invented-evidence", backupEvidenceDigest: "not-a-digest" }),
    config
  }).ok, false);

  const ok = preflightRemoteMigrate({
    envName: "production",
    expectedDatabaseId: TEST_PRODUCTION_ID,
    ...migrationEvidence(),
    dryRun: true,
    config
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.configuredId, TEST_PRODUCTION_ID);
  assert.equal(ok.backupEvidenceDigest, BACKUP_DIGEST);
  assert.equal(preflightRemoteMigrate({
    envName: "production",
    expectedDatabaseId: TEST_PRODUCTION_ID,
    ...migrationEvidence({ approvalContext: "approval-token-16+" }),
    config
  }).ok, false);
});

test("deploy preflight는 unscoped env와 staging placeholder를 거부한다", () => {
  assert.equal(preflightDeploy({ envName: "", config: baseConfig() }).ok, false);
  assert.equal(preflightDeploy({
    envName: "staging",
    config: {
      env: {
        staging: {
          d1_databases: [{ binding: "DB", database_id: "REPLACE_WITH_STAGING_D1_DATABASE_ID" }]
        }
      }
    }
  }).ok, false);

  const mismatch = preflightDeploy({
    envName: "production",
    expectedDatabaseId: "11111111-2222-3333-4444-555555555555",
    config: baseConfig()
  });
  assert.equal(mismatch.ok, false);

  const ok = preflightDeploy({
    envName: "production",
    expectedDatabaseId: TEST_PRODUCTION_ID,
    config: baseConfig()
  });
  assert.equal(ok.ok, true);

  assert.equal(preflightDeploy({
    envName: "production",
    expectedDatabaseId: TEST_PRODUCTION_ID,
    versionTag: "bad tag with spaces",
    config: baseConfig()
  }).ok, false);
  assert.equal(preflightDeploy({
    envName: "production",
    expectedDatabaseId: TEST_PRODUCTION_ID,
    versionMessage: "line one\nline two",
    config: baseConfig()
  }).ok, false);

  assert.equal(preflightDeploy({
    envName: "production",
    expectedDatabaseId: "",
    config: baseConfig()
  }).ok, false);
});

test("deploy wrapper는 Windows cmd shim 없이 설치된 Wrangler를 Node로 직접 실행한다", () => {
  const appRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
  const calls = [];
  const executed = runWranglerDeploy({
    appRoot,
    args: ["deploy", "--env", "production", "--dry-run"],
    environment: { TEST_DEPLOY_ENV: "1" },
    execPath: "node-runtime",
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });

  assert.equal(executed.status, 0);
  assert.equal(calls[0].command, "node-runtime");
  assert.match(calls[0].args[0], /node_modules[\\/]wrangler[\\/].*wrangler/i);
  assert.deepEqual(calls[0].args.slice(1), ["deploy", "--env", "production", "--dry-run"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, appRoot);
});

test("captured Wrangler wrapper uses the Node runtime without a Windows cmd shim", () => {
  const appRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
  const calls = [];
  const executed = runWranglerCaptured({
    appRoot,
    args: ["d1", "execute", "hanlim-archive", "--remote", "--json"],
    environment: { TEST_D1_ENV: "1" },
    execPath: "node-runtime",
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: "[]" };
    }
  });

  assert.equal(executed.status, 0);
  assert.equal(calls[0].command, "node-runtime");
  assert.match(calls[0].args[0], /node_modules[\\/]wrangler[\\/].*wrangler/i);
  assert.deepEqual(calls[0].args.slice(1), ["d1", "execute", "hanlim-archive", "--remote", "--json"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.encoding, "utf8");
  assert.equal(calls[0].options.cwd, appRoot);
});

test("migration released-baseline은 과거 SQL 변조·checksum 동시변조·삭제·개명을 거부한다", async () => {
  const { mkdtemp, mkdir, writeFile, cp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { verifyMigrationChain, hashMigrationSql } = await import("../scripts/check-migrations.mjs");

  const source = new URL("../migrations/", import.meta.url);
  const dir = await mkdtemp(join(tmpdir(), "mig-immut-"));
  try {
    await mkdir(dir, { recursive: true });
    const names = (await readdir(source)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const name of names) {
      await cp(new URL(name, source), join(dir, name));
    }
    await cp(new URL("manifest.json", source), join(dir, "manifest.json"));
    await cp(new URL("released-baseline.json", source), join(dir, "released-baseline.json"));

    const baseline = JSON.parse(await readFile(join(dir, "released-baseline.json"), "utf8"));
    assert.equal(Object.keys(baseline.checksums).at(-1), "0039_identity_security_remediation.sql");
    const first = Object.keys(baseline.checksums)[0];

    assert.equal((await verifyMigrationChain({ migrationsDir: dir, applySchema: false })).ok, true);

    const original = await readFile(join(dir, first), "utf8");
    await writeFile(join(dir, first), `${original}\n-- tamper\n`, "utf8");
    assert.equal((await verifyMigrationChain({ migrationsDir: dir, applySchema: false })).ok, false);
    await writeFile(join(dir, first), original, "utf8");

    const tampered = `${original}\n-- coedit\n`;
    await writeFile(join(dir, first), tampered, "utf8");
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    manifest.checksums[first] = hashMigrationSql(tampered);
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    const coedit = await verifyMigrationChain({ migrationsDir: dir, applySchema: false });
    assert.equal(coedit.ok, false);
    assert.ok(coedit.errors.some((error) => /baseline/.test(error)));
    await writeFile(join(dir, first), original, "utf8");
    await cp(new URL("manifest.json", source), join(dir, "manifest.json"));

    await rm(join(dir, first));
    assert.equal((await verifyMigrationChain({ migrationsDir: dir, applySchema: false })).ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("migration released-baseline은 누락·손상·비연속 prefix를 fail-closed한다", async () => {
  const { mkdtemp, mkdir, writeFile, cp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { verifyMigrationChain } = await import("../scripts/check-migrations.mjs");

  const source = new URL("../migrations/", import.meta.url);
  const dir = await mkdtemp(join(tmpdir(), "mig-baseline-required-"));
  try {
    await mkdir(dir, { recursive: true });
    const names = (await readdir(source)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const name of names) await cp(new URL(name, source), join(dir, name));
    await cp(new URL("manifest.json", source), join(dir, "manifest.json"));

    const missing = await verifyMigrationChain({ migrationsDir: dir, applySchema: false });
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((error) => /released-baseline/.test(error)));

    await writeFile(join(dir, "released-baseline.json"), "{not-json", "utf8");
    const malformed = await verifyMigrationChain({ migrationsDir: dir, applySchema: false });
    assert.equal(malformed.ok, false);

    const baseline = JSON.parse(await readFile(new URL("../migrations/released-baseline.json", import.meta.url), "utf8"));
    delete baseline.checksums["0002_app_users.sql"];
    await writeFile(join(dir, "released-baseline.json"), JSON.stringify(baseline), "utf8");
    const nonPrefix = await verifyMigrationChain({ migrationsDir: dir, applySchema: false });
    assert.equal(nonPrefix.ok, false);
    assert.ok(nonPrefix.errors.some((error) => /연속된 prefix/.test(error)));

    const tailTruncated = JSON.parse(await readFile(new URL("../migrations/released-baseline.json", import.meta.url), "utf8"));
    delete tailTruncated.checksums[tailTruncated.releasedThrough];
    await writeFile(join(dir, "released-baseline.json"), JSON.stringify(tailTruncated), "utf8");
    const missingTail = await verifyMigrationChain({ migrationsDir: dir, applySchema: false });
    assert.equal(missingTail.ok, false);
    assert.ok(missingTail.errors.some((error) => /releasedThrough/.test(error)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("released-baseline history gate rejects coordinated SQL and baseline edits", () => {
  const baseMigrations = {
    "0001_initial.sql": "CREATE TABLE example (id TEXT);\n",
    "0002_more.sql": "ALTER TABLE example ADD COLUMN name TEXT;\n"
  };
  const baseline = {
    version: 1,
    releasedThrough: "0002_more.sql",
    checksums: Object.fromEntries(
      Object.entries(baseMigrations).map(([name, sql]) => [
        name,
        createHash("sha256").update(sql).digest("hex")
      ])
    )
  };

  assert.equal(verifyReleasedBaselineAgainstBase({ currentBaseline: baseline, baseMigrations }).ok, true);

  const coedited = structuredClone(baseline);
  const changedSql = `${baseMigrations["0002_more.sql"]}-- rewritten\n`;
  coedited.checksums["0002_more.sql"] = createHash("sha256").update(changedSql).digest("hex");
  assert.equal(verifyReleasedBaselineAgainstBase({ currentBaseline: coedited, baseMigrations }).ok, false);

  const truncated = structuredClone(baseline);
  delete truncated.checksums["0002_more.sql"];
  truncated.releasedThrough = "0001_initial.sql";
  assert.equal(verifyReleasedBaselineAgainstBase({ currentBaseline: truncated, baseMigrations }).ok, false);
});

test("compatibility transform는 고정된 최소 파일과 exact-once context만 허용한다", () => {
  assert.deepEqual(COMPATIBILITY_FILES, [
    "src/auth/users.js",
    "src/auth/session.js",
    "src/auth/passwords.js",
    "src/handlers/sessionHandlers.js",
    "src/handlers/adminHandlers.js",
    "src/index.js",
    "wrangler.jsonc"
  ]);
  const transforms = [{ file: "probe.js", before: "before", after: "after" }];
  assert.equal(applyExactTransforms("const value = 'before';\n", transforms, "probe.js"), "const value = 'after';\n");
  assert.throws(() => applyExactTransforms("const value = 'missing';\n", transforms, "probe.js"), /exactly once/);
  assert.throws(() => applyExactTransforms("before before", transforms, "probe.js"), /exactly once/);
});

test("migration checksum은 CRLF를 LF로 정규화한다", async () => {
  const manifest = JSON.parse(await readFile(new URL("../migrations/manifest.json", import.meta.url), "utf8"));
  const names = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  assert.deepEqual(names, Object.keys(manifest.checksums));

  const first = names[0];
  const sql = await readFile(new URL(`../migrations/${first}`, import.meta.url), "utf8");
  const normalized = sql.replace(/\r\n/g, "\n");
  const good = createHash("sha256").update(normalized).digest("hex");
  assert.equal(good, manifest.checksums[first]);

  const crlf = createHash("sha256").update(normalized.replace(/\n/g, "\r\n")).digest("hex");
  assert.notEqual(crlf, good);
  assert.equal(createHash("sha256").update(normalized.replace(/\r\n/g, "\n")).digest("hex"), good);
});
