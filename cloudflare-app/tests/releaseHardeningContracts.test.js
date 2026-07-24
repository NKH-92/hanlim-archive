import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureD1Recovery,
  preflightD1Recovery,
  validateD1RecoveryEvidence
} from "../scripts/capture-d1-recovery.mjs";
import { preflightSmokePrincipal } from "../scripts/release-smoke-principal.mjs";

const CORE_ID = "1262ca00-b431-490c-aad2-539d77d4f73f";
const SEARCH_ID = "e9dc4469-30ca-47c7-ad01-6aa9aea0b3ac";
const RELEASE_SHA = "a".repeat(40);
const CORE_BOOKMARK = `00000001-00000002-00000003-${"a".repeat(32)}`;
const SEARCH_BOOKMARK = `00000004-00000005-00000006-${"b".repeat(32)}`;

function productionConfig(searchDatabaseId = SEARCH_ID) {
  return {
    env: {
      production: {
        d1_databases: [
          { binding: "DB", database_id: CORE_ID },
          { binding: "SEARCH_DB", database_id: searchDatabaseId }
        ]
      }
    }
  };
}

function releaseEnvironment(overrides = {}) {
  return {
    CLOUDFLARE_ENV: "production",
    D1_PROVISION_ENV: "production",
    D1_RECOVERY_ENV: "production",
    D1_TARGET_DATABASE_ID: CORE_ID,
    SEARCH_D1_TARGET_DATABASE_ID: SEARCH_ID,
    RELEASE_SMOKE_OPERATION_ID: "release-12345678-aaaaaaaaaaaa",
    RELEASE_SMOKE_CREDENTIAL_PATH: path.join(tmpdir(), "smoke.json"),
    D1_RECOVERY_EVIDENCE_PATH: path.join(tmpdir(), "d1-recovery.json"),
    GITHUB_SHA: RELEASE_SHA,
    GITHUB_RUN_ID: "12345678",
    ...overrides
  };
}

test("D1 recovery preflight binds both production databases and release identity", () => {
  assert.equal(preflightD1Recovery({
    environment: releaseEnvironment(),
    config: productionConfig()
  }).ok, true);
  assert.equal(preflightD1Recovery({
    environment: releaseEnvironment({ SEARCH_D1_TARGET_DATABASE_ID: CORE_ID }),
    config: productionConfig()
  }).ok, false);
  assert.equal(preflightD1Recovery({
    environment: releaseEnvironment({ GITHUB_SHA: "not-a-sha" }),
    config: productionConfig()
  }).ok, false);
  assert.equal(preflightD1Recovery({
    environment: releaseEnvironment({ D1_RECOVERY_EVIDENCE_PATH: "" }),
    config: productionConfig()
  }).ok, false);
});

test("D1 recovery captures both Time Travel bookmarks and rejects tampering", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "d1-recovery-test-"));
  try {
    const outputPath = path.join(directory, "recovery.json");
    const calls = [];
    const result = captureD1Recovery({
      environment: releaseEnvironment({ D1_RECOVERY_EVIDENCE_PATH: outputPath }),
      config: productionConfig(),
      execPath: "node-runtime",
      spawn(command, args, options) {
        calls.push({ command, args, options });
        const isSearch = args.includes("hanlim-archive-search-10k");
        return {
          status: 0,
          stdout: JSON.stringify({ bookmark: isSearch ? SEARCH_BOOKMARK : CORE_BOOKMARK })
        };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args.slice(-7), [
      "d1", "time-travel", "info", "hanlim-archive", "--env", "production", "--json"
    ]);
    assert.equal(calls[0].options.shell, false);

    const evidence = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(evidence.databases.core.databaseId, CORE_ID);
    assert.equal(evidence.databases.core.bookmark, CORE_BOOKMARK);
    assert.equal(evidence.databases.search.databaseId, SEARCH_ID);
    assert.equal(evidence.databases.search.bookmark, SEARCH_BOOKMARK);
    assert.equal(validateD1RecoveryEvidence(evidence, {
      envName: "production",
      coreDatabaseId: CORE_ID,
      searchDatabaseId: SEARCH_ID,
      releaseSha: RELEASE_SHA,
      runId: "12345678"
    }).ok, true);

    const tampered = structuredClone(evidence);
    tampered.databases.search.databaseId = CORE_ID;
    assert.equal(validateD1RecoveryEvidence(tampered, {
      envName: "production",
      coreDatabaseId: CORE_ID,
      searchDatabaseId: SEARCH_ID,
      releaseSha: RELEASE_SHA,
      runId: "12345678"
    }).ok, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("D1 recovery fails closed on an invalid Wrangler response", () => {
  const result = captureD1Recovery({
    environment: releaseEnvironment(),
    config: productionConfig(),
    spawn() {
      return { status: 0, stdout: JSON.stringify({ bookmark: "invalid" }) };
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /valid bookmark/);
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
