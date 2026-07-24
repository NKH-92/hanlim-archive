import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

import { preflightBackup } from "../scripts/backup-d1-to-r2.mjs";
import { replayMigrationExport } from "../scripts/replay-pending-migrations.mjs";
import { preflightSmokePrincipal } from "../scripts/release-smoke-principal.mjs";
import { preflightVersionRelease } from "../scripts/worker-version-release.mjs";

const CORE_ID = "1262ca00-b431-490c-aad2-539d77d4f73f";
const SEARCH_ID = "e9dc4469-30ca-47c7-ad01-6aa9aea0b3ac";

function releaseEnvironment(overrides = {}) {
  return {
    CLOUDFLARE_ENV: "production",
    D1_PROVISION_ENV: "production",
    D1_BACKUP_ENV: "production",
    D1_TARGET_DATABASE_ID: CORE_ID,
    SEARCH_D1_TARGET_DATABASE_ID: SEARCH_ID,
    WORKER_VERSION_TAG: `release-${"a".repeat(40)}`,
    WORKER_VERSION_MESSAGE: `release-sha:${"a".repeat(40)}`,
    WORKER_VERSION_OUTPUT_PATH: path.join(tmpdir(), "worker-version.json"),
    RELEASE_SMOKE_OPERATION_ID: "release-12345678-aaaaaaaaaaaa",
    RELEASE_SMOKE_CREDENTIAL_PATH: path.join(tmpdir(), "smoke.json"),
    R2_BACKUP_BUCKET: "hanlim-production-backups",
    R2_BACKUP_PREFIX: "predeploy",
    BACKUP_AGE_RECIPIENT: `age1${"q".repeat(58)}`,
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "12345678",
    BACKUP_RECEIPT_PATH: path.join(tmpdir(), "receipt.json"),
    BACKUP_REPLAY_REPORT_PATH: path.join(tmpdir(), "replay.json"),
    ...overrides
  };
}

test("version release preflight requires explicit upload, zero-traffic stage and promotion identities", () => {
  assert.equal(preflightVersionRelease({
    action: "upload",
    environment: releaseEnvironment()
  }).ok, true);
  assert.equal(preflightVersionRelease({
    action: "stage",
    environment: releaseEnvironment({
      WORKER_VERSION_ID: "12345678-1234-1234-1234-123456789abc",
      WORKER_PREVIOUS_VERSION_ID: "abcdefab-1234-1234-1234-123456789abc"
    })
  }).ok, true);
  assert.equal(preflightVersionRelease({
    action: "stage",
    environment: releaseEnvironment({
      WORKER_VERSION_ID: "12345678-1234-1234-1234-123456789abc"
    })
  }).ok, false);
  assert.equal(preflightVersionRelease({
    action: "promote",
    environment: releaseEnvironment({
      WORKER_VERSION_ID: "12345678-1234-1234-1234-123456789abc"
    })
  }).ok, true);
  assert.equal(preflightVersionRelease({
    action: "promote",
    environment: releaseEnvironment({ WORKER_VERSION_ID: "latest" })
  }).ok, false);
});

test("backup preflight binds both production D1 databases, R2, and age recipient", () => {
  assert.equal(preflightBackup(releaseEnvironment()).ok, true);
  assert.equal(preflightBackup(releaseEnvironment({
    SEARCH_D1_TARGET_DATABASE_ID: "00000000-0000-0000-0000-000000000000"
  })).ok, false);
  assert.equal(preflightBackup(releaseEnvironment({ BACKUP_AGE_RECIPIENT: "secret-passphrase" })).ok, false);
  assert.equal(preflightBackup(releaseEnvironment({ R2_BACKUP_PREFIX: "../escape" })).ok, false);
});

test("ephemeral smoke preflight rejects implicit targets and persistent credential output", () => {
  assert.equal(preflightSmokePrincipal({
    action: "provision",
    environment: releaseEnvironment()
  }).ok, true);
  assert.equal(preflightSmokePrincipal({
    action: "provision",
    environment: releaseEnvironment({ RELEASE_SMOKE_CREDENTIAL_PATH: "" })
  }).ok, false);
  assert.equal(preflightSmokePrincipal({
    action: "cleanup",
    environment: releaseEnvironment({ RELEASE_SMOKE_CREDENTIAL_PATH: "" })
  }).ok, true);
});

test("release smoke 계정은 TTL과 최소 사용자관리 권한만 가지며 다음 run이 누수를 정리한다", async () => {
  const source = await readFile(new URL("../scripts/release-smoke-principal.mjs", import.meta.url), "utf8");

  assert.match(source, /DELETE FROM app_users WHERE approved_by LIKE 'release-smoke:%'/);
  assert.equal(
    [...source.matchAll(/datetime\(CURRENT_TIMESTAMP, '\+45 minutes'\)/g)].length,
    2
  );
  assert.match(
    source,
    /'Release smoke manager'[\s\S]*?'User', 0,[\s\S]*?0, 0, 0, 0, 0, 1, 0, 0, CURRENT_TIMESTAMP/
  );
  assert.doesNotMatch(source, /'Release smoke manager'[\s\S]*?'Admin'/);
});

test("export clone replay applies the exact manifest suffix and rejects drift", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-replay-test-"));
  try {
    const migrationsDir = path.join(directory, "migrations");
    await mkdir(migrationsDir);
    const first = "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n";
    const second = "ALTER TABLE records ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;\n";
    const names = ["0001_initial.sql", "0002_revision.sql"];
    await Promise.all([
      writeFile(path.join(migrationsDir, names[0]), first),
      writeFile(path.join(migrationsDir, names[1]), second)
    ]);
    const checksum = (value) => createHash("sha256").update(value).digest("hex");
    const manifestPath = path.join(migrationsDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      checksums: {
        [names[0]]: checksum(first),
        [names[1]]: checksum(second)
      }
    }));
    const exportPath = path.join(directory, "export.sql");
    await writeFile(exportPath, `
      CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      INSERT INTO d1_migrations (name) VALUES ('0001_initial.sql');
      CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO records (value) VALUES ('kept');
    `);
    const replayed = await replayMigrationExport({
      sqlExportPath: exportPath,
      migrationsDir,
      manifestPath,
      label: "fixture"
    });
    assert.deepEqual(replayed.pendingReplayed, ["0002_revision.sql"]);
    assert.equal(replayed.appliedAfter, 2);
    assert.equal(replayed.foreignKeyViolations, 0);

    await writeFile(exportPath, `
      CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      INSERT INTO d1_migrations (name) VALUES ('9999_unknown.sql');
    `);
    await assert.rejects(
      replayMigrationExport({ sqlExportPath: exportPath, migrationsDir, manifestPath, label: "fixture" }),
      /not an exact local-manifest prefix/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration replay rejects a foreign-key violation that is repaired only by a later statement", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "migration-fk-replay-test-"));
  try {
    const migrationsDir = path.join(directory, "migrations");
    await mkdir(migrationsDir);
    const initial = "CREATE TABLE baseline (id INTEGER PRIMARY KEY);\n";
    const unsafe = [
      "INSERT INTO children (id, parent_id) VALUES (1, 7);",
      "INSERT INTO parents (id) VALUES (7);",
      ""
    ].join("\n");
    const checksum = (value) => createHash("sha256").update(value).digest("hex");
    const manifestPath = path.join(migrationsDir, "manifest.json");
    await Promise.all([
      writeFile(path.join(migrationsDir, "0001_initial.sql"), initial),
      writeFile(path.join(migrationsDir, "0002_unsafe_order.sql"), unsafe),
      writeFile(manifestPath, JSON.stringify({
        checksums: {
          "0001_initial.sql": checksum(initial),
          "0002_unsafe_order.sql": checksum(unsafe)
        }
      }))
    ]);
    const exportPath = path.join(directory, "export.sql");
    await writeFile(exportPath, `
      CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      INSERT INTO d1_migrations (name) VALUES ('0001_initial.sql');
      CREATE TABLE baseline (id INTEGER PRIMARY KEY);
      CREATE TABLE parents (id INTEGER PRIMARY KEY);
      CREATE TABLE children (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES parents(id)
      );
    `);

    await assert.rejects(
      replayMigrationExport({
        sqlExportPath: exportPath,
        migrationsDir,
        manifestPath,
        label: "foreign-key-fixture"
      }),
      /FOREIGN KEY constraint failed/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
