// 문서 목록과 폐기 작업공간이 공유하는 툴바·피드백·페이지 조각.

import { escapeHtml } from "../../utils.js";
import { hasPermission, PERMISSIONS } from "../../permissions.js";
import { alertDanger, alertWarning, paginationNav } from "../layout.js";
import { documentListUrl } from "./urlHelpers.js";

export function disposalFeedback(feedback) {
  if (!feedback?.message) return "";
  if (feedback.type === "warning") return alertWarning(feedback.message);
  if (feedback.type === "success") return `<div class="alert success disposal-complete" role="status">
    <strong>${escapeHtml(feedback.message)}</strong>
    <div class="disposal-complete-actions"><a class="button secondary sm" href="/documents/disposal?tab=history">폐기 이력 보기</a><a class="button secondary sm" href="/app">문서검색으로 이동</a></div>
  </div>`;
  return alertDanger(feedback.message);
}

export function paginationView(pagination, { query, filters }) {
  if (pagination.totalPages <= 1) return "";
  const previous = pagination.page > 1 ? pagination.page - 1 : 1;
  const next = pagination.page < pagination.totalPages ? pagination.page + 1 : pagination.totalPages;
  return paginationNav(pagination.page, pagination.totalPages, {
    previousUrl: documentListUrl({ query, filters, page: previous }),
    nextUrl: documentListUrl({ query, filters, page: next })
  });
}

export function bulkActionBar(action = "/documents/disposal/process", filters = {}) {
  return `
    <div class="bulk-bar" data-bulk-bar hidden>
      <span data-bulk-count>0건 선택</span>
      <button type="button" class="danger-button sm" data-open-modal="disposal-review-modal">폐기 검토</button>
    </div>
    <dialog id="disposal-review-modal" class="modal disposal-review-modal" aria-labelledby="disposal-review-title">
      <form method="post" action="${escapeHtml(action)}" class="modal-body" data-bulk-form>
        <h2 id="disposal-review-title">폐기 대상 검토</h2>
        <p class="muted">선택한 문서는 삭제되지 않고 폐기 상태로 변경되며 이력은 계속 보존됩니다.</p>
        <ol class="disposal-review-list" data-bulk-summary></ol>
        <input type="hidden" name="ids" data-bulk-ids>
        <input type="hidden" name="q" value="${escapeHtml(filters.query || "")}">
        <input type="hidden" name="categoryId" value="${escapeHtml(filters.categoryId || "")}">
        <input type="hidden" name="rackId" value="${escapeHtml(filters.rackId || "")}">
        <input type="hidden" name="disposalDueYear" value="${escapeHtml(filters.disposalDueYear || "")}">
        <label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label>
        <label>승인 문서 참조<input name="approvalReference" placeholder="결재 번호 또는 관련 문서번호"></label>
        <div class="modal-actions">
          <button type="button" class="button secondary" data-close-modal>취소</button>
          <button type="submit" class="danger-button">폐기 확인</button>
        </div>
      </form>
    </dialog>
  `;
}

export function documentToolbar(session) {
  const actions = [];
  if (hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS)) {
    actions.push(`<a class="button" href="/documents/new">문서 등록</a>`);
    actions.push(`<a class="button secondary" href="/documents/import">CSV 가져오기</a>`);
    actions.push(`<a class="button secondary" href="/documents/export.csv">CSV 내보내기</a>`);
  }
  return actions.length ? `<div class="button-group document-toolbar">${actions.join("")}</div>` : "";
}
