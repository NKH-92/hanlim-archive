import { getSystemAuditPage } from "../db.js";
import { auditPage } from "../html.js";

export async function handleSystemAudit(request, env, session) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page")) || 1;
  const result = await getSystemAuditPage(env, url.searchParams, page, 30);
  return auditPage({ session, ...result });
}
