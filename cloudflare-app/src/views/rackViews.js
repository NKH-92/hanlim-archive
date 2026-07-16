// 보관 랙 화면.

import { escapeHtml, readBoolean } from "../utils.js";
import { documentResults } from "./documentTableViews.js";
import { alertDanger, page } from "./layout.js";

export function racksPage({ session, racks }) {
  return page("랙 관리", `
    <section class="page-head"><h1>보관 랙 목록</h1><div class="button-group"><a class="button secondary" href="/racks/configure">구역별 설정</a><a class="button" href="/racks/new">랙 추가</a></div></section>
    <section class="rack-grid">
      ${racks.map((rack) => `
        <a class="panel rack-card" href="/racks/${rack.id}">
          <small>${rack.zone_number}구역</small>
          <strong>${rack.rack_number}번 랙</strong>
          <span>${escapeHtml(rack.code)} · ${readBoolean(rack.is_single_sided) ? "단면" : `양면 ${rack.rack_number}-1·${rack.rack_number}-2`} · ${rack.active_document_count || 0}건</span>
        </a>
      `).join("")}
    </section>
  `, session);
}

export function rackConfigurePage({ session, counts, error = "" }) {
  return page("랙 설정", `
    <section class="page-head"><h1>구역별 랙 수</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/racks/configure" class="stack">
        ${[1, 2, 3].map((zone) => `<label>${zone}구역 랙 수<input type="number" name="zone${zone}Count" min="0" max="15" value="${escapeHtml(counts[zone] ?? 0)}"></label>`).join("")}
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}

export function rackDetailsPage({ session, rack, documents }) {
  return page(`${rack.code} 랙`, `
    <section class="page-head">
      <h1>${rack.zone_number}구역 ${rack.rack_number}번 랙</h1>
      <a class="button" href="/racks/${rack.id}/edit">랙 수정</a>
    </section>
    <section class="locator-hero">
      <div><strong class="mono">${escapeHtml(rack.code)}</strong><span>${readBoolean(rack.is_single_sided) ? `단면 ${rack.rack_number}` : `양면 ${rack.rack_number}-1 / ${rack.rack_number}-2`} · 면당 ${rack.column_count || 7}열 × ${rack.shelf_count || 6}선반 = ${(rack.column_count || 7) * (rack.shelf_count || 6)}칸 · 문서 ${documents.length}건</span></div>
      <a class="button secondary" href="/documents?zone=${rack.zone_number}&sort=location">구역 문서 보기</a>
    </section>
    <section class="panel">${documentResults(documents, { emptyMessage: "이 랙에 등록된 문서가 없습니다." })}</section>
  `, session);
}

export function rackFormPage({ session, values = {}, action, title, error = "" }) {
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        <label>구역<input type="number" name="zoneNumber" min="1" max="3" value="${escapeHtml(values.zone_number ?? values.zoneNumber ?? 1)}" required></label>
        <label>랙 번호<input type="number" name="rackNumber" min="1" max="15" value="${escapeHtml(values.rack_number ?? values.rackNumber ?? 1)}" required></label>
        <p class="muted">랙 구조는 면당 7열 × 6선반(42칸)으로 고정되어 있습니다.</p>
        <label>이름<input name="name" value="${escapeHtml(values.name || "")}"></label>
        <label>설명<textarea name="description" rows="3">${escapeHtml(values.description || "")}</textarea></label>
        <label class="check-inline"><input type="checkbox" name="isSingleSided" value="1" ${readBoolean(values.is_single_sided ?? values.isSingleSided) ? "checked" : ""}> 단면 랙</label>
        <p class="muted">양면 랙은 13-1/13-2처럼 면 단위로, 단면 랙은 13처럼 번호만으로 표기됩니다.</p>
        <label class="check-inline"><input type="checkbox" name="isActive" value="1" ${readBoolean(values.is_active ?? values.isActive ?? 1) ? "checked" : ""}> 사용</label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}
