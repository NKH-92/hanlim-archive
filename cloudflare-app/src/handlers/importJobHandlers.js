import { getAppConfig } from "../config.js";
import {
  cancelDocumentImportJob,
  createDocumentImportJob,
  getDocumentImportFailureRows,
  getDocumentImportItems,
  getDocumentImportJob,
  listDocumentImportJobs,
  loadDocumentFormOptions,
  processDocumentImportJob
} from "../db.js";
import {
  documentImportJobCreatePage,
  documentImportJobDetailPage,
  documentImportJobsPage,
  errorPage,
  notFoundPage
} from "../html.js";
import { prepareDocumentImportRows, readDocumentImportRows } from "../documentCsv.js";
import { clean, csvEscape, jsonResponse, logError, redirect } from "../utils.js";
import { requireManageDocuments } from "./permissionGuards.js";
import { csvDownloadResponse } from "./responseHelpers.js";

export async function handleDocumentImportJobs(env, session) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  return documentImportJobsPage({ session, jobs: await listDocumentImportJobs(env) });
}

export function renderDocumentImportJobCreate(session, error = "") {
  const denied = requireManageDocuments(session);
  return denied || documentImportJobCreatePage({ session, error });
}

export async function handleCreateDocumentImportJob(request, env, session) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const form = await request.formData();
  const imported = await readDocumentImportRows(form, getAppConfig(env).csvImport);
  if (!imported.ok) return documentImportJobCreatePage({ session, error: imported.error });
  const options = await loadDocumentFormOptions(env, { activeOnly: true });
  const prepared = prepareDocumentImportRows(imported.rows, options);
  if (prepared.errors.length) {
    return documentImportJobCreatePage({ session, error: `가져오기 전 검증 오류가 있습니다: ${prepared.errors.slice(0, 12).join(" / ")}${prepared.errors.length > 12 ? " ..." : ""}` });
  }
  const file = form.get("csvFile");
  const sourceName = typeof file?.name === "string" && file.name ? file.name : "붙여넣기";
  const result = await createDocumentImportJob(env, { sourceName, items: prepared.items }, session);
  if (!result.ok) return documentImportJobCreatePage({ session, error: result.message });
  return redirect(`/document-import-jobs/${result.id}`);
}

// routes matcher가 { id, action }을 넘긴다. action 기본값은 details다.
export async function handleDocumentImportJobRoute(request, env, session, routeInfo) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const { id, action = "details" } = routeInfo;
  if (request.method === "GET" && action === "details") {
    const job = await getDocumentImportJob(env, id);
    if (!job) return notFoundPage(session);
    const status = clean(new URL(request.url).searchParams.get("status"));
    const items = await getDocumentImportItems(env, id, { status });
    return documentImportJobDetailPage({ session, job, items, itemStatus: status });
  }
  if (request.method === "GET" && action === "failures.csv") {
    return exportFailures(env, id);
  }
  if (request.method === "POST" && action === "process") {
    let result;
    try {
      result = await processDocumentImportJob(env, id, session);
    } catch (error) {
      logError("import-job.process", error, { jobId: id });
      result = { ok: false, message: "문서 가져오기 처리 중 오류가 발생했습니다." };
    }
    if (request.headers.get("Accept")?.includes("application/json")) {
      return jsonResponse(result, { status: result.ok ? 200 : 409 });
    }
    if (!result.ok) return errorPage(result.message, session, 409);
    return redirect(`/document-import-jobs/${id}`);
  }
  if (request.method === "POST" && action === "cancel") {
    const result = await cancelDocumentImportJob(env, id, session);
    if (!result.ok) return errorPage(result.message, session, 409);
    return redirect(`/document-import-jobs/${id}`);
  }
  return notFoundPage(session);
}

async function exportFailures(env, id) {
  const rows = await getDocumentImportFailureRows(env, id);
  const header = ["행", "오류", "정규화데이터", "처리시각"];
  const lines = rows.map((row) => [row.row_number, row.error_message, row.payload_json, row.processed_at || ""].map(csvEscape).join(","));
  const body = `\uFEFF${header.map(csvEscape).join(",")}\r\n${lines.join("\r\n")}`;
  const code = clean(rows[0]?.job_code) || `IMP-${id}`;
  return csvDownloadResponse(body, `${code}-failures.csv`);
}
