import { logError } from "../platform/observability/logger.js";
import { loadOperationalReadinessReadModel } from "../readModels/adminDashboard.js";

const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});

export async function handleReadinessCheck(env) {
  const workerVersion = String(env.CF_VERSION_METADATA?.id || "").trim() || null;
  try {
    const readiness = await loadOperationalReadinessReadModel(env);
    return jsonResponse({ ok: readiness.ok, workerVersion }, readiness.ok ? 200 : 503);
  } catch (error) {
    logError("worker.readyz", error);
    return jsonResponse({ ok: false, workerVersion }, 503);
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
