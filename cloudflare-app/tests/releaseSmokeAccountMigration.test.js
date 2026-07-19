import assert from "node:assert/strict";
import test from "node:test";

import { createMigratedDatabase } from "./helpers/migratedDatabase.js";

test("배포 smoke 계정은 승인된 읽기 전용 User로만 provisioning된다", async () => {
  const database = await createMigratedDatabase();

  try {
    const user = database.prepare(`
      SELECT status, role, must_change_password,
             can_manage_documents, can_move_documents, can_manage_disposals,
             can_manage_sets, can_manage_masters, can_manage_users, can_view_audit
      FROM app_users
      WHERE username = 'release-smoke@hanlim.internal'
    `).get();

    assert.deepEqual({ ...user }, {
      status: "approved",
      role: "User",
      must_change_password: 0,
      can_manage_documents: 0,
      can_move_documents: 0,
      can_manage_disposals: 0,
      can_manage_sets: 0,
      can_manage_masters: 0,
      can_manage_users: 0,
      can_view_audit: 0
    });
  } finally {
    database.close();
  }
});
