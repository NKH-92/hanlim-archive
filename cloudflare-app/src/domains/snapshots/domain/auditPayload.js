import { buildDiffPayload } from "./diff.js";

export function buildDocumentAuditDetails({
  schemaVersion = 1,
  snapshotCode,
  applyReason,
  approvalReference,
  changedFields = [],
  changeFlags = [],
  before = null,
  after = null
}) {
  return {
    schemaVersion,
    snapshotCode,
    applyReason,
    approvalReference: approvalReference || null,
    changedFields,
    changeFlags,
    before: before ? buildDiffPayload({ schemaVersion, rowKey: before.rowKey || before.values?.rowKey, values: before.values || before }) : null,
    after: after ? buildDiffPayload({ schemaVersion, rowKey: after.rowKey || after.values?.rowKey, values: after.values || after }) : null
  };
}

export function buildSystemApplyAuditDetails({
  schemaVersion = 1,
  summary,
  requiredPermissions = [],
  applyReason,
  approvalReference,
  canonicalRowsHash,
  mode,
  permissionSnapshot
}) {
  return {
    schemaVersion,
    summary,
    requiredPermissions,
    applyReason,
    approvalReference: approvalReference || null,
    canonicalRowsHash,
    mode,
    permissionSnapshot
  };
}
