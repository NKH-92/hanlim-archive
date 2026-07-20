import { loadDocumentFormOptions } from "../domains/documents/index.js";
import {
  applyDocumentSnapshot,
  computeRiskWarnings,
  createDocumentSnapshot,
  evaluateSnapshotApplyAuthorization,
  getDocumentSnapshot,
  getDocumentSnapshotExclusions,
  getDocumentSnapshotExport,
  getDocumentSnapshotRows,
  getDocumentSyncState,
  listDocumentSnapshots,
  prepareDocumentSnapshot,
  resolveSnapshotApplyMode,
  SNAPSHOT_ERROR_CODES,
  stageDocumentSnapshotRows
} from "../domains/snapshots/index.js";
import { errorPage, notFoundPage } from "../views/authViews.js";
import { documentSnapshotDetailPage, documentSnapshotPage } from "../views/snapshotViews.js";
import { jsonResponse, redirect } from "../platform/http/responses.js";
import { logError } from "../platform/observability/logger.js";
import { requireManageDocuments } from "./permissionGuards.js";

function statusForSnapshotError(result) {
  if (!result || result.ok) return 200;
  switch (result.code) {
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_NOT_FOUND:
      return 404;
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_STALE:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_CONCURRENT_APPLY:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_EXCLUSION_CONFIRMATION_MISMATCH:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_DUPLICATE:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_IDENTITY_DUPLICATE:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_IDENTITY_CONFLICT:
      return 409;
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_APPLY_PERMISSION_REQUIRED:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_MOVE_PERMISSION_REQUIRED:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_DISPOSAL_PERMISSION_REQUIRED:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_RESTORE_ADMIN_REQUIRED:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_APPLY_DISABLED:
    case SNAPSHOT_ERROR_CODES.SNAPSHOT_BOOTSTRAP_FORBIDDEN:
      return 403;
    default:
      return result.stale ? 409 : 400;
  }
}

export async function renderDocumentSnapshotManager(env, session, error = "") {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const [state, snapshots] = await Promise.all([getDocumentSyncState(env), listDocumentSnapshots(env)]);
  return documentSnapshotPage({
    session,
    state,
    snapshots,
    error,
    applyMode: resolveSnapshotApplyMode(env)
  });
}

export async function handleCreateDocumentSnapshot(request, env, session) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const form = await request.formData();
  const result = await createDocumentSnapshot(env, {
    sourceName: form.get("sourceName"),
    sourceHash: form.get("sourceHash"),
    clientSourceHash: form.get("clientSourceHash") || form.get("sourceHash"),
    totalCount: form.get("totalCount"),
    schemaVersion: form.get("schemaVersion"),
    baseVersion: form.get("baseVersion"),
    currentSnapshotId: form.get("currentSnapshotId"),
    exportManifestId: form.get("exportManifestId"),
    mode: form.get("mode"),
    hasRowKeys: form.get("hasRowKeys") === "1"
  }, session);
  return jsonResponse(result, { status: result.ok ? 201 : statusForSnapshotError(result) });
}

export async function handleDocumentSnapshotRoute(request, env, session, routeInfo) {
  const denied = requireManageDocuments(session);
  if (denied) return denied;
  const { id, action = "details" } = routeInfo;
  if (request.method === "GET" && action === "details") {
    const snapshot = await getDocumentSnapshot(env, id);
    if (!snapshot) return notFoundPage(session);
    const [rows, exclusions] = await Promise.all([
      getDocumentSnapshotRows(env, id),
      getDocumentSnapshotExclusions(env, id)
    ]);
    const summary = {
      createCount: Number(snapshot.create_count || 0),
      updateCount: Number(snapshot.update_count || 0),
      unchangedCount: Number(snapshot.unchanged_count || 0),
      excludeCount: Number(snapshot.exclude_count || 0),
      metadataCount: Number(snapshot.metadata_count || 0),
      moveCount: Number(snapshot.move_count || 0),
      disposeCount: Number(snapshot.dispose_count || 0),
      restoreCount: Number(snapshot.restore_count || 0),
      tagChangeCount: Number(snapshot.tag_change_count || 0),
      reincludeCount: Number(snapshot.reinclude_count || 0)
    };
    const auth = evaluateSnapshotApplyAuthorization(session, summary, env, {
      bootstrap: snapshot.mode === "bootstrap"
    });
    const warnings = parseSnapshotWarnings(snapshot, summary, auth);
    const applied = new URL(request.url).searchParams.get("applied") === "1";
    return documentSnapshotDetailPage({
      session,
      snapshot,
      rows,
      exclusions,
      applied,
      canApply: snapshot.status === "ready" && auth.ok,
      applyBlockReason: auth.ok ? "" : auth.message,
      requiredPermissions: auth.requiredPermissions || [],
      missingPermissions: auth.missingPermissions || [],
      warnings,
      applyMode: resolveSnapshotApplyMode(env)
    });
  }
  if (request.method === "POST" && action === "rows") {
    const form = await request.formData();
    let rows;
    try {
      rows = JSON.parse(String(form.get("rows") || "[]"));
    } catch {
      return jsonResponse({ ok: false, code: SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, message: "전송된 엑셀 행을 읽을 수 없습니다." }, { status: 400 });
    }
    try {
      const result = await stageDocumentSnapshotRows(env, id, rows);
      return jsonResponse(result, { status: result.ok ? 200 : statusForSnapshotError(result) });
    } catch (error) {
      if (/UNIQUE/i.test(error?.message || "")) {
        return jsonResponse({
          ok: false,
          code: SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_DUPLICATE,
          message: "같은 숨김 관리 ID가 여러 행에 들어 있습니다."
        }, { status: 409 });
      }
      throw error;
    }
  }
  if (request.method === "POST" && action === "prepare") {
    const options = await loadDocumentFormOptions(env, { activeOnly: true });
    const result = await prepareDocumentSnapshot(env, id, options, null, session);
    return jsonResponse(result, { status: result.ok ? 200 : statusForSnapshotError(result) });
  }
  if (request.method === "POST" && action === "apply") {
    try {
      const form = await request.formData();
      const result = await applyDocumentSnapshot(env, id, session, {
        applyReason: form.get("applyReason"),
        approvalReference: form.get("approvalReference"),
        confirmedExcludeCount: form.get("confirmedExcludeCount")
      });
      if (!result.ok) {
        const snapshot = await getDocumentSnapshot(env, id);
        if (!snapshot) return notFoundPage(session);
        const status = statusForSnapshotError(result);
        if (status === 403) {
          return errorPage(result.message, session, 403);
        }
        const summary = {
          createCount: Number(snapshot.create_count || 0),
          updateCount: Number(snapshot.update_count || 0),
          unchangedCount: Number(snapshot.unchanged_count || 0),
          excludeCount: Number(snapshot.exclude_count || 0),
          metadataCount: Number(snapshot.metadata_count || 0),
          moveCount: Number(snapshot.move_count || 0),
          disposeCount: Number(snapshot.dispose_count || 0),
          restoreCount: Number(snapshot.restore_count || 0),
          tagChangeCount: Number(snapshot.tag_change_count || 0),
          reincludeCount: Number(snapshot.reinclude_count || 0)
        };
        const auth = evaluateSnapshotApplyAuthorization(session, summary, env, {
          bootstrap: snapshot.mode === "bootstrap"
        });
        return documentSnapshotDetailPage({
          session,
          snapshot,
          rows: await getDocumentSnapshotRows(env, id),
          exclusions: await getDocumentSnapshotExclusions(env, id),
          error: result.message,
          canApply: false,
          applyBlockReason: result.message,
          requiredPermissions: auth.requiredPermissions || result.requiredPermissions || [],
          missingPermissions: auth.missingPermissions || result.missingPermissions || [],
          warnings: parseSnapshotWarnings(snapshot, summary, auth),
          applyMode: resolveSnapshotApplyMode(env),
          status
        });
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

function parseSnapshotWarnings(snapshot, summary, auth) {
  let stored = [];
  try {
    const parsed = JSON.parse(snapshot.warnings_json || "[]");
    if (Array.isArray(parsed)) stored = parsed;
  } catch {
    stored = [];
  }
  const missing = auth.missingPermissions || [];
  if (!stored.length) {
    return computeRiskWarnings({
      summary,
      currentDocumentCount: Number(snapshot.total_count || 0) + Number(snapshot.exclude_count || 0),
      missingPermissions: missing
    });
  }
  const withoutMissing = stored.filter((warning) => warning.code !== "MISSING_PERMISSION");
  if (!missing.length) return withoutMissing;
  return [
    ...withoutMissing,
    {
      code: "MISSING_PERMISSION",
      level: "danger",
      message: `부족한 권한: ${missing.join(", ")}`
    }
  ];
}
