import { bytesToBase64Url } from "../platform/crypto/encoding.js";

const POLICIES = Object.freeze({
  pair: Object.freeze({ failLimit: 5, windowMinutes: 10, lockMinutes: 10 }),
  account: Object.freeze({ failLimit: 15, windowMinutes: 10, lockMinutes: 5 }),
  ip: Object.freeze({ failLimit: 30, windowMinutes: 10, lockMinutes: 15 }),
  global: Object.freeze({ failLimit: 300, windowMinutes: 5, lockMinutes: 5 })
});

export function loginThrottleContext(request, username) {
  const normalizedUsername = String(username ?? "").trim().toLowerCase().slice(0, 320);
  const clientAddress = String(request?.headers?.get?.("CF-Connecting-IP") || "unknown")
    .trim()
    .toLowerCase()
    .slice(0, 128) || "unknown";
  return { normalizedUsername, clientAddress };
}

export async function isLoginLocked(env, identity, { nowIso = null } = {}) {
  if (typeof identity === "string") return isLegacyLocked(env, identity, nowIso);
  // 전역 실패량은 관측·용량 제어용으로만 기록한다. 이를 로그인 거부 조건으로
  // 사용하면 단일 공격자가 임계값만 채워 모든 정상 사용자를 잠글 수 있다.
  const buckets = (await throttleBuckets(env, identity))
    .filter(({ scope }) => scope !== "global");
  const placeholders = buckets.map(() => "?").join(", ");
  const binds = buckets.map(({ key }) => key);
  let timeClause = "locked_until > datetime('now')";
  if (nowIso) {
    timeClause = "locked_until > ?";
    binds.push(nowIso);
  }
  try {
    const row = await env.DB.prepare(`
      SELECT bucket_key
      FROM login_throttle_v2
      WHERE bucket_key IN (${placeholders})
        AND locked_until IS NOT NULL
        AND ${timeClause}
      LIMIT 1
    `).bind(...binds).first();
    return Boolean(row);
  } catch (error) {
    if (!isMissingV2Table(error)) throw error;
    return isLegacyLocked(env, legacyIdentity(identity), nowIso);
  }
}

export async function recordLoginFailure(env, identity, { nowIso = null } = {}) {
  if (typeof identity === "string") return recordLegacyFailure(env, identity, nowIso);
  try {
    for (const bucket of await throttleBuckets(env, identity)) {
      await upsertBucket(env, bucket, nowIso);
    }
  } catch (error) {
    if (!isMissingV2Table(error)) throw error;
    await recordLegacyFailure(env, legacyIdentity(identity), nowIso);
  }
}

export async function clearLoginFailures(env, identity) {
  if (typeof identity === "string") {
    const key = legacyKey(identity);
    if (key) await env.DB.prepare("DELETE FROM login_throttle WHERE username = ?").bind(key).run();
    return;
  }
  const [pair, account] = await throttleBuckets(env, identity);
  try {
    await env.DB.prepare("DELETE FROM login_throttle_v2 WHERE bucket_key IN (?, ?)")
      .bind(pair.key, account.key)
      .run();
  } catch (error) {
    if (!isMissingV2Table(error)) throw error;
    await env.DB.prepare("DELETE FROM login_throttle WHERE username = ?")
      .bind(legacyIdentity(identity))
      .run();
  }
}

export async function cleanupLoginThrottle(env, { limit = 500 } = {}) {
  const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
  return env.DB.prepare(`
    DELETE FROM login_throttle_v2
    WHERE bucket_key IN (
      SELECT bucket_key
      FROM login_throttle_v2
      WHERE updated_at < datetime('now', '-24 hours')
        AND (locked_until IS NULL OR locked_until <= datetime('now'))
      ORDER BY updated_at
      LIMIT ?
    )
  `).bind(boundedLimit).run();
}

async function throttleBuckets(env, identity) {
  const username = String(identity?.normalizedUsername || "").trim().toLowerCase();
  const ip = String(identity?.clientAddress || "unknown").trim().toLowerCase() || "unknown";
  const materials = [
    ["pair", `${username}\0${ip}`],
    ["account", username],
    ["ip", ip],
    ["global", "all"]
  ];
  return Promise.all(materials.map(async ([scope, value]) => ({
    scope,
    key: await keyedDigest(env, `login:${scope}\0${value}`)
  })));
}

async function keyedDigest(env, value) {
  const secret = String(env.AUTH_HMAC_SECRET || env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("AUTH_HMAC_SECRET or SESSION_SECRET must be at least 32 characters.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function upsertBucket(env, bucket, nowIso) {
  const policy = POLICIES[bucket.scope];
  const now = nowIso || null;
  const nowSql = now ? "?" : "datetime('now')";
  const windowSql = now ? `datetime(?, '-${policy.windowMinutes} minutes')` : `datetime('now', '-${policy.windowMinutes} minutes')`;
  const lockSql = now ? `datetime(?, '+${policy.lockMinutes} minutes')` : `datetime('now', '+${policy.lockMinutes} minutes')`;
  const binds = [bucket.key, bucket.scope];
  if (now) binds.push(now);
  if (now) binds.push(now);
  if (now) binds.push(now);
  if (now) binds.push(now);
  if (now) binds.push(now);
  if (now) binds.push(now);
  if (now) binds.push(now);
  if (now) binds.push(now);
  await env.DB.prepare(`
    INSERT INTO login_throttle_v2 (
      bucket_key, scope, fail_count, window_started_at, locked_until, updated_at
    )
    VALUES (?, ?, 1, ${nowSql}, NULL, ${nowSql})
    ON CONFLICT (bucket_key) DO UPDATE SET
      fail_count = CASE
        WHEN window_started_at < ${windowSql} THEN 1
        ELSE fail_count + 1
      END,
      window_started_at = CASE
        WHEN window_started_at < ${windowSql} THEN ${nowSql}
        ELSE window_started_at
      END,
      locked_until = CASE
        WHEN window_started_at < ${windowSql} THEN NULL
        WHEN fail_count + 1 >= ${policy.failLimit} THEN ${lockSql}
        ELSE locked_until
      END,
      updated_at = ${nowSql}
  `).bind(...binds).run();
}

function legacyKey(username) {
  return String(username ?? "").trim().toLowerCase();
}

function legacyIdentity(identity) {
  return `${String(identity?.normalizedUsername || "").toLowerCase()}|${String(identity?.clientAddress || "unknown").toLowerCase()}`;
}

function isMissingV2Table(error) {
  return /no such table:\s*login_throttle_v2/i.test(String(error?.message || error));
}

async function isLegacyLocked(env, username, nowIso) {
  const key = legacyKey(username);
  if (!key) return false;
  const sql = nowIso
    ? "SELECT locked_until FROM login_throttle WHERE username = ? AND locked_until IS NOT NULL AND locked_until > ?"
    : "SELECT locked_until FROM login_throttle WHERE username = ? AND locked_until IS NOT NULL AND locked_until > datetime('now')";
  const row = await env.DB.prepare(sql).bind(...(nowIso ? [key, nowIso] : [key])).first();
  return Boolean(row);
}

async function recordLegacyFailure(env, username, nowIso) {
  const key = legacyKey(username);
  if (!key) return;
  const policy = POLICIES.pair;
  if (!nowIso) {
    await env.DB.prepare(`
      INSERT INTO login_throttle (username, fail_count, window_started_at, locked_until)
      VALUES (?, 1, datetime('now'), NULL)
      ON CONFLICT (username) DO UPDATE SET
        fail_count = CASE WHEN window_started_at < datetime('now', '-10 minutes') THEN 1 ELSE fail_count + 1 END,
        window_started_at = CASE WHEN window_started_at < datetime('now', '-10 minutes') THEN datetime('now') ELSE window_started_at END,
        locked_until = CASE
          WHEN window_started_at >= datetime('now', '-10 minutes') AND fail_count + 1 >= 5
            THEN datetime('now', '+10 minutes')
          ELSE locked_until
        END
    `).bind(key).run();
    return;
  }
  await env.DB.prepare(`
    INSERT INTO login_throttle (username, fail_count, window_started_at, locked_until)
    VALUES (?, 1, ?, NULL)
    ON CONFLICT (username) DO UPDATE SET
      fail_count = CASE WHEN window_started_at < datetime(?, '-10 minutes') THEN 1 ELSE fail_count + 1 END,
      window_started_at = CASE WHEN window_started_at < datetime(?, '-10 minutes') THEN ? ELSE window_started_at END,
      locked_until = CASE
        WHEN window_started_at < datetime(?, '-10 minutes') THEN NULL
        WHEN fail_count + 1 >= 5 THEN datetime(?, '+10 minutes')
        ELSE locked_until
      END
  `).bind(key, nowIso, nowIso, nowIso, nowIso, nowIso, nowIso).run();
  return policy;
}

export const LOGIN_THROTTLE_POLICY = Object.freeze({
  failLimit: POLICIES.pair.failLimit,
  windowMinutes: POLICIES.pair.windowMinutes,
  lockMinutes: POLICIES.pair.lockMinutes,
  scopes: POLICIES
});
