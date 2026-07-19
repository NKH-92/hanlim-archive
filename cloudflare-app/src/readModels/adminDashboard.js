import { getDocumentQualitySummary } from "../domains/documents/index.js";
import { getAppUsers } from "../domains/identity/index.js";
import { getSearchIndexStats } from "../domains/search/index.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";

export async function loadAdminDashboardReadModel(env, session) {
  const [users, quality, searchIndex] = await Promise.all([
    hasPermission(session, PERMISSIONS.MANAGE_USERS) ? getAppUsers(env) : Promise.resolve([]),
    hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS) ? getDocumentQualitySummary(env) : Promise.resolve(null),
    hasPermission(session, PERMISSIONS.VIEW_AUDIT) ? getSearchIndexStats(env) : Promise.resolve(null)
  ]);

  return Object.freeze({
    pendingCount: users.filter((user) => user.status === "pending").length,
    quality,
    searchIndex
  });
}
