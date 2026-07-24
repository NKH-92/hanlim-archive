// 엔트리포인트: 공개 경로와 공통 인증·보안 파이프라인만 담당한다.
import { cleanupExpiredReleaseSmokePrincipals, cleanupLoginThrottle, readSession } from "./auth.js";
import { cleanupPendingMfa } from "./auth/mfa.js";
import { errorPage, notFoundPage } from "./views/authViews.js";
import { withSecurityHeaders } from "./security.js";
import { routeAuthenticatedRequest } from "./handlers/authenticatedRouter.js";
import { handleLogin, handleLogout, renderLogin } from "./handlers/sessionHandlers.js";
import { handleMfaLogin, renderMfaLogin } from "./handlers/mfaHandlers.js";
import { handleReadinessCheck } from "./handlers/readinessHandlers.js";
import { normalizePath } from "./platform/http/routeMatcher.js";
import { redirect } from "./platform/http/responses.js";
import { headResponse, servePublicAsset } from "./platform/http/assets.js";
import { logError } from "./platform/observability/logger.js";
import { isValidCsrfToken } from "./platform/security/csrf.js";
import { isTrustedPostOrigin } from "./platform/security/origin.js";
import { enforceTransportSecurity } from "./platform/security/transport.js";
import {
  allowedMethodsForPath,
  resolveAuthenticatedRoute,
  resolvePublicRoute
} from "./app/routeRegistry.js";
import { createRequestD1Environment } from "./platform/d1/requestGateway.js";
import {
  processPendingSearchOutboxImmediately,
  processSearchOutbox,
  processSearchOutboxForDocuments,
  rebuildSearchIndexChunk
} from "./domains/search/index.js";

export default {
  async fetch(request, env) {
    const transportResponse = enforceTransportSecurity(request);
    if (transportResponse) return withSecurityHeaders(transportResponse, request);

    const reqId = shortRequestId();
    const requestEnv = createRequestD1Environment(env, { requestId: reqId });
    const effects = {
      async syncSearchDocument(documentId) {
        const searchEnv = createRequestD1Environment(env, { requestId: `${reqId}-search` });
        return processSearchOutboxForDocuments(searchEnv, [documentId]);
      },
      async syncSearchDocuments(documentIds) {
        const searchEnv = createRequestD1Environment(env, { requestId: `${reqId}-search` });
        return processSearchOutboxForDocuments(searchEnv, documentIds);
      },
      async syncPendingSearchDocuments(limit) {
        const searchEnv = createRequestD1Environment(env, { requestId: `${reqId}-search-batch` });
        return processPendingSearchOutboxImmediately(searchEnv, { limit });
      }
    };
    let response;
    try {
      response = await route(request, requestEnv, effects);
    } catch (error) {
      // 미처리 예외: 원시 오류 메시지를 사용자에게 노출하지 않는다(정보 노출 방지).
      // 상관용 짧은 reqId만 사용자에게 주고, 전체 오류는 서버 로그에만 남긴다.
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);
      const method = request.method === "HEAD" ? "GET" : request.method;
      const routeId = (resolvePublicRoute(path, method) || resolveAuthenticatedRoute(path, method))?.descriptor.id || "unmatched";
      logError("worker.fetch", error, { reqId, routeId, method: request.method, path });
      const session = await readSession(request, requestEnv).catch(() => null);
      response = errorPage(
        `처리 중 오류가 발생했습니다. 계속되면 관리자에게 오류코드 ${reqId} 를 알려주세요.`,
        session,
        500
      );
    }
    return withSecurityHeaders(response, request);
  },
  async scheduled(_controller, env, ctx) {
    const requestEnv = createRequestD1Environment(env, { requestId: `cron-${shortRequestId()}` });
    ctx.waitUntil(Promise.all([
      runSearchMaintenance(requestEnv),
      runAuthMaintenance(requestEnv)
    ]));
  }
};

async function runSearchMaintenance(env) {
  try {
    const outbox = await processSearchOutbox(env);
    const rebuild = await rebuildSearchIndexChunk(env);
    return { ok: outbox.ok !== false && rebuild.ok !== false, outbox, rebuild };
  } catch (error) {
    logError("worker.search-maintenance", error);
    throw error;
  }
}

function shortRequestId() {
  try {
    return crypto.randomUUID().split("-")[0];
  } catch {
    return "unknown";
  }
}

async function route(request, env, effects = {}) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const headOnly = request.method === "HEAD";
  const method = headOnly ? "GET" : request.method;

  if (request.method === "OPTIONS") {
    const allowed = allowedMethodsForPath(path);
    if (!allowed.length) return new Response(null, { status: 404 });
    return new Response(null, {
      status: 204,
      headers: { Allow: allowed.join(", ") }
    });
  }

  const publicRoute = resolvePublicRoute(path, method);

  if (publicRoute?.descriptor.family === "assets") {
    return servePublicAsset(request, env.ASSETS);
  }

  // 무인증 헬스체크: D1 도달성까지 확인해 외부 업타임 모니터가 종단 상태를 알 수 있게 한다.
  if (publicRoute?.descriptor.id === "health.read") {
    const response = await handleHealthCheck(env);
    return headOnly ? headResponse(response) : response;
  }

  // 배포 준비 상태는 양쪽 D1 migration과 Search 파생 인덱스의 동기화까지 확인한다.
  if (publicRoute?.descriptor.id === "readiness.read") {
    const response = await handleReadinessCheck(env);
    return headOnly ? headResponse(response) : response;
  }

  if (request.method === "POST" && !isTrustedPostOrigin(request)) {
    return errorPage("잘못된 요청 출처입니다.", null, 403);
  }

  if (publicRoute?.descriptor.id === "session.login.form") {
    const response = await renderLogin(url, env);
    return headOnly ? headResponse(response) : response;
  }

  if (publicRoute?.descriptor.id === "session.login") {
    return handleLogin(request, env);
  }

  if (publicRoute?.descriptor.id === "session.mfa-login.form") {
    const response = await renderMfaLogin(request, env);
    return headOnly ? headResponse(response) : response;
  }

  if (publicRoute?.descriptor.id === "session.mfa-login") {
    return handleMfaLogin(request, env);
  }

  if (publicRoute?.descriptor.id === "session.signup.blocked") {
    const response = notFoundPage(null);
    return headOnly ? headResponse(response) : response;
  }

  const session = await readSession(request, env);

  if (!session) {
    return redirect(`/login?returnUrl=${encodeURIComponent(url.pathname + url.search)}`);
  }

  if (request.method === "POST" && !await isValidCsrfToken(request, session)) {
    return errorPage("요청 보안 토큰이 유효하지 않습니다. 화면을 새로고침한 뒤 다시 시도하세요.", session, 403);
  }

  // 로그아웃은 POST+CSRF만 허용한다. GET은 세션을 건드리지 않고 홈으로 돌린다.
  if (path === "/logout" && request.method === "POST") {
    return handleLogout(url, env, session);
  }

  if (path === "/logout") {
    return redirect("/app");
  }

  // 기본 비밀번호를 사용하는 동안에는 비밀번호 변경 외의 기능으로 진입할 수 없다.
  if (session.mustChangePassword && path !== "/account/password") {
    return redirect("/account/password?required=1");
  }

  // 운영 권한을 가진 Admin은 MFA 등록 전 다른 업무 기능에 진입할 수 없다.
  if (
    session.mfaPolicyAvailable
    && session.role === "Admin"
    && !session.mfaEnabled
    && !path.startsWith("/account/mfa")
  ) {
    return redirect("/account/mfa?required=1");
  }

  return routeAuthenticatedRequest(request, env, session, url, path, effects);
}

async function runAuthMaintenance(env) {
  try {
    await cleanupLoginThrottle(env);
    await cleanupPendingMfa(env);
    return cleanupExpiredReleaseSmokePrincipals(env);
  } catch (error) {
    logError("worker.auth-maintenance", error);
    return null;
  }
}

async function handleHealthCheck(env) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    const body = {
      ok: true,
      rollbackCompatibility: { sessionEpoch: 1 }
    };
    const workerVersion = String(env.CF_VERSION_METADATA?.id || "").trim();
    if (workerVersion) body.workerVersion = workerVersion;
    return new Response(JSON.stringify(body), { status: 200, headers });
  } catch (error) {
    logError("worker.healthz", error);
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers });
  }
}
