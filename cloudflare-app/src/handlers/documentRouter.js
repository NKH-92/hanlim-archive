// 문서 조회·등록·폐기·이동 라우트. 미매칭은 상위 라우터에 null로 넘긴다.
import { matchDocumentRoute } from "../routes.js";
import {
  handleBulkDispose,
  handleCreateDocument,
  handleDuplicateDocumentCheck,
  handleDocumentExport,
  handleDocumentRoute,
  handleDisposalWorkspace,
  handleFilteredDispose,
  handleSelectedDisposal,
  renderCreateDocument
} from "./documentHandlers.js";
import { handleDocumentSnapshotExport, renderDocumentSnapshotManager } from "./snapshotHandlers.js";
import { handleDocumentMove, renderDocumentMove } from "./movementHandlers.js";
import { requireManageDisposals, requireManageDocuments } from "./permissionGuards.js";
import { redirect } from "../platform/http/responses.js";

export async function routeDocumentRequest(request, env, session, url, path) {
  if (path === "/api/documents/duplicate" && request.method === "GET") {
    return requireManageDocuments(session) ?? handleDuplicateDocumentCheck(
      env,
      url.searchParams.get("documentNumber"),
      url.searchParams.get("revisionNumber"),
      url.searchParams.get("excludeId")
    );
  }

  if (path === "/documents" && request.method === "GET") {
    return redirect(`/app${url.search}`);
  }

  if (path === "/documents/disposal" && request.method === "GET") {
    return requireManageDisposals(session) ?? handleDisposalWorkspace(request, env, session);
  }

  if (path === "/documents/bulk-dispose" && request.method === "POST") {
    return requireManageDisposals(session) ?? handleBulkDispose(request, env, session);
  }

  if (path === "/documents/disposal/process" && request.method === "POST") {
    return requireManageDisposals(session) ?? handleSelectedDisposal(request, env, session);
  }

  if (path === "/documents/dispose-filtered" && request.method === "POST") {
    return requireManageDisposals(session) ?? handleFilteredDispose(request, env, session);
  }

  if (path === "/documents/export.csv" && request.method === "GET") {
    return requireManageDocuments(session) ?? handleDocumentExport(env);
  }

  if (path === "/api/document-snapshot/export" && request.method === "GET") {
    return handleDocumentSnapshotExport(env, session);
  }

  if (path === "/documents/import" && request.method === "GET") {
    return requireManageDocuments(session) ?? renderDocumentSnapshotManager(env, session);
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

  return null;
}
