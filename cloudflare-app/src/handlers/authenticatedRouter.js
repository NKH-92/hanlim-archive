// 인증 이후의 애플리케이션 라우트. dispatcher 호출 순서가 응답 우선순위다.
import { accessDeniedPage, notFoundPage } from "../html.js";
import { sessionHasManagementAccess } from "../permissions.js";
import { matchAdminUserRoute } from "../routes.js";
import { redirect } from "../utils.js";
import {
  handleAdminDashboard,
  handleAdminSettings,
  handleAdminUserAction,
  handleChangePassword,
  renderPasswordPage
} from "./adminHandlers.js";
import { handleSystemAudit } from "./auditHandlers.js";
import { handleDataQuality } from "./dataQualityHandlers.js";
import { routeDocumentRequest } from "./documentRouter.js";
import { routeMasterRequest } from "./masterRouter.js";
import { handleMovementHistory } from "./movementHandlers.js";
import { requireManageUsers, requireViewAudit } from "./permissionGuards.js";
import {
  handleUserPermissions,
  handleUserStatusAction,
  renderUserPermissions
} from "./userPermissionHandlers.js";
import {
  handleAdminSearchReport,
  handleDashboard,
  handleFloorPlan,
  handleSearchClick,
  handleSearchIndex,
  handleSearchSuggestions,
  handleViewerSearch,
  renderQa
} from "./viewerHandlers.js";
import { routeWorkflowRequest } from "./workflowRouter.js";

export async function routeAuthenticatedRequest(request, env, session, url, path) {
  if (path === "/" && request.method === "GET") {
    return redirect("/app");
  }

  if (path === "/app" && request.method === "GET") {
    return handleDashboard(request, env, session);
  }

  if (path === "/floor-plan" && request.method === "GET") {
    return handleFloorPlan(env, session);
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

  const workflowResponse = await routeWorkflowRequest(request, env, session, path);
  if (workflowResponse) return workflowResponse;

  const documentResponse = await routeDocumentRequest(request, env, session, url, path);
  if (documentResponse) return documentResponse;

  const masterResponse = await routeMasterRequest(request, env, session, url, path);
  if (masterResponse) return masterResponse;

  // 최종 dispatcher이므로 미매칭을 null로 넘기지 않고 여기서 404를 확정한다.
  return notFoundPage(session);
}
