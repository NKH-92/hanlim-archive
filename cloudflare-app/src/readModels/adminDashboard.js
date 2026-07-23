import { getDocumentCapacity, getDocumentQualitySummary } from "../domains/documents/index.js";
import { getAppUsers } from "../domains/identity/index.js";
import { getSearchIndexStats, getSearchOperationalState } from "../domains/search/index.js";
import { hasPermission, PERMISSIONS } from "../permissions.js";

export async function loadAdminDashboardReadModel(env, session) {
  const [users, quality, capacity, searchIndex, searchOperations] = await Promise.all([
    hasPermission(session, PERMISSIONS.MANAGE_USERS) ? getAppUsers(env) : Promise.resolve([]),
    hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS) ? getDocumentQualitySummary(env) : Promise.resolve(null),
    hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS) ? getDocumentCapacity(env) : Promise.resolve(null),
    hasPermission(session, PERMISSIONS.VIEW_AUDIT) ? getSearchIndexStats(env) : Promise.resolve(null),
    hasPermission(session, PERMISSIONS.VIEW_AUDIT) ? getSearchOperationalState(env) : Promise.resolve(null)
  ]);

  const result = {
    pendingCount: users.filter((user) => user.status === "pending").length,
    quality,
    searchIndex: searchIndex && searchOperations ? { ...searchIndex, ...searchOperations } : searchIndex
  };
  if (capacity) result.capacity = capacity;
  return Object.freeze(result);
}
