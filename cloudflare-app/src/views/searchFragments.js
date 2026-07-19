// 검색 UI 공용 조각: /app 대시보드와 /documents 목록이 같은 검색창·칩·하이라이트를 쓴다.
// (즉시 검색 클라이언트 템플릿과의 통합은 ARCHITECTURE상 의도적으로 하지 않는다.)

import { sharedSearchCore } from "../searchCore.js";
import { locationLabel } from "../domains/racks/index.js";
import { escapeHtml } from "../ui/html/escape.js";

const searchCore = sharedSearchCore;

// 서버 렌더 하이라이트와 클라이언트 즉시 검색이 같은 코어를 쓴다.
export function highlight(text, query) {
  return query ? searchCore.highlightHtml(text, query, escapeHtml) : escapeHtml(text ?? "");
}

// "2구역 PV"처럼 해석된 검색어를 칩으로 보여주고 클릭으로 해제한다.
export function parsedChipRow(parsedQuery, query, basePath = "/app") {
  const chips = parsedQuery?.chips || [];
  if (!chips.length) return "";
  const typeLabels = { zone: "구역", category: "대분류", tag: "태그", status: "상태" };
  return `
    <div class="parsed-chip-row" aria-label="검색어에서 인식한 조건">
      <span>자동 적용</span>
      ${chips.map((chip) => {
        const token = String(chip.token || chip.label || "");
        const remaining = String(query).split(/\s+/).filter((part) => part !== token).join(" ");
        return `<a class="chip active" href="${escapeHtml(basePath)}?q=${encodeURIComponent(remaining)}" title="조건 해제">${escapeHtml(typeLabels[chip.type] || chip.type)}: ${escapeHtml(chip.label)} ×</a>`;
      }).join("")}
    </div>
  `;
}

export function didYouMeanView(candidates) {
  return `
    <div class="didyoumean" data-didyoumean>
      <p>혹시 이 문서를 찾으셨나요?</p>
      ${candidates.map((doc) => `
        <a href="/documents/${doc.id}">
          <strong>${escapeHtml(doc.document_name)}</strong>
          <span class="mono">${escapeHtml(doc.document_number)}</span>
          <small>${escapeHtml(locationLabel(doc))}</small>
        </a>
      `).join("")}
    </div>
  `;
}

export function searchInputBlock(query, suggestions = []) {
  const id = `searchSuggestions-${Math.random().toString(36).slice(2)}`;
  return `
    <div class="search-box">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input name="q" value="${escapeHtml(query)}" placeholder="문서명, 문서번호, 키워드, 대분류, 랙 위치 검색" aria-label="검색어" list="${id}" autocomplete="off" data-suggest-input>
      <datalist id="${id}" data-suggest-list>
        ${suggestions.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label || item.value)}</option>`).join("")}
      </datalist>
      <button type="submit" class="primary">검색</button>
    </div>
  `;
}
