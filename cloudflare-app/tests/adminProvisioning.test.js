import assert from "node:assert/strict";
import test from "node:test";

import { adminReadinessSql, evaluateAdminReadiness } from "../scripts/check-admin-readiness.mjs";
import {
  buildAdminProvisionSql,
  preflightAdminProvision,
  runAdminProvision
} from "../scripts/provision-admin-guarded.mjs";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";

const PRODUCTION_ID = "1262ca00-b431-490c-aad2-539d77d4f73f";

const PROVISION_ENV_NAMES = [
  "CLOUDFLARE_ENV",
  "D1_PROVISION_ENV",
  "D1_TARGET_DATABASE_ID",
  "ADMIN_PROVISION_USERNAME",
  "ADMIN_PROVISION_DISPLAY_NAME",
  "ADMIN_PROVISION_PASSWORD",
  "ADMIN_PROVISION_CONFIRM",
  "ADMIN_PROVISION_OPERATION_ID"
];

function setProvisionEnv(overrides = {}) {
  const previous = Object.fromEntries(PROVISION_ENV_NAMES.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    CLOUDFLARE_ENV: "production",
    D1_PROVISION_ENV: "production",
    D1_TARGET_DATABASE_ID: PRODUCTION_ID,
    ADMIN_PROVISION_USERNAME: "release-admin@hanlim.internal",
    ADMIN_PROVISION_DISPLAY_NAME: "Release Admin",
    ADMIN_PROVISION_PASSWORD: "a-strong-password-2026",
    ADMIN_PROVISION_CONFIRM: `PROVISION:production:${PRODUCTION_ID}`,
    ADMIN_PROVISION_OPERATION_ID: "verification-marker",
    ...overrides
  });
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test("전체 migration 뒤 독립 Admin readiness는 fail-closed이고 guarded provisioning 후 통과한다", async () => {
  const database = await createMigratedDatabase();
  try {
    const before = database.prepare(adminReadinessSql("post-migration")).get();
    assert.deepEqual(evaluateAdminReadiness([{ results: [before] }]), { ok: false, approvedAdminCount: 0 });

    const sql = buildAdminProvisionSql({
      username: "break-glass-admin@hanlim.com",
      displayName: "비상 관리자",
      passwordRecord: { salt: "safe-salt", hash: "safe-hash" }
    });
    database.exec(sql);
    const after = database.prepare(adminReadinessSql("post-migration")).get();
    assert.deepEqual(evaluateAdminReadiness([{ results: [after] }]), { ok: true, approvedAdminCount: 1 });
    const admin = database.prepare(`
      SELECT status, role, can_manage_users, can_apply_document_snapshots,
             must_change_password, security_review_required
      FROM app_users WHERE username = 'break-glass-admin@hanlim.com'
    `).get();
    assert.deepEqual({ ...admin }, {
      status: "approved",
      role: "Admin",
      can_manage_users: 1,
      can_apply_document_snapshots: 0,
      must_change_password: 0,
      security_review_required: 0
    });
  } finally {
    database.close();
  }
});

test("Admin provisioning은 알려진 계정·약한 비밀번호·대상 불일치를 거부한다", () => {
  const base = {
    envName: "production",
    expectedDatabaseId: PRODUCTION_ID,
    username: "new-admin@hanlim.com",
    displayName: "관리자",
    password: "a-strong-password-2026",
    confirmation: `PROVISION:production:${PRODUCTION_ID}`
  };
  const valid = preflightAdminProvision(base);
  assert.equal(valid.ok, true);
  assert.doesNotMatch(JSON.stringify(valid), /a-strong-password-2026/);
  assert.equal(preflightAdminProvision({ ...base, password: "a1b2c3" }).ok, true);
  assert.equal(preflightAdminProvision({ ...base, username: "nkh92@hanlim.com" }).ok, false);
  assert.equal(preflightAdminProvision({ ...base, password: "short" }).ok, false);
  assert.equal(preflightAdminProvision({ ...base, confirmation: "PROVISION:production:wrong" }).ok, false);
});

test("guarded Admin provisioning verifies a unique marker after Wrangler bulk-file execution", async () => {
  const restoreEnv = setProvisionEnv();
  const calls = [];
  try {
    const result = await runAdminProvision({
      execPath: "node-runtime",
      spawn(command, args, options) {
        calls.push({ command, args, options });
        if (calls.length === 1) {
          return {
            status: 0,
            stdout: JSON.stringify([{ results: [{ username_count: 0, marker_count: 0, ready_count: 0 }] }])
          };
        }
        if (calls.length === 2) {
          return { status: 0, stdout: "Wrangler upload progress followed by a bulk summary" };
        }
        return { status: 0, stdout: JSON.stringify([{ results: [{ provisioned: 1 }] }]) };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.provisioned, 1);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].command, "node-runtime");
    assert.ok(calls[0].args.includes("--command"));
    assert.equal(calls[1].command, "node-runtime");
    assert.ok(calls[1].args.includes("--file"));
    assert.equal(calls[2].command, "node-runtime");
    assert.ok(calls[2].args.includes("--command"));
    const verificationSql = calls[2].args[calls[2].args.indexOf("--command") + 1];
    assert.match(verificationSql, /guarded-provisioning:verification-marker/);
    assert.doesNotMatch(verificationSql, /a-strong-password-2026/);
  } finally {
    restoreEnv();
  }
});

test("guarded Admin provisioning is idempotent for the same operation marker", async () => {
  const restoreEnv = setProvisionEnv();
  const calls = [];
  try {
    const result = await runAdminProvision({
      execPath: "node-runtime",
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return {
          status: 0,
          stdout: JSON.stringify([{ results: [{ username_count: 1, marker_count: 1, ready_count: 1 }] }])
        };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.idempotent, true);
    assert.equal(calls.length, 1);
  } finally {
    restoreEnv();
  }
});

test("guarded Admin provisioning rejects an operation marker owned by another username", async () => {
  const restoreEnv = setProvisionEnv();
  let callCount = 0;
  try {
    const result = await runAdminProvision({
      execPath: "node-runtime",
      spawn(command, args) {
        callCount += 1;
        const precheckSql = args[args.indexOf("--command") + 1];
        assert.match(
          precheckSql,
          /WHERE username = 'release-admin@hanlim\.internal'\s+OR approved_by = 'guarded-provisioning:verification-marker'/
        );
        return {
          status: 0,
          stdout: JSON.stringify([{ results: [{ username_count: 0, marker_count: 1, ready_count: 0 }] }])
        };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(callCount, 1);
    assert.match(result.errors[0], /OPERATION_ID/);
  } finally {
    restoreEnv();
  }
});

test("guarded Admin provisioning requires an explicit operation ID before remote access", async () => {
  const restoreEnv = setProvisionEnv({ ADMIN_PROVISION_OPERATION_ID: "" });
  let callCount = 0;
  try {
    const result = await runAdminProvision({
      spawn() {
        callCount += 1;
        return { status: 0, stdout: "[]" };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(callCount, 0);
    assert.match(result.errors[0], /OPERATION_ID/);
  } finally {
    restoreEnv();
  }
});

test("guarded Admin provisioning compensates a malformed verification response", async () => {
  const restoreEnv = setProvisionEnv();
  const calls = [];
  try {
    const result = await runAdminProvision({
      execPath: "node-runtime",
      spawn(command, args, options) {
        calls.push({ command, args, options });
        if (calls.length === 1) {
          return {
            status: 0,
            stdout: JSON.stringify([{ results: [{ username_count: 0, marker_count: 0, ready_count: 0 }] }])
          };
        }
        if (calls.length === 2) return { status: 0, stdout: "bulk summary" };
        if (calls.length === 3) return { status: 0, stdout: "not-json" };
        return {
          status: 0,
          stdout: JSON.stringify([{ results: [{ removed: 1 }] }, { results: [{ remaining: 0 }] }])
        };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.rolledBack, true);
    assert.equal(result.remoteStateUnknown, undefined);
    assert.equal(calls.length, 4);
  } finally {
    restoreEnv();
  }
});

test("guarded Admin provisioning reports recovery coordinates when compensation is uncertain", async () => {
  const restoreEnv = setProvisionEnv();
  let callCount = 0;
  try {
    const result = await runAdminProvision({
      execPath: "node-runtime",
      spawn() {
        callCount += 1;
        if (callCount === 1) {
          return {
            status: 0,
            stdout: JSON.stringify([{ results: [{ username_count: 0, marker_count: 0, ready_count: 0 }] }])
          };
        }
        if (callCount === 2) return { status: 0, stdout: "bulk summary" };
        return { status: 1, stdout: "" };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.remoteStateUnknown, true);
    assert.deepEqual(result.recovery, {
      username: "release-admin@hanlim.internal",
      operationId: "verification-marker"
    });
    assert.equal(callCount, 4);
  } finally {
    restoreEnv();
  }
});
