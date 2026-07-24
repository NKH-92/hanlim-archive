import assert from "node:assert/strict";
import test from "node:test";

import { createPasswordRecord } from "../src/auth.js";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa
} from "../src/auth/mfa.js";
import { digestRecoveryCode } from "../src/auth/mfaCrypto.js";
import { totpAtCounter } from "../src/auth/totp.js";
import { bytesToBase64Url } from "../src/platform/crypto/encoding.js";
import { createMigratedDatabase } from "./helpers/migratedDatabase.js";
import { sqliteD1 } from "./helpers/sqliteD1.js";

test("동시 begin/confirm에서 enabled MFA를 pending으로 되돌리는 write race를 CAS가 차단한다", async () => {
  const fixture = await pendingFixture();
  try {
    let releaseBegin;
    let signalBegin;
    const beginReachedBatch = new Promise((resolve) => { signalBegin = resolve; });
    const allowBeginBatch = new Promise((resolve) => { releaseBegin = resolve; });
    const delayedDb = interceptDatabase(fixture.baseDb, {
      async beforeBatch(statements) {
        if (statements.some(({ sql }) => sql.includes("INSERT INTO user_mfa"))) {
          signalBegin();
          await allowBeginBatch;
        }
      }
    });
    const concurrentBegin = beginMfaEnrollment(
      { ...fixture.env, DB: delayedDb },
      fixture.session,
      { currentPassword: fixture.password }
    );
    await beginReachedBatch;

    const confirmed = await confirmPending(fixture);
    assert.equal(confirmed.ok, true);
    const enabledBefore = fixture.database.prepare(`
      SELECT status, encrypted_secret, last_totp_counter
      FROM user_mfa WHERE user_id = ?
    `).get(fixture.userId);
    const recoveryBefore = fixture.database.prepare(`
      SELECT code_digest FROM user_mfa_recovery_codes
      WHERE user_id = ? ORDER BY code_digest
    `).all(fixture.userId);
    releaseBegin();
    const beginResult = await concurrentBegin;

    assert.equal(beginResult.ok, false);
    assert.deepEqual({ ...fixture.database.prepare(`
      SELECT status, encrypted_secret, last_totp_counter
      FROM user_mfa WHERE user_id = ?
    `).get(fixture.userId) }, { ...enabledBefore });
    assert.deepEqual(fixture.database.prepare(`
      SELECT code_digest FROM user_mfa_recovery_codes
      WHERE user_id = ? ORDER BY code_digest
    `).all(fixture.userId), recoveryBefore);
  } finally {
    fixture.database.close();
  }
});

test("confirm이 읽은 pending secret은 concurrent begin 교체 뒤 활성화되지 않는다", async () => {
  const fixture = await pendingFixture();
  try {
    const pendingA = fixture.database.prepare(`
      SELECT encrypted_secret FROM user_mfa WHERE user_id = ?
    `).get(fixture.userId).encrypted_secret;
    let resumeConfirm;
    let signalConfirm;
    const confirmReadA = new Promise((resolve) => { signalConfirm = resolve; });
    const allowConfirm = new Promise((resolve) => { resumeConfirm = resolve; });
    const pausedEnv = {
      ...fixture.env,
      DB: interceptDatabase(fixture.baseDb, {
        async afterFirst(sql) {
          if (sql.includes("m.status = 'pending'")) {
            signalConfirm();
            await allowConfirm;
          }
        }
      })
    };
    const staleConfirm = confirmMfaEnrollment(pausedEnv, fixture.session, {
      currentPassword: fixture.password,
      code: await pendingCode(fixture)
    });
    await confirmReadA;

    const enrollmentB = await beginMfaEnrollment(
      fixture.env,
      fixture.session,
      { currentPassword: fixture.password }
    );
    assert.equal(enrollmentB.ok, true);
    const pendingB = fixture.database.prepare(`
      SELECT status, encrypted_secret, encryption_key_version
      FROM user_mfa WHERE user_id = ?
    `).get(fixture.userId);
    assert.equal(pendingB.status, "pending");
    assert.notEqual(pendingB.encrypted_secret, pendingA);

    resumeConfirm();
    const result = await staleConfirm;
    assert.equal(result.ok, false);
    assert.deepEqual({ ...fixture.database.prepare(`
      SELECT status, encrypted_secret, encryption_key_version
      FROM user_mfa WHERE user_id = ?
    `).get(fixture.userId) }, { ...pendingB });
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM user_mfa_recovery_codes WHERE user_id = ?
    `).get(fixture.userId).count, 0);
    assert.equal(fixture.database.prepare(`
      SELECT session_epoch FROM app_users WHERE id = ?
    `).get(fixture.userId).session_epoch, 0);
  } finally {
    fixture.database.close();
  }
});

test("이중 confirm은 두 요청이 pending을 읽어도 한 batch만 복구코드와 epoch를 확정한다", async () => {
  const fixture = await pendingFixture();
  try {
    const barrier = arrivalBarrier(2);
    const firstEnv = {
      ...fixture.env,
      DB: interceptDatabase(fixture.baseDb, {
        afterFirst: (sql) => sql.includes("m.status = 'pending'") ? barrier() : null
      })
    };
    const secondEnv = {
      ...fixture.env,
      DB: interceptDatabase(fixture.baseDb, {
        afterFirst: (sql) => sql.includes("m.status = 'pending'") ? barrier() : null
      })
    };
    const code = await pendingCode(fixture);
    const results = await Promise.all([
      confirmMfaEnrollment(firstEnv, fixture.session, {
        currentPassword: fixture.password,
        code
      }),
      confirmMfaEnrollment(secondEnv, fixture.session, {
        currentPassword: fixture.password,
        code
      })
    ]);

    assert.deepEqual(results.map(({ ok }) => ok).sort(), [false, true]);
    const winner = results.find(({ ok }) => ok);
    const expectedDigests = (await Promise.all(
      winner.recoveryCodes.map((code) => digestRecoveryCode(fixture.env, fixture.userId, code))
    )).sort();
    const storedDigests = fixture.database.prepare(`
      SELECT code_digest FROM user_mfa_recovery_codes
      WHERE user_id = ? ORDER BY code_digest
    `).all(fixture.userId).map(({ code_digest }) => code_digest);
    assert.equal(fixture.database.prepare("SELECT status FROM user_mfa WHERE user_id = ?").get(fixture.userId).status, "enabled");
    assert.deepEqual(storedDigests, expectedDigests);
    assert.equal(fixture.database.prepare("SELECT session_epoch FROM app_users WHERE id = ?").get(fixture.userId).session_epoch, 1);
  } finally {
    fixture.database.close();
  }
});

test("disable의 session_epoch CAS 실패는 factor claim, 복구코드 삭제, MFA 삭제를 모두 rollback한다", async () => {
  const fixture = await pendingFixture();
  try {
    const confirmed = await confirmPending(fixture);
    const before = fixture.database.prepare(`
      SELECT COUNT(*) AS count
      FROM user_mfa_recovery_codes
      WHERE user_id = ? AND used_at IS NULL
    `).get(fixture.userId).count;
    let injected = false;
    const racingDb = interceptDatabase(fixture.baseDb, {
      beforeBatch(statements) {
        if (!injected && statements.some(({ sql }) => sql.includes("DELETE FROM user_mfa WHERE"))) {
          injected = true;
          fixture.database.prepare(`
            UPDATE app_users SET session_epoch = session_epoch + 1 WHERE id = ?
          `).run(fixture.userId);
        }
      }
    });
    const result = await disableMfa(
      { ...fixture.env, DB: racingDb },
      { ...fixture.session, sessionEpoch: 1 },
      { currentPassword: fixture.password, code: confirmed.recoveryCodes[0] }
    );

    assert.equal(result.ok, false);
    assert.equal(fixture.database.prepare("SELECT status FROM user_mfa WHERE user_id = ?").get(fixture.userId).status, "enabled");
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) AS count
      FROM user_mfa_recovery_codes
      WHERE user_id = ? AND used_at IS NULL
    `).get(fixture.userId).count, before);
    assert.equal(fixture.database.prepare("SELECT session_epoch FROM app_users WHERE id = ?").get(fixture.userId).session_epoch, 2);
  } finally {
    fixture.database.close();
  }
});

test("폐기된 session epoch 요청은 MFA begin, confirm, disable을 변경하지 못한다", async () => {
  const fixture = await pendingFixture();
  try {
    fixture.database.prepare(`
      UPDATE app_users SET session_epoch = 1 WHERE id = ?
    `).run(fixture.userId);
    const staleBegin = await beginMfaEnrollment(
      fixture.env,
      fixture.session,
      { currentPassword: fixture.password }
    );
    assert.equal(staleBegin.ok, false);
    const staleConfirm = await confirmMfaEnrollment(fixture.env, fixture.session, {
      currentPassword: fixture.password,
      code: await pendingCode(fixture)
    });
    assert.equal(staleConfirm.ok, false);
    assert.equal(
      fixture.database.prepare("SELECT status FROM user_mfa WHERE user_id = ?").get(fixture.userId).status,
      "pending"
    );

    fixture.database.prepare(`
      UPDATE app_users SET session_epoch = 0 WHERE id = ?
    `).run(fixture.userId);
    const confirmed = await confirmPending(fixture);
    fixture.database.prepare(`
      UPDATE app_users SET session_epoch = 2 WHERE id = ?
    `).run(fixture.userId);
    const staleDisable = await disableMfa(
      fixture.env,
      { ...fixture.session, sessionEpoch: 1 },
      { currentPassword: fixture.password, code: confirmed.recoveryCodes[0] }
    );
    assert.equal(staleDisable.ok, false);
    assert.equal(
      fixture.database.prepare("SELECT status FROM user_mfa WHERE user_id = ?").get(fixture.userId).status,
      "enabled"
    );
  } finally {
    fixture.database.close();
  }
});

test("confirm 도중 enrollment가 만료되면 최종 CAS가 활성화를 거부한다", async () => {
  const fixture = await pendingFixture();
  try {
    let resumeConfirm;
    let signalConfirm;
    const pendingRead = new Promise((resolve) => { signalConfirm = resolve; });
    const allowConfirm = new Promise((resolve) => { resumeConfirm = resolve; });
    const pausedEnv = {
      ...fixture.env,
      DB: interceptDatabase(fixture.baseDb, {
        async afterFirst(sql) {
          if (sql.includes("m.pending_expires_at > datetime('now')")) {
            signalConfirm();
            await allowConfirm;
          }
        }
      })
    };
    const confirmation = confirmMfaEnrollment(pausedEnv, fixture.session, {
      currentPassword: fixture.password,
      code: await pendingCode(fixture)
    });
    await pendingRead;
    fixture.database.prepare(`
      UPDATE user_mfa
      SET pending_expires_at = datetime('now', '-1 second')
      WHERE user_id = ?
    `).run(fixture.userId);
    resumeConfirm();

    const result = await confirmation;
    assert.equal(result.ok, false);
    assert.equal(
      fixture.database.prepare("SELECT status FROM user_mfa WHERE user_id = ?").get(fixture.userId).status,
      "pending"
    );
  } finally {
    fixture.database.close();
  }
});

async function pendingFixture() {
  const database = await createMigratedDatabase();
  const password = "mfa-concurrency-password";
  const record = await createPasswordRecord(password);
  const inserted = database.prepare(`
    INSERT INTO app_users (
      username, display_name, password_salt, password_hash,
      status, approved_at, approved_by, role, session_epoch
    )
    VALUES (?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP, 'test', 'User', 0)
  `).run("mfa-race@hanlim.com", "MFA 경합", record.salt, record.hash);
  const userId = Number(inserted.lastInsertRowid);
  const baseDb = sqliteD1(database);
  const env = {
    DB: baseDb,
    SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    AUTH_HMAC_SECRET: "test-auth-hmac-secret-with-at-least-32-characters",
    MFA_ENCRYPTION_KEY_V1: bytesToBase64Url(new Uint8Array(32).fill(19))
  };
  const session = {
    userId,
    username: "mfa-race@hanlim.com",
    displayName: "MFA 경합",
    role: "User",
    sessionEpoch: 0
  };
  const enrollment = await beginMfaEnrollment(env, session, { currentPassword: password });
  assert.equal(enrollment.ok, true);
  return { database, baseDb, env, session, userId, password, secret: enrollment.secret };
}

async function pendingCode(fixture) {
  const counter = Math.floor(Date.now() / 1000 / 30) - 1;
  return totpAtCounter(fixture.secret, counter);
}

async function confirmPending(fixture) {
  return confirmMfaEnrollment(fixture.env, fixture.session, {
    currentPassword: fixture.password,
    code: await pendingCode(fixture)
  });
}

function interceptDatabase(base, { beforeBatch = null, afterFirst = null } = {}) {
  return {
    prepare(sql) {
      return wrapStatement(base.prepare(sql), sql);
    },
    async batch(statements) {
      if (beforeBatch) await beforeBatch(statements);
      return base.batch(statements);
    }
  };

  function wrapStatement(statement, sql) {
    return {
      sql: statement.sql,
      args: statement.args,
      bind(...args) {
        return wrapStatement(statement.bind(...args), sql);
      },
      async first() {
        const row = await statement.first();
        if (afterFirst) await afterFirst(sql);
        return row;
      },
      all: (...args) => statement.all(...args),
      run: (...args) => statement.run(...args)
    };
  }
}

function arrivalBarrier(target) {
  let arrived = 0;
  let release;
  const opened = new Promise((resolve) => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived === target) release();
    await opened;
  };
}
