// 엔트리포인트: 최상위 라우팅 표와 공통 미들웨어(세션 로딩, 출처/CSRF 검사,
// 보안 헤더, 오류 처리)만 남긴다. 각 라우트의 실제 처리는 src/handlers/*가 담당한다.
import { readSession } from "./auth.js";
import { errorPage, notFoundPage } from "./html.js";
import { matchAdminUserRoute, matchDocumentRoute, matchMasterRoute, matchRackRoute, matchSetRoute } from "./routes.js";
import { isTrustedPostOrigin, isValidCsrfToken, logError, normalizePath, redirect } from "./utils.js";
import { withSecurityHeaders } from "./security.js";
import { requireAdmin } from "./handlers/guards.js";
import { handleLogin, handleLogout, handleSignup, renderLogin, renderSignup } from "./handlers/sessionHandlers.js";
import {
  handleAdminSearchReport,
  handleDashboard,
  handleSearchClick,
  handleSearchIndex,
  handleSearchSuggestions,
  handleViewerSearch,
  renderQa
} from "./handlers/viewerHandlers.js";
import {
  handleBulkDispose,
  handleCreateDocument,
  handleDocumentExport,
  handleDocumentImport,
  handleDocumentRoute,
  handleDocuments,
  renderCreateDocument,
  renderDocumentImport
} from "./handlers/documentHandlers.js";
import {
  handleSaveSet,
  handleSetRoute,
  handleSets,
  renderNewSetForm
} from "./handlers/setHandlers.js";
import {
  handleRackConfigure,
  handleRackRoute,
  handleRacks,
  handleSaveRack,
  renderNewRackForm,
  renderRackConfigure
} from "./handlers/rackHandlers.js";
import {
  handleAdminDashboard,
  handleAdminSettings,
  handleAdminUserAction,
  handleCategoryAction,
  handleChangePassword,
  handleSaveCategory,
  handleSaveTag,
  handleTagAction,
  renderCategories,
  renderPasswordPage,
  renderTags
} from "./handlers/adminHandlers.js";

export default {
  async fetch(request, env) {
    let response;
    try {
      response = await route(request, env);
    } catch (error) {
      // 미처리 예외: 원시 오류 메시지를 사용자에게 노출하지 않는다(정보 노출 방지).
      // 상관용 짧은 reqId만 사용자에게 주고, 전체 오류는 서버 로그에만 남긴다.
      const url = new URL(request.url);
      const reqId = shortRequestId();
      logError("worker.fetch", error, { reqId, method: request.method, path: normalizePath(url.pathname) });
      const session = await readSession(request, env).catch(() => null);
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

  if (path.startsWith("/images/") || path === "/favicon.ico") {
    return env.ASSETS.fetch(request);
  }

  // 무인증 헬스체크: D1 도달성까지 확인해 외부 업타임 모니터가 종단 상태를 알 수 있게 한다.
  if (path === "/healthz" && request.method === "GET") {
    return handleHealthCheck(env);
  }

  if (request.method === "POST" && !isTrustedPostOrigin(request)) {
    return errorPage("잘못된 요청 출처입니다.", null, 403);
  }

  if (path === "/login" && request.method === "GET") {
    return renderLogin(url, env);
  }

  if (path === "/login" && request.method === "POST") {
    return handleLogin(request, env);
  }

  if (path === "/signup" && request.method === "GET") {
    return renderSignup();
  }

  if (path === "/signup" && request.method === "POST") {
    return handleSignup(request, env);
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
    return handleLogout(url);
  }

  if (path === "/logout") {
    return redirect(session.role === "Admin" ? "/admin" : "/app");
  }

  if (path === "/" && request.method === "GET") {
    return redirect(session.role === "Admin" ? "/admin" : "/app");
  }

  if (path === "/app" && request.method === "GET") {
    return handleDashboard(request, env, session);
  }

  if (path === "/qa" && request.method === "GET") {
    return renderQa(session);
  }

  if (path === "/api/search-suggestions" && request.method === "GET") {
    return handleSearchSuggestions(request, env);
  }

  if (path === "/api/viewer/search" && request.method === "GET") {
    return handleViewerSearch(request, env);
  }

  if (path === "/api/search-index" && request.method === "GET") {
    return handleSearchIndex(request, env);
  }

  if (path === "/api/search-click" && request.method === "POST") {
    return handleSearchClick(request, env);
  }

  if (path === "/account/password" && request.method === "GET") {
    return renderPasswordPage(session);
  }

  if (path === "/account/password" && request.method === "POST") {
    return handleChangePassword(request, env, session);
  }

  if (path === "/admin" && request.method === "GET") {
    return requireAdmin(session) ?? handleAdminDashboard(env, session);
  }

  if (path === "/admin/settings" && request.method === "GET") {
    return requireAdmin(session) ?? handleAdminSettings(env, session);
  }

  if (path === "/admin/search-report" && request.method === "GET") {
    return requireAdmin(session) ?? handleAdminSearchReport(env, session);
  }

  const adminUserRoute = matchAdminUserRoute(path);

  if (adminUserRoute && request.method === "POST") {
    return requireAdmin(session) ?? handleAdminUserAction(env, session, adminUserRoute);
  }

  if (path === "/documents" && request.method === "GET") {
    return handleDocuments(request, env, session);
  }

  if (path === "/documents/bulk-dispose" && request.method === "POST") {
    return requireAdmin(session) ?? handleBulkDispose(request, env, session);
  }

  if (path === "/documents/export.csv" && request.method === "GET") {
    return requireAdmin(session) ?? handleDocumentExport(env);
  }

  if (path === "/documents/import" && request.method === "GET") {
    return requireAdmin(session) ?? renderDocumentImport(session);
  }

  if (path === "/documents/import" && request.method === "POST") {
    return requireAdmin(session) ?? handleDocumentImport(request, env, session);
  }

  if (path === "/documents/new" && request.method === "GET") {
    return requireAdmin(session) ?? renderCreateDocument(env, session);
  }

  if (path === "/documents" && request.method === "POST") {
    return requireAdmin(session) ?? handleCreateDocument(request, env, session);
  }

  const documentRoute = matchDocumentRoute(path);

  if (documentRoute) {
    return handleDocumentRoute(request, env, session, documentRoute);
  }

  if (path === "/sets" && request.method === "GET") {
    return handleSets(env, session);
  }

  if (path === "/sets/new" && request.method === "GET") {
    return requireAdmin(session) ?? renderNewSetForm(session);
  }

  if (path === "/sets" && request.method === "POST") {
    return requireAdmin(session) ?? handleSaveSet(request, env, session);
  }

  const setRoute = matchSetRoute(path);

  if (setRoute) {
    return handleSetRoute(request, env, session, setRoute);
  }

  if (path === "/racks" && request.method === "GET") {
    return requireAdmin(session) ?? handleRacks(env, session);
  }

  if (path === "/racks/new" && request.method === "GET") {
    return requireAdmin(session) ?? renderNewRackForm(session);
  }

  if (path === "/racks/configure" && request.method === "GET") {
    return requireAdmin(session) ?? renderRackConfigure(env, session);
  }

  if (path === "/racks/configure" && request.method === "POST") {
    return requireAdmin(session) ?? handleRackConfigure(request, env, session);
  }

  if (path === "/racks" && request.method === "POST") {
    return requireAdmin(session) ?? handleSaveRack(request, env, session);
  }

  const rackRoute = matchRackRoute(path);

  if (rackRoute) {
    return requireAdmin(session) ?? handleRackRoute(request, env, session, rackRoute);
  }

  if (path === "/categories" && request.method === "GET") {
    return requireAdmin(session) ?? renderCategories(env, session);
  }

  if (path === "/categories" && request.method === "POST") {
    return requireAdmin(session) ?? handleSaveCategory(request, env, session);
  }

  const categoryRoute = matchMasterRoute(path, "categories");

  if (categoryRoute && request.method === "POST") {
    return requireAdmin(session) ?? handleCategoryAction(request, env, session, categoryRoute);
  }

  if (path === "/tags" && request.method === "GET") {
    return requireAdmin(session) ?? renderTags(env, session);
  }

  if (path === "/tags" && request.method === "POST") {
    return requireAdmin(session) ?? handleSaveTag(request, env, session);
  }

  const tagRoute = matchMasterRoute(path, "tags");

  if (tagRoute && request.method === "POST") {
    return requireAdmin(session) ?? handleTagAction(request, env, session, tagRoute);
  }

  return notFoundPage(session);
}

async function handleHealthCheck(env) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (error) {
    logError("worker.healthz", error);
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers });
  }
}
