// 엔트리포인트: 최상위 라우팅 표와 공통 미들웨어(세션 로딩, 출처/CSRF 검사,
// 보안 헤더, 오류 처리)만 남긴다. 각 라우트의 실제 처리는 src/handlers/*가 담당한다.
import { readSession } from "./auth.js";
import { accessDeniedPage, errorPage, notFoundPage } from "./html.js";
import {
  matchAdminUserRoute,
  matchDisposalBatchRoute,
  matchDocumentImportJobRoute,
  matchDocumentRoute,
  matchMasterRoute,
  matchRackRoute,
  matchSetRoute
} from "./routes.js";
import { isTrustedPostOrigin, isValidCsrfToken, logError, normalizePath, redirect } from "./utils.js";
import { withSecurityHeaders } from "./security.js";
import { sessionHasManagementAccess } from "./permissions.js";
import {
  requireManageDisposals,
  requireManageDocuments,
  requireManageMasters,
  requireManageSets,
  requireManageUsers,
  requireViewAudit
} from "./handlers/permissionGuards.js";
import { handleSystemAudit } from "./handlers/auditHandlers.js";
import {
  handleUserPermissions,
  handleUserStatusAction,
  renderUserPermissions
} from "./handlers/userPermissionHandlers.js";
import {
  handleCreateDisposalBatch,
  handleDisposalBatchRoute,
  handleDisposalBatches,
  renderNewDisposalBatch
} from "./handlers/disposalBatchHandlers.js";
import {
  handleCreateDocumentImportJob,
  handleDocumentImportJobRoute,
  handleDocumentImportJobs,
  renderDocumentImportJobCreate
} from "./handlers/importJobHandlers.js";
import { handleDocumentMove, handleMovementHistory, renderDocumentMove } from "./handlers/movementHandlers.js";
import { handleDataQuality } from "./handlers/dataQualityHandlers.js";
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
  handleDocumentRoute,
  handleDocuments,
  handleDisposalWorkspace,
  handleFilteredDispose,
  renderCreateDocument
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
    return redirect("/app");
  }

  if (path === "/" && request.method === "GET") {
    return redirect("/app");
  }

  if (path === "/app" && request.method === "GET") {
    return handleDashboard(request, env, session);
  }

  if (path === "/qa" && request.method === "GET") {
    return renderQa(session, env);
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
    return sessionHasManagementAccess(session) ? handleAdminDashboard(env, session) : accessDeniedPage(session);
  }

  if (path === "/admin/settings" && request.method === "GET") {
    return requireManageUsers(session) ?? handleAdminSettings(env, session);
  }

  if (path === "/admin/search-report" && request.method === "GET") {
    return requireViewAudit(session) ?? handleAdminSearchReport(env, session);
  }

  if (path === "/admin/audit" && request.method === "GET") {
    return requireViewAudit(session) ?? handleSystemAudit(request, env, session);
  }

  if (path === "/admin/movements" && request.method === "GET") {
    return handleMovementHistory(request, env, session);
  }

  if (path === "/admin/data-quality" && request.method === "GET") {
    return handleDataQuality(request, env, session);
  }

  const adminUserRoute = matchAdminUserRoute(path);

  if (adminUserRoute && request.method === "GET" && adminUserRoute.action === "permissions") {
    return requireManageUsers(session) ?? renderUserPermissions(env, session, adminUserRoute.id);
  }

  if (adminUserRoute && request.method === "POST") {
    const denied = requireManageUsers(session);
    if (denied) return denied;
    if (adminUserRoute.action === "permissions") {
      return handleUserPermissions(request, env, session, adminUserRoute.id);
    }
    if (adminUserRoute.action === "disable" || adminUserRoute.action === "enable") {
      return handleUserStatusAction(env, session, adminUserRoute.id, adminUserRoute.action);
    }
    return handleAdminUserAction(env, session, adminUserRoute);
  }

  if (path === "/disposal-batches" && request.method === "GET") {
    return handleDisposalBatches(env, session);
  }

  if (path === "/disposal-batches/new" && request.method === "GET") {
    return renderNewDisposalBatch(env, session);
  }

  if (path === "/disposal-batches" && request.method === "POST") {
    return handleCreateDisposalBatch(request, env, session);
  }

  const disposalBatchRoute = matchDisposalBatchRoute(path);
  if (disposalBatchRoute) {
    return handleDisposalBatchRoute(request, env, session, disposalBatchRoute);
  }

  if (path === "/document-import-jobs" && request.method === "GET") {
    return handleDocumentImportJobs(env, session);
  }

  if (path === "/document-import-jobs" && request.method === "POST") {
    return handleCreateDocumentImportJob(request, env, session);
  }

  const importJobRoute = matchDocumentImportJobRoute(path);
  if (importJobRoute) {
    return handleDocumentImportJobRoute(request, env, session, importJobRoute);
  }

  if (path === "/documents" && request.method === "GET") {
    return handleDocuments(request, env, session);
  }

  if (path === "/documents/disposal" && request.method === "GET") {
    return requireManageDisposals(session) ?? handleDisposalWorkspace(request, env, session);
  }

  if (path === "/documents/bulk-dispose" && request.method === "POST") {
    return requireManageDisposals(session) ?? handleBulkDispose(request, env, session);
  }

  if (path === "/documents/dispose-filtered" && request.method === "POST") {
    return requireManageDisposals(session) ?? handleFilteredDispose(request, env, session);
  }

  if (path === "/documents/export.csv" && request.method === "GET") {
    return requireManageDocuments(session) ?? handleDocumentExport(env);
  }

  if (path === "/documents/import" && request.method === "GET") {
    return requireManageDocuments(session) ?? renderDocumentImportJobCreate(session);
  }

  if (path === "/documents/import" && request.method === "POST") {
    return requireManageDocuments(session) ?? handleCreateDocumentImportJob(request, env, session);
  }

  if (path === "/documents/new" && request.method === "GET") {
    return requireManageDocuments(session) ?? renderCreateDocument(env, session, {
      documentNumber: url.searchParams.get("documentNumber") || "",
      returnTo: url.searchParams.get("returnTo") || ""
    });
  }

  if (path === "/documents" && request.method === "POST") {
    return requireManageDocuments(session) ?? handleCreateDocument(request, env, session);
  }

  const documentRoute = matchDocumentRoute(path);

  if (documentRoute) {
    if (documentRoute.action === "move" && request.method === "GET") {
      return renderDocumentMove(env, session, documentRoute.id);
    }
    if (documentRoute.action === "move" && request.method === "POST") {
      return handleDocumentMove(request, env, session, documentRoute.id);
    }
    return handleDocumentRoute(request, env, session, documentRoute);
  }

  if (path === "/sets" && request.method === "GET") {
    return handleSets(env, session);
  }

  if (path === "/sets/new" && request.method === "GET") {
    return requireManageSets(session) ?? renderNewSetForm(session);
  }

  if (path === "/sets" && request.method === "POST") {
    return requireManageSets(session) ?? handleSaveSet(request, env, session);
  }

  const setRoute = matchSetRoute(path);

  if (setRoute) {
    return handleSetRoute(request, env, session, setRoute);
  }

  if (path === "/racks" && request.method === "GET") {
    return requireManageMasters(session) ?? handleRacks(env, session);
  }

  if (path === "/racks/new" && request.method === "GET") {
    return requireManageMasters(session) ?? renderNewRackForm(session);
  }

  if (path === "/racks/configure" && request.method === "GET") {
    return requireManageMasters(session) ?? renderRackConfigure(env, session);
  }

  if (path === "/racks/configure" && request.method === "POST") {
    return requireManageMasters(session) ?? handleRackConfigure(request, env, session);
  }

  if (path === "/racks" && request.method === "POST") {
    return requireManageMasters(session) ?? handleSaveRack(request, env, session);
  }

  const rackRoute = matchRackRoute(path);

  if (rackRoute) {
    return requireManageMasters(session) ?? handleRackRoute(request, env, session, rackRoute);
  }

  if (path === "/categories" && request.method === "GET") {
    return requireManageMasters(session) ?? renderCategories(env, session);
  }

  if (path === "/categories" && request.method === "POST") {
    return requireManageMasters(session) ?? handleSaveCategory(request, env, session);
  }

  const categoryRoute = matchMasterRoute(path, "categories");

  if (categoryRoute && request.method === "POST") {
    return requireManageMasters(session) ?? handleCategoryAction(request, env, session, categoryRoute);
  }

  if (path === "/tags" && request.method === "GET") {
    return requireManageMasters(session) ?? renderTags(env, session, "", {
      name: url.searchParams.get("name") || ""
    });
  }

  if (path === "/tags" && request.method === "POST") {
    return requireManageMasters(session) ?? handleSaveTag(request, env, session);
  }

  const tagRoute = matchMasterRoute(path, "tags");

  if (tagRoute && request.method === "POST") {
    return requireManageMasters(session) ?? handleTagAction(request, env, session, tagRoute);
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
