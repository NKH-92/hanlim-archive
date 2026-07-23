import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createPasswordRecord, validateUser } from "../src/auth.js";
import {
  buildMainAdminRemediationSql,
  MAIN_ADMIN_USERNAME,
  preflightMainAdminRemediation,
  runMainAdminRemediation
} from "../scripts/remediate-main-admin-guarded.mjs";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

const PRODUCTION_ID = "1262ca00-b431-490c-aad2-539d77d4f73f";
const OPERATION_ID = "github-run-87654321";
const TEMPORARY_PASSWORD = "a1b2c3";
const REMEDIATION_ENV_NAMES = [
  "CLOUDFLARE_ENV",
  "D1_MAIN_ADMIN_REMEDIATION_ENV",
  "D1_TARGET_DATABASE_ID",
  "MAIN_ADMIN_REMEDIATION_PASSWORD",
  "MAIN_ADMIN_REMEDIATION_CONFIRM",
  "MAIN_ADMIN_REMEDIATION_OPERATION_ID"
];

test("0039 전용 authorization은 격리된 메인 관리자만 새 credential로 복구한다", async () => {
  const database = await createMigratedDatabase();
  try {
    assert.throws(() => database.prepare(`
      UPDATE app_users
      SET
        status = 'approved',
        security_review_required = 0,
        role = 'Admin',
        approved_by = 'manual-bypass'
      WHERE username = ?
    `).run(MAIN_ADMIN_USERNAME), /dedicated remediation/);

    const passwordRecord = await createPasswordRecord(TEMPORARY_PASSWORD);
    database.exec(buildMainAdminRemediationSql({ passwordRecord, operationId: OPERATION_ID }));

    const account = database.prepare(`
      SELECT
        display_name,
        status,
        role,
        can_manage_users,
        can_apply_document_snapshots,
        must_change_password,
        security_review_required,
        session_epoch,
        approved_by,
        rejected_by
      FROM app_users
      WHERE username = ?
    `).get(MAIN_ADMIN_USERNAME);
    assert.deepEqual({ ...account }, {
      display_name: "메인 관리자",
      status: "approved",
      role: "Admin",
      can_manage_users: 1,
      can_apply_document_snapshots: 1,
      must_change_password: 1,
      security_review_required: 0,
      session_epoch: 2,
      approved_by: `security-remediation:${OPERATION_ID}`,
      rejected_by: null
    });
    const login = await validateUser(
      { SESSION_SECRET: "test-session-secret-with-at-least-32-characters", DB: sqliteD1(database) },
      MAIN_ADMIN_USERNAME,
      TEMPORARY_PASSWORD
    );
    assert.equal(login.role, "Admin");
    assert.equal(login.mustChangePassword, true);

    assert.throws(
      () => database.prepare(`
        UPDATE identity_security_remediations
        SET reason = 'tamper'
        WHERE operation_id = ?
      `).run(OPERATION_ID),
      /immutable/
    );
    assert.throws(
      () => database.prepare(`
        DELETE FROM identity_security_remediations
        WHERE operation_id = ?
      `).run(OPERATION_ID),
      /immutable/
    );
  } finally {
    database.close();
  }
});

test("메인 관리자 복구 preflight는 production·대상 확인을 강제하고 비밀번호를 반환하지 않는다", () => {
  const base = {
    envName: "production",
    expectedDatabaseId: PRODUCTION_ID,
    password: TEMPORARY_PASSWORD,
    confirmation: `REMEDIATE-MAIN-ADMIN:production:${PRODUCTION_ID}:${MAIN_ADMIN_USERNAME}`
  };
  const valid = preflightMainAdminRemediation(base);
  assert.equal(valid.ok, true);
  assert.ok(!JSON.stringify(valid).includes(TEMPORARY_PASSWORD));
  assert.equal(preflightMainAdminRemediation({ ...base, envName: "staging" }).ok, false);
  assert.equal(preflightMainAdminRemediation({ ...base, password: "12345" }).ok, false);
  assert.equal(preflightMainAdminRemediation({ ...base, confirmation: "wrong-target" }).ok, false);
});

test("guarded 메인 관리자 복구는 secret을 파일·로그 인자에 노출하지 않고 결과를 재조회한다", async () => {
  const restoreEnv = setRemediationEnv();
  const calls = [];
  try {
    const result = await runMainAdminRemediation({
      execPath: "node-runtime",
      spawn(command, args, options) {
        calls.push({ command, args, options });
        if (calls.length === 1) {
          return {
            status: 0,
            stdout: JSON.stringify([{
              results: [{
                username_count: 1,
                quarantined_count: 1,
                ready_count: 0,
                authorization_count: 0
              }]
            }])
          };
        }
        if (calls.length === 2) {
          const sqlPath = args[args.indexOf("--file") + 1];
          const sql = readFileSync(sqlPath, "utf8");
          assert.ok(!sql.includes(TEMPORARY_PASSWORD));
          assert.match(sql, /security-remediation:github-run-87654321/);
          return { status: 0, stdout: "bulk summary" };
        }
        return {
          status: 0,
          stdout: JSON.stringify([{ results: [{ remediated: 1 }] }])
        };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.remediated, 1);
    assert.equal(calls.length, 3);
    assert.ok(calls[0].args.includes("--command"));
    assert.ok(calls[1].args.includes("--file"));
    assert.ok(calls[2].args.includes("--command"));
    assert.ok(!JSON.stringify(calls.map(({ args }) => args)).includes(TEMPORARY_PASSWORD));
  } finally {
    restoreEnv();
  }
});

test("guarded 메인 관리자 복구는 이미 전용 복구가 완료된 계정을 덮어쓰지 않는다", async () => {
  const restoreEnv = setRemediationEnv();
  let callCount = 0;
  try {
    const result = await runMainAdminRemediation({
      execPath: "node-runtime",
      spawn() {
        callCount += 1;
        return {
          status: 0,
          stdout: JSON.stringify([{
            results: [{
              username_count: 1,
              quarantined_count: 0,
              ready_count: 1,
              authorization_count: 1
            }]
          }])
        };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.idempotent, true);
    assert.equal(callCount, 1);
  } finally {
    restoreEnv();
  }
});

function setRemediationEnv(overrides = {}) {
  const previous = Object.fromEntries(REMEDIATION_ENV_NAMES.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    CLOUDFLARE_ENV: "production",
    D1_MAIN_ADMIN_REMEDIATION_ENV: "production",
    D1_TARGET_DATABASE_ID: PRODUCTION_ID,
    MAIN_ADMIN_REMEDIATION_PASSWORD: TEMPORARY_PASSWORD,
    MAIN_ADMIN_REMEDIATION_CONFIRM: `REMEDIATE-MAIN-ADMIN:production:${PRODUCTION_ID}:${MAIN_ADMIN_USERNAME}`,
    MAIN_ADMIN_REMEDIATION_OPERATION_ID: OPERATION_ID,
    ...overrides
  });
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
