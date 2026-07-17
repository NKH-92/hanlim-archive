// 폐기 캠페인과 CSV 가져오기 작업 라우트. 미매칭은 상위 라우터에 null로 넘긴다.
import { matchDisposalBatchRoute, matchDocumentImportJobRoute } from "../routes.js";
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

export async function routeWorkflowRequest(request, env, session, path) {
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

  return null;
}
