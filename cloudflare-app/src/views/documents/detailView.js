// 문서 상세: 검색·등록·폐기를 잇는 텍스트 중심 연결 화면.

import { escapeHtml, locationLabel } from "../../utils.js";
import { hasPermission, PERMISSIONS } from "../../permissions.js";
import { page, statusBadge, timeline, timelineItem } from "../layout.js";

export function documentDetailsPage({ session, document, tags, disposalLogs, auditLogs, movements = [] }) {
  const canManageDocuments = hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS);
  const canManageDisposals = hasPermission(session, PERMISSIONS.MANAGE_DISPOSALS);
  const canViewAudit = hasPermission(session, PERMISSIONS.VIEW_AUDIT);
  const canViewMovements = canViewAudit || hasPermission(session, PERMISSIONS.MOVE_DOCUMENTS);
  const location = locationLabel(document);
  const latestDisposal = disposalLogs.find((log) => log.action === "disposed");

  return page(document.document_name, `
    <section class="document-detail-head">
      <nav class="breadcrumb" aria-label="경로"><a href="/app">문서검색</a><span>/</span><span>문서 상세</span></nav>
      <div class="document-title-row"><div><h1>${escapeHtml(document.document_name)}</h1><p><span class="mono">${escapeHtml(document.document_number)}</span> · ${escapeHtml(document.revision_number)}</p></div>${statusBadge(document.status)}</div>
      <div class="document-location-summary"><small>보관 위치</small><strong class="mono">${escapeHtml(location)}</strong></div>
    </section>

    <section class="document-detail-sections">
      <article class="panel detail-section">
        <h2>기본 정보</h2>
        <dl>
          ${detailRow("문서번호", document.document_number, true)}
          ${detailRow("개정번호", document.revision_number)}
          ${detailRow("문서명", document.document_name)}
          ${detailRow("제/개정일", document.revision_date || "미입력")}
          ${detailRow("대분류", document.category_name || "-")}
          ${detailRow("태그", tags.length ? tags.map((tag) => tag.name).join(", ") : "-")}
        </dl>
      </article>
      <article class="panel detail-section">
        <h2>보존 정보</h2>
        <dl>
          ${detailRow("폐기 예정 년도", document.disposal_due_year ? `${document.disposal_due_year}년` : "미입력")}
          ${detailRow("상태", document.status === "active" ? "보관중" : "폐기")}
          ${detailRow("비고", document.note || "-")}
          ${document.status === "disposed" ? detailRow("폐기 사유", latestDisposal?.reason || "-") : ""}
          ${document.status === "disposed" ? detailRow("폐기 처리일", latestDisposal?.created_at || "-") : ""}
        </dl>
      </article>
    </section>

    ${documentActions(document, { canManageDocuments, canManageDisposals, isAdmin: session.role === "Admin" })}

    ${canViewAudit ? `<details class="panel detail-history"><summary>감사 이력 <span class="count-badge">${auditLogs.length}건</span></summary>${timeline(auditLogs, renderAuditLog, "감사 이력이 없습니다.")}</details>` : ""}
    ${canViewMovements ? `<details class="panel detail-history"><summary>위치 이동 이력 <span class="count-badge">${movements.length}건</span></summary>${timeline(movements, renderMovementLog, "위치 이동 이력이 없습니다.")}</details>` : ""}
    ${canManageDisposals && document.status === "active" ? disposeModal(document) : ""}
    ${session.role === "Admin" && document.status === "disposed" ? restoreModal(document) : ""}
  `, session);
}

function detailRow(label, value, mono = false) {
  return `<div><dt>${escapeHtml(label)}</dt><dd class="${mono ? "mono" : ""}">${escapeHtml(value)}</dd></div>`;
}

function documentActions(document, capabilities) {
  const primaryActions = [];
  const stateActions = [];
  if (document.status === "active") {
    if (capabilities.canManageDocuments) {
      primaryActions.push(`<a class="button secondary" href="/documents/${document.id}/edit">수정</a>`);
      primaryActions.push(`<a class="button" href="/documents/${document.id}/revise">새 개정 등록</a>`);
    }
    if (capabilities.canManageDisposals) stateActions.push(`<button type="button" class="danger-button" data-open-modal="dispose-modal">폐기</button>`);
  } else if (capabilities.isAdmin) {
    stateActions.push(`<button type="button" class="button secondary" data-open-modal="restore-modal">폐기 취소</button>`);
  }
  if (!primaryActions.length && !stateActions.length) return "";
  return `<section class="detail-actions" aria-label="문서 작업"><div>${primaryActions.join("")}</div><div>${stateActions.join("")}</div></section>`;
}

function disposeModal(document) {
  return `<dialog id="dispose-modal" class="modal"><form method="post" action="/documents/${document.id}/dispose" class="modal-body"><h3>문서 폐기</h3><p class="muted">문서는 삭제되지 않고 폐기 상태로 변경되며 이력은 보존됩니다.</p><label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">폐기 확인</button></div></form></dialog>`;
}

function restoreModal(document) {
  return `<dialog id="restore-modal" class="modal"><form method="post" action="/documents/${document.id}/restore" class="modal-body"><h3>폐기 취소</h3><label>취소 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>닫기</button><button type="submit" class="button">폐기 취소</button></div></form></dialog>`;
}

function renderAuditLog(log) {
  const labels = { legacy_import: "기존 데이터", create: "등록", update: "수정", move: "이동", dispose: "폐기", restore: "폐기 취소", delete_permanent: "완전 삭제" };
  return timelineItem(`${labels[log.action] || log.action}: ${log.summary}`, `${log.actor} (${log.actor_role}) / ${log.created_at}`, publicAuditDetails(log.details));
}

function renderMovementLog(log) {
  const actor = log.performed_by_name || log.performed_by_username || "알 수 없음";
  return timelineItem(`${log.from_location_snapshot} → ${log.to_location_snapshot}`, `${actor} / ${log.created_at}`, log.reason);
}

function publicAuditDetails(details) {
  if (!details) return "";
  try {
    return JSON.stringify(removeInternalStorageCodes(JSON.parse(details)));
  } catch {
    return String(details).replace(/\bARC-\d+\b/gi, "[내부 식별자 숨김]");
  }
}

function removeInternalStorageCodes(value) {
  if (Array.isArray(value)) return value.map(removeInternalStorageCodes);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.replace(/\bARC-\d+\b/gi, "[내부 식별자 숨김]") : value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key.replace(/[_-]/g, "").toLowerCase() !== "storagecode")
    .map(([key, item]) => [key, removeInternalStorageCodes(item)]));
}
