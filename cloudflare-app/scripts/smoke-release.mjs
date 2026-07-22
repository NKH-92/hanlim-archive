import { pathToFileURL } from "node:url";
import path from "node:path";

import { urlFor } from "../src/app/routeRegistry.js";

const HEALTH_ATTEMPTS = 15;
const HEALTH_RETRY_MS = 1_000;
export const ADMIN_SMOKE_PATH = urlFor("admin.settings");
const ADMIN_SETTINGS_MARKERS = Object.freeze([
  "<h1>사용자 관리</h1>",
  "가입 요청",
  "승인된 사용자"
]);

/**
 * smoke credential을 읽거나 전송하기 전에 대상 URL을 검증한다.
 * loopback만 http 허용, 그 외는 https + exact hostname allowlist.
 */
export function resolveSmokeTarget(baseUrl, {
  allowedHosts = defaultAllowedHosts()
} = {}) {
  const raw = String(baseUrl || "").trim();
  if (!raw) throw new Error("SMOKE_BASE_URL이 필요합니다.");

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SMOKE_BASE_URL이 올바른 URL이 아닙니다.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("SMOKE_BASE_URL에 사용자 정보를 포함할 수 없습니다.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("SMOKE_BASE_URL은 query/hash 없이 origin만 허용합니다.");
  }

  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  if (pathname) {
    throw new Error("SMOKE_BASE_URL은 path 없는 origin만 허용합니다.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  if (isLoopback) {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("loopback smoke URL은 http 또는 https만 허용합니다.");
    }
  } else {
    if (parsed.protocol !== "https:") {
      throw new Error("원격 smoke URL은 https만 허용합니다.");
    }
    const allow = new Set((allowedHosts || []).map((host) => String(host).toLowerCase()).filter(Boolean));
    if (!allow.has(hostname)) {
      throw new Error(`SMOKE_BASE_URL host가 allowlist에 없습니다: ${hostname}`);
    }
  }

  return Object.freeze({
    origin: parsed.origin,
    hostname,
    protocol: parsed.protocol
  });
}

function defaultAllowedHosts() {
  const raw = String(process.env.SMOKE_ALLOWED_HOSTS || "").trim();
  if (!raw) return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

export async function runReleaseSmoke({
  baseUrl,
  username,
  password,
  adminUsername = "",
  adminPassword = "",
  requireAdmin = false,
  requireSessionEpochCompatibility = false,
  expectedWorkerVersion = "",
  allowedHosts,
  fetchImpl = fetch,
  waitImpl = wait
}) {
  // credential을 검사·전송하기 전에 URL을 먼저 검증한다.
  const target = resolveSmokeTarget(baseUrl, { allowedHosts });
  if (!username || !password) throw new Error("SMOKE_USERNAME, SMOKE_PASSWORD가 필요합니다.");
  if (requireAdmin && (!adminUsername || !adminPassword)) {
    throw new Error("관리자 smoke에는 SMOKE_ADMIN_USERNAME, SMOKE_ADMIN_PASSWORD가 필요합니다.");
  }

  const origin = target.origin;
  let health;
  let healthBody = null;
  let healthOk = false;
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    health = await fetchImpl(`${origin}/healthz`, { redirect: "manual" });
    if (health.status === 200) {
      healthBody = await health.clone().json().catch(() => null);
      const compatibilityReady = !requireSessionEpochCompatibility
        || healthBody?.rollbackCompatibility?.sessionEpoch === 1;
      const versionReady = !expectedWorkerVersion || healthBody?.workerVersion === expectedWorkerVersion;
      if (healthBody?.ok && compatibilityReady && versionReady) {
        healthOk = true;
        break;
      }
    }
    if (attempt < HEALTH_ATTEMPTS) await waitImpl(HEALTH_RETRY_MS);
  }
  if (
    !healthOk
    && requireSessionEpochCompatibility
    && healthBody?.ok
    && healthBody?.rollbackCompatibility?.sessionEpoch !== 1
  ) {
    throw new Error("현재 Worker는 session-epoch rollback 호환성을 선언하지 않습니다. 호환 Worker를 먼저 배포하세요.");
  }
  if (!healthOk && expectedWorkerVersion && healthBody?.ok) {
    throw new Error(`Worker version smoke 실패(expected=${expectedWorkerVersion})`);
  }
  if (!healthOk) throw new Error(`/healthz smoke 실패(status=${health?.status ?? "none"})`);
  if (requireSessionEpochCompatibility && healthBody?.rollbackCompatibility?.sessionEpoch !== 1) {
    throw new Error("현재 Worker는 session-epoch rollback 호환성을 선언하지 않습니다. 호환 Worker를 먼저 배포하세요.");
  }

  const login = await fetchImpl(`${origin}/login`, { redirect: "manual" });
  if (login.status !== 200 || !(await login.text()).includes('name="username"')) throw new Error("/login smoke 실패");

  const signup = await fetchImpl(`${origin}/signup`, { redirect: "manual" });
  if (signup.status !== 404) throw new Error("/signup 404 계약 실패");

  const cookie = await authenticateSmokeUser({ origin, username, password, returnUrl: "/app?q=release-smoke", label: "smoke 계정", fetchImpl });

  const search = await fetchImpl(`${origin}/app?q=release-smoke`, {
    headers: { Cookie: cookie },
    redirect: "manual"
  });
  const html = await search.text();
  if (search.status !== 200 || !html.includes("data-viewer-app")) throw new Error("인증 read-only 검색 smoke 실패");

  const summary = { health: health.status, login: login.status, signup: signup.status, search: search.status, origin };
  if (requireSessionEpochCompatibility) summary.sessionEpochCompatibility = 1;
  if (expectedWorkerVersion) summary.workerVersion = healthBody.workerVersion;
  if (requireAdmin) {
    const adminCookie = await authenticateSmokeUser({
      origin,
      username: adminUsername,
      password: adminPassword,
      returnUrl: ADMIN_SMOKE_PATH,
      label: "관리자 smoke 계정",
      fetchImpl
    });
    const adminResponse = await fetchImpl(`${origin}${ADMIN_SMOKE_PATH}`, {
      headers: { Cookie: adminCookie },
      redirect: "manual"
    });
    const adminHtml = await adminResponse.text();
    if (adminResponse.status !== 200 || !ADMIN_SETTINGS_MARKERS.every((marker) => adminHtml.includes(marker))) {
      throw new Error(`관리자 설정 접근 smoke 실패(status=${adminResponse.status})`);
    }
    summary.adminSettings = adminResponse.status;
  }

  return Object.freeze(summary);
}

async function authenticateSmokeUser({ origin, username, password, returnUrl, label, fetchImpl }) {
  const form = new FormData();
  form.set("username", username);
  form.set("password", password);
  form.set("returnUrl", returnUrl);
  const authenticated = await fetchImpl(`${origin}/login`, {
    method: "POST",
    headers: { Origin: origin },
    body: form,
    redirect: "manual"
  });
  if (![302, 303].includes(authenticated.status)) {
    const ray = authenticated.headers.get("cf-ray") || "none";
    throw new Error(`${label} 로그인 실패(status=${authenticated.status}, cf-ray=${ray})`);
  }
  const location = authenticated.headers.get("location") || "";
  if (location.startsWith("/account/password")) throw new Error(`${label}은 최초 비밀번호 변경이 완료되어야 합니다.`);
  const cookie = (authenticated.headers.get("set-cookie") || "").split(";", 1)[0];
  if (!cookie) throw new Error(`${label} session cookie가 없습니다.`);
  return cookie;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runReleaseSmoke({
    baseUrl: process.env.SMOKE_BASE_URL,
    username: process.env.SMOKE_USERNAME,
    password: process.env.SMOKE_PASSWORD,
    adminUsername: process.env.SMOKE_ADMIN_USERNAME,
    adminPassword: process.env.SMOKE_ADMIN_PASSWORD,
    requireAdmin: process.env.SMOKE_REQUIRE_ADMIN === "1",
    requireSessionEpochCompatibility: process.env.SMOKE_REQUIRE_SESSION_EPOCH_COMPAT === "1",
    expectedWorkerVersion: process.env.SMOKE_EXPECTED_WORKER_VERSION || ""
  });
  console.log(`✓ release smoke 통과: ${JSON.stringify(result)}`);
}
