import assert from "node:assert/strict";
import test from "node:test";

import { ROUTES } from "../src/app/routeRegistry.js";
import { evaluateSnapshotApplyAuthorization } from "../src/domains/snapshots/domain/authorization.js";
import { PERMISSIONS } from "../src/permissions.js";
import { requirePermission } from "../src/handlers/permissionGuards.js";

function sessionWith(flags = {}, role = "User") {
  return {
    role,
    can_manage_documents: false,
    can_apply_document_snapshots: false,
    can_move_documents: false,
    can_manage_disposals: false,
    ...flags
  };
}

test("snapshots.apply 라우트는 문서관리+반영 복합 permission과 allOf policy를 함께 선언한다", () => {
  const route = ROUTES.find((item) => item.id === "snapshots.apply");
  assert.ok(route);
  assert.equal(route.permission, `${PERMISSIONS.MANAGE_DOCUMENTS}+${PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS}`);
  assert.equal(route.policy, "allOf:can_manage_documents+can_apply_document_snapshots");
});

test("snapshot apply 권한 매트릭스: manage/apply 단독·복합·폐기 조합", () => {
  const summary = { createCount: 0, updateCount: 1, moveCount: 0, disposeCount: 0, restoreCount: 0, excludeCount: 0 };
  const env = { EXCEL_SNAPSHOT_APPLY_MODE: "permissioned" };

  assert.equal(evaluateSnapshotApplyAuthorization(sessionWith({ can_manage_documents: true }), summary, env).ok, false);
  assert.equal(evaluateSnapshotApplyAuthorization(sessionWith({ can_apply_document_snapshots: true }), summary, env).ok, false);
  assert.equal(evaluateSnapshotApplyAuthorization(sessionWith({
    can_manage_documents: true,
    can_apply_document_snapshots: true
  }), summary, env).ok, true);

  const disposed = { ...summary, disposeCount: 1 };
  assert.equal(evaluateSnapshotApplyAuthorization(sessionWith({
    can_manage_documents: true,
    can_apply_document_snapshots: true
  }), disposed, env).ok, false);
  assert.equal(evaluateSnapshotApplyAuthorization(sessionWith({
    can_manage_documents: true,
    can_apply_document_snapshots: true,
    can_manage_disposals: true
  }), disposed, env).ok, true);

  assert.equal(
    requirePermission(sessionWith({ can_manage_documents: true }), `${PERMISSIONS.MANAGE_DOCUMENTS}+${PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS}`) !== null,
    true
  );
  assert.equal(
    requirePermission(sessionWith({
      can_manage_documents: true,
      can_apply_document_snapshots: true
    }), `${PERMISSIONS.MANAGE_DOCUMENTS}+${PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS}`),
    null
  );
});
