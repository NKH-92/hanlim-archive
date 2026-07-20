import { prepareDocumentImportRows } from "../documentCsv.js";
import { loadDocumentFormOptions } from "../domains/documents/index.js";
import {
  applyDocumentSnapshot,
  createDocumentSnapshot,
  getDocumentSnapshot,
  getDocumentSnapshotExport,
  getDocumentSnapshotRows,
  getDocumentSyncState,
  listDocumentSnapshots,
  prepareDocumentSnapshot,
  stageDocumentSnapshotRows
} from "../domains/snapshots/index.js";
import { errorPage, notFoundPage } from "../views/authViews.js";
import { documentSnapshotDetailPage, documentSnapshotPage } from "../views/snapshotViews.js";
import { jsonResponse, redirect } from "../platform/http/responses.js";
import { logError } from "../platform/observability/logger.js";
import { requireManageDocuments } from "./permissionGuards.js";

export async function renderDocumentSnapshotManager(env, session, error = "") {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const [state, snapshots] = await Promise.all([getDocumentSyncState(env), listDocumentSnapshots(env)]);
  return documentSnapshotPage({ session, state, snapshots, error });
}

export async function handleCreateDocumentSnapshot(request, env, session) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const form = await request.formData();
  const result = await createDocumentSnapshot(env, {
    sourceName: form.get("sourceName"),
    sourceHash: form.get("sourceHash"),
    totalCount: form.get("totalCount"),
    baseVersion: form.get("baseVersion"),
    hasRowKeys: form.get("hasRowKeys") === "1"
  }, session);
  return jsonResponse(result, { status: result.ok ? 201 : result.stale ? 409 : 400 });
}

export async function handleDocumentSnapshotRoute(request, env, session, routeInfo) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const { id, action = "details" } = routeInfo;
  if (request.method === "GET" && action === "details") {
    const snapshot = await getDocumentSnapshot(env, id);
    if (!snapshot) return notFoundPage(session);
    const rows = await getDocumentSnapshotRows(env, id);
    const applied = new URL(request.url).searchParams.get("applied") === "1";
    return documentSnapshotDetailPage({ session, snapshot, rows, applied });
  }
  if (request.method === "POST" && action === "rows") {
    const form = await request.formData();
    let rows;
    try {
      rows = JSON.parse(String(form.get("rows") || "[]"));
    } catch {
      return jsonResponse({ ok: false, message: "전송된 엑셀 행을 읽을 수 없습니다." }, { status: 400 });
    }
    try {
      const result = await stageDocumentSnapshotRows(env, id, rows);
      return jsonResponse(result, { status: result.ok ? 200 : 409 });
    } catch (error) {
      if (/UNIQUE/i.test(error?.message || "")) {
        return jsonResponse({ ok: false, message: "같은 숨김 관리 ID가 여러 행에 들어 있습니다." }, { status: 409 });
      }
      throw error;
    }
  }
  if (request.method === "POST" && action === "prepare") {
    const options = await loadDocumentFormOptions(env, { activeOnly: true });
    const result = await prepareDocumentSnapshot(env, id, options, prepareDocumentImportRows, session);
    return jsonResponse(result, { status: result.ok ? 200 : result.stale ? 409 : 400 });
  }
  if (request.method === "POST" && action === "apply") {
    try {
      const result = await applyDocumentSnapshot(env, id, session);
      if (!result.ok) {
        const snapshot = await getDocumentSnapshot(env, id);
        if (!snapshot) return notFoundPage(session);
        return documentSnapshotDetailPage({ session, snapshot, rows: await getDocumentSnapshotRows(env, id), error: result.message });
      }
      return redirect(`/document-snapshots/${id}?applied=1`);
    } catch (error) {
      logError("document-snapshot.apply", error, { snapshotId: id });
      return errorPage("엑셀 문서대장을 반영하지 못했습니다. 기존 대장은 변경되지 않았습니다.", session, 409);
    }
  }
  return notFoundPage(session);
}

export async function handleDocumentSnapshotExport(env, session) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const payload = await getDocumentSnapshotExport(env);
  return jsonResponse({ ok: true, ...payload });
}
