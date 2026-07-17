// 문서 위치 이동 라우트. 서버 권한 검사는 화면 버튼 노출과 별개로 항상 수행한다.

import {
  getDocument,
  getDocumentMovementPage,
  getDocumentMovements,
  getSlotOptions,
  moveDocument
} from "../db.js";
import { movementFormPage, movementsPage, notFoundPage } from "../html.js";
import { clean, redirect } from "../utils.js";
import { requireAnyPermission, requireMoveDocuments } from "./permissionGuards.js";
import { PERMISSIONS } from "../permissions.js";

export async function renderDocumentMove(env, session, documentId, error = "", values = {}) {
  const denied = requireMoveDocuments(session);
  if (denied) return denied;

  const [document, slots, movements] = await Promise.all([
    getDocument(env, documentId),
    getSlotOptions(env),
    getDocumentMovements(env, documentId)
  ]);
  if (!document) return notFoundPage(session);

  return movementFormPage({ session, document, slots, movements, error, values });
}

export async function handleDocumentMove(request, env, session, documentId) {
  const denied = requireMoveDocuments(session);
  if (denied) return denied;

  const form = await request.formData();
  const values = {
    rackSlotId: Number(form.get("rackSlotId")),
    rackFace: clean(form.get("rackFace")),
    reason: clean(form.get("reason")),
    expectedUpdatedAt: clean(form.get("expectedUpdatedAt")),
    expectedRowVersion: Number(form.get("expectedRowVersion"))
  };
  const result = await moveDocument(env, documentId, values, session);
  if (!result.ok) {
    return renderDocumentMove(env, session, documentId, result.message, values);
  }
  return redirect(`/documents/${documentId}?toast=moved`);
}

export async function handleMovementHistory(request, env, session) {
  const denied = requireAnyPermission(session, [PERMISSIONS.MOVE_DOCUMENTS, PERMISSIONS.VIEW_AUDIT]);
  if (denied) return denied;

  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"));
  const page = Number(url.searchParams.get("page"));
  const result = await getDocumentMovementPage(env, { query }, page, 30);
  return movementsPage({ session, result, query });
}
