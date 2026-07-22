const LOGIN_FAIL_LIMIT = 5;
const LOGIN_WINDOW_MINUTES = 10;
const LOGIN_LOCK_MINUTES = 10;

function throttleKey(username) {
  return String(username ?? "").trim().toLowerCase();
}

export async function isLoginLocked(env, username, { nowIso = null } = {}) {
  const key = throttleKey(username);
  if (!key) {
    return false;
  }

  const binds = [key];
  let sql = `
    SELECT locked_until
    FROM login_throttle
    WHERE username = ? AND locked_until IS NOT NULL AND locked_until > datetime('now')
  `;
  if (nowIso) {
    sql = `
      SELECT locked_until
      FROM login_throttle
      WHERE username = ? AND locked_until IS NOT NULL AND locked_until > ?
    `;
    binds.push(nowIso);
  }

  const row = await env.DB.prepare(sql).bind(...binds).first();
  return Boolean(row);
}

export async function recordLoginFailure(env, username, { nowIso = null } = {}) {
  const key = throttleKey(username);
  if (!key) {
    return;
  }

  if (!nowIso) {
    await env.DB.prepare(`
      INSERT INTO login_throttle (username, fail_count, window_started_at, locked_until)
      VALUES (?, 1, datetime('now'), NULL)
      ON CONFLICT (username) DO UPDATE SET
        fail_count = CASE
          WHEN window_started_at < datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes') THEN 1
          ELSE fail_count + 1
        END,
        window_started_at = CASE
          WHEN window_started_at < datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes') THEN datetime('now')
          ELSE window_started_at
        END,
        locked_until = CASE
          WHEN window_started_at >= datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes')
            AND fail_count + 1 >= ${LOGIN_FAIL_LIMIT} THEN datetime('now', '+${LOGIN_LOCK_MINUTES} minutes')
          ELSE locked_until
        END
    `).bind(key).run();
    return;
  }

  // 테스트용 주입 clock: 동일 threshold/window/lock 계약을 결정적으로 검증한다.
  await env.DB.prepare(`
    INSERT INTO login_throttle (username, fail_count, window_started_at, locked_until)
    VALUES (?, 1, ?, NULL)
    ON CONFLICT (username) DO UPDATE SET
      fail_count = CASE
        WHEN window_started_at < datetime(?, '-${LOGIN_WINDOW_MINUTES} minutes') THEN 1
        ELSE fail_count + 1
      END,
      window_started_at = CASE
        WHEN window_started_at < datetime(?, '-${LOGIN_WINDOW_MINUTES} minutes') THEN ?
        ELSE window_started_at
      END,
      locked_until = CASE
        WHEN window_started_at < datetime(?, '-${LOGIN_WINDOW_MINUTES} minutes') THEN NULL
        WHEN fail_count + 1 >= ${LOGIN_FAIL_LIMIT} THEN datetime(?, '+${LOGIN_LOCK_MINUTES} minutes')
        ELSE locked_until
      END
  `).bind(key, nowIso, nowIso, nowIso, nowIso, nowIso, nowIso).run();
}

export async function clearLoginFailures(env, username) {
  const key = throttleKey(username);
  if (!key) {
    return;
  }

  await env.DB.prepare("DELETE FROM login_throttle WHERE username = ?").bind(key).run();
}

export const LOGIN_THROTTLE_POLICY = Object.freeze({
  failLimit: LOGIN_FAIL_LIMIT,
  windowMinutes: LOGIN_WINDOW_MINUTES,
  lockMinutes: LOGIN_LOCK_MINUTES
});
