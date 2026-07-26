// 폐기 캠페인·CSV 가져오기·엑셀 snapshot 라우트. routeRegistry 해석 결과만 사용한다.
import {
  handleCreateDisposalBatch,
  handleDisposalBatchRoute,
  handleDisposalBatches,
  renderNewDisposalBatch
} from "./disposalBatchHandlers.js";
import {
  handleCreateDocumentImportJob,
  handleDocumentImportJobRoute,
  handleDocumentImportJobs
} from "./importJobHandlers.js";
import {
  handleCreateDocumentSnapshot,
  handleCreateDocumentSnapshotExport,
  handleDocumentSnapshotExportRoute,
  handleDocumentSnapshotRoute,
  renderDocumentSnapshotManager
} from "./snapshotHandlers.js";

export async function routeWorkflowRequest(request, env, session, resolved, effects = {}) {
  const routeId = resolved?.descriptor?.id || "";
  const params = resolved?.params || {};

  if (routeId === "documents.snapshot.export.create") {
    return handleCreateDocumentSnapshotExport(env, session);
  }
  if (routeId === "documents.snapshot.export.rows") {
    return handleDocumentSnapshotExportRoute(request, env, session, { id: params.manifestId, action: "rows" });
  }
  if (routeId === "documents.snapshot.export.finalize") {
    return handleDocumentSnapshotExportRoute(request, env, session, { id: params.manifestId, action: "finalize" });
  }

  if (routeId === "snapshots.list") return renderDocumentSnapshotManager(env, session);
  if (routeId === "snapshots.create") return handleCreateDocumentSnapshot(request, env, session);
  if (routeId.startsWith("snapshots.")) {
    const action = workflowAction(routeId, "snapshots");
    if (!action) return null;
    return handleDocumentSnapshotRoute(request, env, session, { id: Number(params.id), action }, effects);
  }

  if (routeId === "disposal.list") return handleDisposalBatches(env, session);
  if (routeId === "disposal.new") return renderNewDisposalBatch(request, env, session);
  if (routeId === "disposal.create") return handleCreateDisposalBatch(request, env, session);
  if (routeId.startsWith("disposal.")) {
    const routeInfo = disposalRouteInfo(routeId, params);
    return routeInfo ? handleDisposalBatchRoute(request, env, session, routeInfo) : null;
  }

  if (routeId === "imports.list") return handleDocumentImportJobs(env, session);
  if (routeId === "imports.create") return handleCreateDocumentImportJob(request, env, session);
  if (routeId.startsWith("imports.")) {
    const action = workflowAction(routeId, "imports");
    if (!action) return null;
    return handleDocumentImportJobRoute(request, env, session, { id: Number(params.id), action }, effects);
  }

  return null;
}

function workflowAction(routeId, prefix) {
  const suffix = routeId.slice(prefix.length + 1);
  if (suffix === "details") return "details";
  if (suffix === "rows") return "rows";
  if (suffix === "membership") return "membership";
  if (suffix === "prepare") return "prepare";
  if (suffix === "apply") return "apply";
  if (suffix === "cancel") return "cancel";
  if (suffix === "process") return "process";
  if (suffix === "failures") return "failures.csv";
  return "";
}

function disposalRouteInfo(routeId, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return null;
  if (routeId === "disposal.details") return { id, action: "details", itemId: 0 };
  if (routeId === "disposal.edit.form" || routeId === "disposal.edit") return { id, action: "edit", itemId: 0 };
  if (routeId === "disposal.freeze") return { id, action: "freeze", itemId: 0 };
  if (routeId === "disposal.start") return { id, action: "start", itemId: 0 };
  if (routeId === "disposal.process") return { id, action: "process", itemId: 0 };
  if (routeId === "disposal.cancel") return { id, action: "cancel", itemId: 0 };
  if (routeId === "disposal.export") return { id, action: "export.csv", itemId: 0 };
  if (routeId === "disposal.item.exclude" || routeId === "disposal.item.include") {
    return {
      id,
      itemId: Number(params.itemId),
      action: routeId === "disposal.item.exclude" ? "exclude" : "include"
    };
  }
  return null;
}
