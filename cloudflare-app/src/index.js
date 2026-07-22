// 엔트리포인트: 공개 경로와 공통 인증·보안 파이프라인만 담당한다.
import { readSession } from "./auth.js";
import { errorPage, notFoundPage } from "./views/authViews.js";
import { withSecurityHeaders } from "./security.js";
import { routeAuthenticatedRequest } from "./handlers/authenticatedRouter.js";
import { handleLogin, handleLogout, renderLogin } from "./handlers/sessionHandlers.js";
import { normalizePath } from "./platform/http/routeMatcher.js";
import { redirect } from "./platform/http/responses.js";
import { logError } from "./platform/observability/logger.js";
import { isValidCsrfToken } from "./platform/security/csrf.js";
import { isTrustedPostOrigin } from "./platform/security/origin.js";
import { resolveAuthenticatedRoute, resolvePublicRoute } from "./app/routeRegistry.js";
import { createRequestD1Environment } from "./platform/d1/requestGateway.js";

export default {
  async fetch(request, env) {
    const reqId = shortRequestId();
    const requestEnv = createRequestD1Environment(env, { requestId: reqId });
    let response;
    try {
      response = await route(request, requestEnv);
    } catch (error) {
      // 미처리 예외: 원시 오류 메시지를 사용자에게 노출하지 않는다(정보 노출 방지).
      // 상관용 짧은 reqId만 사용자에게 주고, 전체 오류는 서버 로그에만 남긴다.
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);
      const routeId = (resolvePublicRoute(path, request.method) || resolveAuthenticatedRoute(path, request.method))?.descriptor.id || "unmatched";
      logError("worker.fetch", error, { reqId, routeId, method: request.method, path });
      const session = await readSession(request, requestEnv).catch(() => null);
      response = errorPage(
        `처리 중 오류가 발생했습니다. 계속되면 관리자에게 오류코드 ${reqId} 를 알려주세요.`,
        session,
        500
      );
    }
    return withSecurityHeaders(response, request);
  }
};

function shortRequestId() {
  try {
    return crypto.randomUUID().split("-")[0];
  } catch {
    return "unknown";
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const publicRoute = resolvePublicRoute(path, request.method);

  if (publicRoute?.descriptor.family === "assets") {
    return env.ASSETS.fetch(request);
  }

  // 무인증 헬스체크: D1 도달성까지 확인해 외부 업타임 모니터가 종단 상태를 알 수 있게 한다.
  if (publicRoute?.descriptor.id === "health.read") {
    return handleHealthCheck(env);
  }

  if (request.method === "POST" && !isTrustedPostOrigin(request)) {
    return errorPage("잘못된 요청 출처입니다.", null, 403);
  }

  if (publicRoute?.descriptor.id === "session.login.form") {
    return renderLogin(url, env);
  }

  if (publicRoute?.descriptor.id === "session.login") {
    return handleLogin(request, env);
  }

  if (publicRoute?.descriptor.id === "session.signup.blocked") {
    return notFoundPage(null);
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

  return routeAuthenticatedRequest(request, env, session, url, path);
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
