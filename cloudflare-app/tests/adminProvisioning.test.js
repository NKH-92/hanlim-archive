import assert from "node:assert/strict";
import test from "node:test";

import { adminReadinessSql, evaluateAdminReadiness } from "../scripts/check-admin-readiness.mjs";
import { buildAdminProvisionSql, preflightAdminProvision } from "../scripts/provision-admin-guarded.mjs";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";

const PRODUCTION_ID = "1262ca00-b431-490c-aad2-539d77d4f73f";

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
  assert.equal(preflightAdminProvision({ ...base, username: "nkh92@hanlim.com" }).ok, false);
  assert.equal(preflightAdminProvision({ ...base, password: "short" }).ok, false);
  assert.equal(preflightAdminProvision({ ...base, confirmation: "PROVISION:production:wrong" }).ok, false);
});
