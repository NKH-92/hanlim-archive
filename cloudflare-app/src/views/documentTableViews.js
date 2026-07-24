// 문서 결과 테이블: /documents 목록과 /racks/:id 상세가 같은 표 마크업을 쓴다.

import { locationLabel, rackFaceLabel } from "../domains/racks/index.js";
import { escapeHtml } from "../ui/html/escape.js";
import { emptyResult, statusBadge } from "./layout.js";
import { highlight } from "./searchFragments.js";

export function documentResults(documents, opts = {}) {
  if (!documents.length) {
    return emptyResult(opts.emptyMessage || "조건에 맞는 문서가 없습니다.", opts.emptyQuery);
  }
  return `
    <div class="table-wrap doc-table-wrap" data-paginate-root>
      <table class="doc-table${opts.bulk && opts.selectAll ? " is-bulk-selectable" : ""}">
        <thead><tr>
          ${opts.bulk ? `<th class="check-col">${opts.selectAll ? `<label class="bulk-select-all-label"><input type="checkbox" data-bulk-select-all aria-label="현재 목록 전체 선택"><span class="sr-only bulk-select-all-text">현재 목록 전체 선택</span></label>` : `<span class="sr-only">선택</span>`}</th>` : ""}
          <th>문서명</th>
          <th>문서번호</th>
          <th>개정번호</th>
          <th>제·개정일</th>
          <th>폐기 예정 연도</th>
          <th class="loc-col">보관 위치</th>
        </tr></thead>
        <tbody>${documents.map((doc) => documentRow(doc, opts)).join("")}</tbody>
      </table>
    </div>
  `;
}

function documentRow(doc, opts = {}) {
  return `
    <tr class="${doc.status !== "active" ? "is-disposed" : ""}" data-document-row>
      ${opts.bulk ? `<td class="check-col" data-label="선택"><input type="checkbox" name="docId" value="${doc.id}" data-bulk-item aria-label="${escapeHtml(doc.document_name)} 선택"></td>` : ""}
      <td class="name-cell" data-label="문서명">
        <a href="/documents/${doc.id}" data-doc-click="${doc.id}">${highlight(doc.document_name, opts.query || "")}</a>${doc.status !== "active" ? ` ${statusBadge(doc.status)}` : ""}
        ${doc.note ? `<small>${escapeHtml(doc.note)}</small>` : ""}
        ${opts.showScore && doc.match_reason ? `<small class="match-line">${escapeHtml(doc.match_reason)}</small>` : ""}
      </td>
      <td class="mono-cell" data-label="문서번호">${highlight(doc.document_number, opts.query || "")}</td>
      <td class="revision-cell" data-label="개정번호">${escapeHtml(doc.revision_number)}</td>
      <td data-label="제·개정일">${escapeHtml(doc.revision_date || "미입력")}</td>
      <td data-label="폐기 예정 연도">${escapeHtml(doc.disposal_due_year ?? "미입력")}</td>
      <td class="loc-cell" data-label="보관 위치" title="${escapeHtml(locationLabel(doc))}">
        <span class="loc-cell-main">${doc.zone_number ? `${doc.zone_number}구역 ` : ""}${escapeHtml(rackFaceLabel(doc) || doc.rack_code)}</span>
        <small class="loc-cell-sub">${escapeHtml(doc.column_number)}열 ${escapeHtml(doc.shelf_number)}선반</small>
      </td>
    </tr>
  `;
}
