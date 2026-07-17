const LOGIN_FAIL_LIMIT = 5;
const LOGIN_WINDOW_MINUTES = 10;
const LOGIN_LOCK_MINUTES = 10;

function throttleKey(username) {
  return String(username ?? "").trim().toLowerCase();
}

export async function isLoginLocked(env, username) {
  const key = throttleKey(username);
  if (!key) {
    return false;
  }

  const row = await env.DB.prepare(`
    SELECT locked_until
    FROM login_throttle
    WHERE username = ? AND locked_until IS NOT NULL AND locked_until > datetime('now')
  `).bind(key).first();

  return Boolean(row);
}

export async function recordLoginFailure(env, username) {
  const key = throttleKey(username);
  if (!key) {
    return;
  }

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
}

export async function clearLoginFailures(env, username) {
  const key = throttleKey(username);
  if (!key) {
    return;
  }

  await env.DB.prepare("DELETE FROM login_throttle WHERE username = ?").bind(key).run();
}
