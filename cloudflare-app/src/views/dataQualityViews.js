// 데이터 품질 숫자를 실제 문서 수정 작업으로 연결하는 관리자 화면.

import { escapeHtml, locationLabel } from "../utils.js";
import { emptyState, page, paginationNav, sectionHeader, statusBadge } from "./layout.js";

export function dataQualityPage({ session, result }) {
  const issueLinks = result.issues.map(({ key, label }) =>
    `<a href="/admin/data-quality?issue=${key}" class="chip ${result.issue === key ? "active" : ""}">${escapeHtml(label)}</a>`
  ).join("");
  const previousUrl = `/admin/data-quality?issue=${result.issue}&page=${Math.max(1, result.page - 1)}`;
  const nextUrl = `/admin/data-quality?issue=${result.issue}&page=${Math.min(result.totalPages, result.page + 1)}`;
  return page("데이터 품질", `
    <section class="page-head"><div><h1>데이터 품질 작업목록</h1><p class="page-sub">문제 숫자에서 실제 문서로 이동해 원인을 확인하고 수정합니다.</p></div><a class="button secondary" href="/admin">관리 설정</a></section>
    <nav class="quality-issue-nav" aria-label="데이터 품질 문제 유형">${issueLinks}</nav>
    <section class="panel">
      ${sectionHeader(result.label, `${result.totalItems}건`)}
      ${result.items.length ? `<div class="table-wrap"><table>
        <thead><tr><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>현재 위치</th><th>상태</th><th>수정</th></tr></thead>
        <tbody>${result.items.map((document) => `<tr>
          <td>${escapeHtml(document.document_number)}</td>
          <td>${escapeHtml(document.revision_number)}</td>
          <td><a href="/documents/${document.id}">${escapeHtml(document.document_name)}</a></td>
          <td>${escapeHtml(document.category_name || "누락")}</td>
          <td>${escapeHtml(locationLabel(document) || "누락")}</td>
          <td>${statusBadge(document.status)}</td>
          <td><a class="button secondary sm" href="/documents/${document.id}/edit">수정</a></td>
        </tr>`).join("")}</tbody>
      </table></div>` : emptyState("이 유형의 데이터 문제가 없습니다.")}
    </section>
    ${paginationNav(result.page, result.totalPages, { previousUrl, nextUrl })}
  `, session);
}
