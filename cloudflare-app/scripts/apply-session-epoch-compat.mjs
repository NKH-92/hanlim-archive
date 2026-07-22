#!/usr/bin/env node
/**
 * Apply the smallest epoch-aware rollback compatibility change to the exact
 * pre-release Worker source. Every replacement is exact and fail-closed.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const COMPATIBILITY_FILES = Object.freeze([
  "src/auth/users.js",
  "src/auth/session.js",
  "src/auth/passwords.js",
  "src/handlers/sessionHandlers.js",
  "src/handlers/adminHandlers.js",
  "src/index.js",
  "wrangler.jsonc"
]);

const TRANSFORMS = Object.freeze([
  transform("src/auth/users.js", `
  const normalizedUsername = username.trim();

  const user = await env.DB.prepare(\`
`, `
  const normalizedUsername = username.trim();
  if (normalizedUsername.toLowerCase() === "nkh92@hanlim.com") return null;

  const user = await env.DB.prepare(\`
`),
  transform("src/auth/users.js", `
    SELECT username, display_name, password_salt, password_hash, status, role,
           must_change_password
`, `
    SELECT *
`),
  transform("src/auth/users.js", `
    role: normalizeRole(user.role),
    mustChangePassword: Number(user.must_change_password) === 1
`, `
    role: normalizeRole(user.role),
    mustChangePassword: Number(user.must_change_password) === 1,
    sessionEpoch: Number(user.session_epoch || 0)
`),
  transform("src/auth/session.js", `
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    if (!["Admin", "User"].includes(session.role)) {
`, `
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    if (String(session.username || "").toLowerCase() === "nkh92@hanlim.com") {
      return null;
    }

    if (!["Admin", "User"].includes(session.role)) {
`),
  transform("src/auth/session.js", `
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    csrfToken: createCsrfToken(),
`, `
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    sessionEpoch: readSessionEpoch(user.sessionEpoch ?? user.session_epoch),
    csrfToken: createCsrfToken(),
`),
  transform("src/auth/session.js", `
      SELECT
        id,
        username,
        display_name,
        status,
        role,
        must_change_password,
        can_manage_documents,
        can_move_documents,
        can_manage_disposals,
        can_manage_sets,
        can_manage_masters,
        can_manage_users,
        can_view_audit
      FROM app_users
`, `
      SELECT *
      FROM app_users
`),
  transform("src/auth/session.js", `
    if (!user || user.status !== "approved") {
      return null;
    }

    return {
`, `
    if (!user || user.status !== "approved") {
      return null;
    }

    const currentSessionEpoch = readSessionEpoch(user.session_epoch);
    if (readSessionEpoch(session.sessionEpoch) !== currentSessionEpoch) {
      return null;
    }

    return {
`),
  transform("src/auth/session.js", `
      role: normalizeRole(user.role),
      mustChangePassword: Number(user.must_change_password) === 1,
      ...permissionFlags(user)
`, `
      role: normalizeRole(user.role),
      mustChangePassword: Number(user.must_change_password) === 1,
      sessionEpoch: currentSessionEpoch,
      ...permissionFlags(user)
`),
  transform("src/auth/session.js", `
function createCsrfToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(CSRF_TOKEN_BYTES));
  return bytesToBase64Url(bytes);
}

async function sign(payload, env) {
`, `
function createCsrfToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(CSRF_TOKEN_BYTES));
  return bytesToBase64Url(bytes);
}

function readSessionEpoch(value) {
  const epoch = Number(value ?? 0);
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : 0;
}

async function sign(payload, env) {
`),
  transform("src/auth/passwords.js", `
    SELECT password_salt, password_hash
`, `
    SELECT *
`),
  transform("src/auth/passwords.js", `
  const record = await createPasswordRecord(newPassword);
  await env.DB.prepare(\`
    UPDATE app_users
    SET password_salt = ?,
        password_hash = ?,
        must_change_password = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE username = ?
  \`).bind(record.salt, record.hash, username).run();

  return { ok: true };
`, `
  const record = await createPasswordRecord(newPassword);
  const supportsSessionEpoch = Object.hasOwn(user, "session_epoch");
  const currentSessionEpoch = Number(user.session_epoch || 0);
  const nextSessionEpoch = currentSessionEpoch + 1;
  let updated;
  if (supportsSessionEpoch) {
    updated = await env.DB.prepare(\`
      UPDATE app_users
      SET password_salt = ?,
          password_hash = ?,
          must_change_password = 0,
          session_epoch = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE username = ? AND status = 'approved' AND session_epoch = ?
    \`).bind(record.salt, record.hash, nextSessionEpoch, username, currentSessionEpoch).run();
  } else {
    updated = await env.DB.prepare(\`
      UPDATE app_users
      SET password_salt = ?,
          password_hash = ?,
          must_change_password = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE username = ? AND status = 'approved'
    \`).bind(record.salt, record.hash, username).run();
  }

  if (Number(updated?.meta?.changes || 0) !== 1) {
    return { ok: false, message: "사용자 인증 상태가 변경되었습니다. 다시 로그인한 뒤 시도하세요." };
  }

  return { ok: true, sessionEpoch: supportsSessionEpoch ? nextSessionEpoch : 0 };
`),
  transform("src/handlers/sessionHandlers.js", `
export function handleLogout(url) {
  return redirect("/login", { "Set-Cookie": expiredSessionCookie(url.protocol === "https:") });
}
`, `
export async function handleLogout(url, env, session) {
  try {
    await env.DB.prepare(\`
      UPDATE app_users
      SET session_epoch = session_epoch + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE username = ? AND session_epoch = ?
    \`).bind(session.username, Number(session.sessionEpoch || 0)).run();
  } catch (error) {
    const message = String(error?.message || "");
    if (!/no such column:\\s*session_epoch/i.test(message)) throw error;
  }
  return redirect("/login", { "Set-Cookie": expiredSessionCookie(url.protocol === "https:") });
}
`),
  transform("src/handlers/adminHandlers.js", `
import { changeUserPassword } from "../auth.js";
`, `
import { changeUserPassword, createSessionCookie } from "../auth.js";
`),
  transform("src/handlers/adminHandlers.js", `
  if (session.mustChangePassword) {
    return redirect("/app?toast=password-changed");
  }

  return renderPasswordResult(session, { success: true });
`, `
  const refreshedSession = {
    ...session,
    mustChangePassword: false,
    sessionEpoch: result.sessionEpoch
  };
  const sessionCookie = await createSessionCookie(
    refreshedSession,
    env,
    new URL(request.url).protocol === "https:"
  );

  if (session.mustChangePassword) {
    return redirect("/app?toast=password-changed", { "Set-Cookie": sessionCookie });
  }

  return withSessionCookie(renderPasswordResult(refreshedSession, { success: true }), sessionCookie);
`),
  transform("src/handlers/adminHandlers.js", `
function renderPasswordResult(session, options = {}) {
  return passwordPage({ session, required: Boolean(session.mustChangePassword), ...options });
}
`, `
function renderPasswordResult(session, options = {}) {
  return passwordPage({ session, required: Boolean(session.mustChangePassword), ...options });
}

function withSessionCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
`),
  transform("src/index.js", `
    return handleLogout(url);
`, `
    return handleLogout(url, env, session);
`),
  transform("src/index.js", `
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
`, `
    const body = {
      ok: true,
      rollbackCompatibility: { sessionEpoch: 1 }
    };
    const workerVersion = String(env.CF_VERSION_METADATA?.id || "").trim();
    if (workerVersion) body.workerVersion = workerVersion;
    return new Response(JSON.stringify(body), { status: 200, headers });
`),
  transform("wrangler.jsonc", `
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "hanlim-archive",
      "database_id": "1262ca00-b431-490c-aad2-539d77d4f73f",
      "migrations_dir": "migrations"
    }
  ]
}
`, `
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "hanlim-archive",
      "database_id": "1262ca00-b431-490c-aad2-539d77d4f73f",
      "migrations_dir": "migrations"
    }
  ],
  "version_metadata": {
    "binding": "CF_VERSION_METADATA"
  },
  "env": {
    "production": {
      "name": "hanlim-archive",
      "version_metadata": {
        "binding": "CF_VERSION_METADATA"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "hanlim-archive",
          "database_id": "1262ca00-b431-490c-aad2-539d77d4f73f",
          "migrations_dir": "migrations"
        }
      ]
    }
  }
}
`)
]);

function transform(file, before, after) {
  return Object.freeze({ file, before: trimBoundary(before), after: trimBoundary(after) });
}

function trimBoundary(value) {
  return value.startsWith("\n") ? value.slice(1) : value;
}

export function applyExactTransforms(source, transforms, file) {
  let next = source.replace(/\r\n/g, "\n");
  for (const item of transforms.filter((candidate) => candidate.file === file)) {
    const first = next.indexOf(item.before);
    const second = first < 0 ? -1 : next.indexOf(item.before, first + item.before.length);
    if (first < 0 || second >= 0) {
      throw new Error(`${file}: compatibility transform context must occur exactly once`);
    }
    next = `${next.slice(0, first)}${item.after}${next.slice(first + item.before.length)}`;
  }
  return next;
}

export async function applySessionEpochCompatibility(appRoot) {
  const root = resolve(appRoot);
  const hashes = {};
  for (const file of COMPATIBILITY_FILES) {
    const path = resolve(root, file);
    if (!path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) {
      throw new Error(`compatibility path escaped app root: ${file}`);
    }
    const source = await readFile(path, "utf8");
    const output = applyExactTransforms(source, TRANSFORMS, file);
    await writeFile(path, output, "utf8");
    hashes[file] = createHash("sha256").update(output).digest("hex");
  }
  return Object.freeze({ files: [...COMPATIBILITY_FILES], hashes });
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const appRoot = readArgument("--app-root");
    if (!appRoot) throw new Error("--app-root is required");
    console.log(JSON.stringify(await applySessionEpochCompatibility(appRoot), null, 2));
  } catch (error) {
    console.error(`[session-epoch-compat] ${error.message}`);
    process.exit(1);
  }
}
