// 문서 목록과 폐기 작업공간이 공유하는 툴바·피드백·페이지 조각.

import { escapeHtml } from "../../utils.js";
import { hasPermission, PERMISSIONS } from "../../permissions.js";
import { alertDanger, alertWarning, paginationNav } from "../layout.js";
import { documentListUrl } from "./urlHelpers.js";

export function disposalFeedback(feedback) {
  if (!feedback?.message) return "";
  if (feedback.type === "warning") return alertWarning(feedback.message);
  if (feedback.type === "success") return `<div class="alert success" role="status">${escapeHtml(feedback.message)}</div>`;
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

export function bulkActionBar(action = "/documents/bulk-dispose", returnTo = "/documents/disposal") {
  return `
    <div class="bulk-bar" data-bulk-bar hidden>
      <span data-bulk-count>0건 선택</span>
      <form method="post" action="${escapeHtml(action)}" data-bulk-form>
        <input type="hidden" name="ids" data-bulk-ids>
        <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
        <label class="bulk-reason"><span class="sr-only">폐기 사유</span><input name="reason" placeholder="폐기 사유를 입력하세요" required></label>
        <button type="submit" class="danger-button sm">선택 문서 폐기</button>
      </form>
    </div>
  `;
}

export function documentToolbar(session) {
  const actions = [];
  if (hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS)) {
    actions.push(`<a class="button" href="/documents/new">문서 등록</a>`);
    actions.push(`<a class="button secondary" href="/documents/import">CSV 가져오기</a>`);
    actions.push(`<a class="button secondary" href="/documents/export.csv">CSV 내보내기</a>`);
  }
  if (hasPermission(session, PERMISSIONS.MANAGE_DISPOSALS)) {
    actions.push(`<a class="button secondary" href="/disposal-batches">폐기 캠페인</a>`);
  }
  return actions.length ? `<div class="button-group document-toolbar">${actions.join("")}</div>` : "";
}
