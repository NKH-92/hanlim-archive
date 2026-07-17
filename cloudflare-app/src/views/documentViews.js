// 문서 목록·등록/수정·상세·CSV 가져오기 화면.

import { escapeHtml, locationLabel, rackFaceLabel, readBoolean } from "../utils.js";
import { locationPicker, locationPickerScript } from "./documentLocationPicker.js";
import { documentResults } from "./documentTableViews.js";
import { zoneFloorPlanView } from "./floorPlanViews.js";
import { alertDanger, alertWarning, filterSelectRow, formValue, listUrl, option, page, paginationNav, statusBadge, timeline, timelineItem } from "./layout.js";
import { didYouMeanView, parsedChipRow, searchInputBlock } from "./searchFragments.js";

export { documentResults };

export function documentsPage({
  session,
  query,
  parsedQuery = null,
  documents,
  categories = [],
  tags = [],
  filters = {},
  suggestions = [],
  didYouMean = [],
  pagination = { page: 1, pageSize: 30, totalDocuments: documents.length, totalPages: 1 }
}) {
  const chipRow = parsedChipRow(parsedQuery, query, "/documents");
  return page("문서 관리", `
    <section class="page-head">
      <div><h1>문서 관리</h1><p class="muted">문서 정보와 보관 위치를 확인하고 수정합니다.</p></div>
      ${documentToolbar(session)}
    </section>

    <section class="panel search-panel">
      <form method="get" action="/documents" class="filter-bar" id="documentFilterForm" data-search-form data-auto-submit>
        ${searchInputBlock(query, suggestions)}
        ${filterSelectRow({ categories, tags, filters })}
      </form>
    </section>

    ${chipRow ? `<section class="panel chip-panel">${chipRow}</section>` : ""}

    <section class="panel results-panel">
      <div class="section-title">
        <h2>${query ? `"${escapeHtml(query)}" 검색 결과` : "전체 보유문서"}</h2>
        <span class="count-badge">${pagination.totalDocuments}건</span>
      </div>
      ${documentResults(documents, { emptyQuery: query, showScore: Boolean(query), query })}
      ${!documents.length && didYouMean.length ? didYouMeanView(didYouMean) : ""}
      ${paginationView(pagination, { query, filters })}
    </section>
  `, session);
}

export function disposalWorkspacePage({
  session,
  documents = [],
  categories = [],
  racks = [],
  years = [],
  filters = {},
  capped = false,
  feedback = null
}) {
  const returnTo = disposalListUrl(filters);
  return page("문서 폐기 작업", `
    <section class="page-head">
      <div><h1>문서 폐기 작업</h1><p class="muted">보관중 문서만 표시됩니다. 현재 목록에서 대상을 선택하고 폐기 사유를 한 번 입력해 처리합니다.</p></div>
      <a class="button secondary" href="/documents">문서 관리</a>
    </section>
    ${disposalFeedback(feedback)}
    <section class="panel">
      <form method="get" action="/documents/disposal" class="filter-row">
        <label><span class="sr-only">대분류</span><select name="category"><option value="">전체 대분류</option>${categories.map((item) => option(item.id, item.name, filters.categoryId)).join("")}</select></label>
        <label><span class="sr-only">랙</span><select name="rack"><option value="">전체 랙</option>${racks.map((item) => option(item.id, `${item.zone_number}구역 ${item.rack_number}번 랙`, filters.rackId)).join("")}</select></label>
        <label><span class="sr-only">폐기 예정 년도</span><select name="disposalDueYear"><option value="">전체 폐기 예정 년도</option>${years.map((year) => option(year, `${year}년`, filters.disposalDueYear)).join("")}</select></label>
        <button type="submit" class="button secondary">필터 적용</button>
        <a class="button secondary" href="/documents/disposal">초기화</a>
      </form>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>폐기 대상 후보</h2><span class="count-badge">${documents.length}${capped ? "+" : ""}건</span></div>
      ${capped ? `<div class="alert warning">한 번에 최대 200건까지만 처리할 수 있습니다. 표시된 문서를 선택하거나 필터를 더 좁혀 주세요.</div>` : ""}
      ${documentResults(documents, { bulk: true, selectAll: true, emptyMessage: "조건에 맞는 보관중 문서가 없습니다." })}
      ${bulkActionBar("/documents/bulk-dispose", returnTo)}
    </section>
  `, session);
}

function disposalFeedback(feedback) {
  if (!feedback?.message) return "";
  if (feedback.type === "warning") return alertWarning(feedback.message);
  if (feedback.type === "success") return `<div class="alert success" role="status">${escapeHtml(feedback.message)}</div>`;
  return alertDanger(feedback.message);
}

function disposalListUrl(filters = {}) {
  const params = new URLSearchParams();
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.rackId) params.set("rack", filters.rackId);
  if (filters.disposalDueYear) params.set("disposalDueYear", filters.disposalDueYear);
  const query = params.toString();
  return query ? `/documents/disposal?${query}` : "/documents/disposal";
}

export function documentFormPage({ session, title, action, values = {}, categories, tags, slots, selectedTags = [], error = "", showLocation = true }) {
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        ${formValue(values, "updatedAt", "updated_at") ? `<input type="hidden" name="expectedUpdatedAt" value="${escapeHtml(formValue(values, "updatedAt", "updated_at"))}">` : ""}
        <label>문서번호 <em>*</em><input name="documentNumber" value="${escapeHtml(formValue(values, "documentNumber", "document_number"))}" required></label>
        <label>개정번호 <em>*</em><input name="revisionNumber" value="${escapeHtml(formValue(values, "revisionNumber", "revision_number") || "Rev.0")}" required></label>
        <label>문서명 <em>*</em><input name="documentName" value="${escapeHtml(formValue(values, "documentName", "document_name"))}" required></label>
        <label>제/개정일 <em>*</em><input type="date" name="revisionDate" value="${escapeHtml(formValue(values, "revisionDate", "revision_date"))}" required></label>
        <label>폐기 예정 년도 <em>*</em><input type="number" name="disposalDueYear" min="1900" max="9999" step="1" value="${escapeHtml(formValue(values, "disposalDueYear", "disposal_due_year"))}" required></label>
        <label>대분류 <em>*</em><select name="categoryId" required>${categories.map((c) => option(c.id, c.name, formValue(values, "categoryId", "category_id"))).join("")}</select></label>
        ${showLocation ? `${locationPicker(slots, formValue(values, "rackSlotId", "rack_slot_id"))}
        <label>보관 면 <em>*</em><select name="rackFace" required data-rack-face>${option("A", "1면", formValue(values, "rackFace", "rack_face") || "A")}${option("B", "2면", formValue(values, "rackFace", "rack_face"))}</select></label>
        <p class="muted" data-face-hint>양면 랙은 13-1(1면)/13-2(2면)처럼 면 단위로 표기합니다. 단면 랙은 면 구분이 없습니다.</p>` : ""}
        <fieldset class="check-grid">
          <legend>태그</legend>
          ${tags.map((tag) => `<label class="check-item"><input type="checkbox" name="tagIds" value="${tag.id}" ${selectedTags.includes(tag.id) ? "checked" : ""}><span>${escapeHtml(tag.name)}</span></label>`).join("")}
        </fieldset>
        <label>비고<textarea name="note" rows="3">${escapeHtml(formValue(values, "note", "note"))}</textarea></label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
    ${showLocation ? locationPickerScript() : ""}
  `, session);
}

export function documentDetailsPage({ session, document, tags, disposalLogs, auditLogs, floorPlan = [] }) {
  const isAdmin = session.role === "Admin";
  const location = locationLabel(document);
  const latestDisposal = disposalLogs.find((log) => log.action === "disposed");
  const information = `
    <section class="panel detail-grid">
      ${detail("문서명", document.document_name)}
      ${detail("문서번호", document.document_number)}
      ${detail("개정번호", document.revision_number)}
      ${detail("제/개정일", document.revision_date || "미입력")}
      ${detail("폐기 예정 년도", document.disposal_due_year ?? "미입력")}
    </section>
    <section class="panel detail-grid">
      ${detail("상태", document.status === "active" ? "보관중" : "폐기")}
      ${detail("대분류", document.category_name)}
      ${detail("태그", tags.length ? tags.map((t) => t.name).join(", ") : "-")}
      ${detail("비고", document.note || "-")}
      ${document.status === "disposed" ? detail("폐기사유", latestDisposal?.reason || "-") : ""}
    </section>
    ${renderMiniVisualizer(document)}
    ${renderDocumentFloorPlan(document, floorPlan)}
  `;

  const breadcrumb = isAdmin
    ? `<a href="/app">검색</a><span>/</span><a href="/documents">문서 관리</a><span>/</span><span>상세</span>`
    : `<a href="/app">문서 검색</a><span>/</span><span>상세</span>`;

  return page(document.document_name, `
    <section class="page-head">
      <div>
        <nav class="breadcrumb" aria-label="경로">${breadcrumb}</nav>
        <h1>${escapeHtml(document.document_name)}</h1>
      </div>
      <div class="head-actions">
        ${statusBadge(document.status)}
        ${isAdmin ? documentActions(document) : ""}
      </div>
    </section>
    <section class="locator-hero">
      <div>
        <small>보관 위치</small>
        <strong class="loc-label-lg">${escapeHtml(location)}</strong>
        <span class="mono">${escapeHtml(document.rack_code)}</span>
      </div>
      <div class="button-group">
        <button type="button" class="button secondary sm" data-copy-text="${escapeHtml(location)}">위치 복사</button>
        <a class="button secondary sm" href="${isAdmin ? "/documents" : "/app"}?q=${encodeURIComponent(document.rack_code)}">같은 랙 문서 보기</a>
      </div>
    </section>
    ${isAdmin ? `
      <div class="tab-nav" role="tablist" aria-label="문서 상세 정보">
        <button role="tab" aria-selected="true" data-tab="info" id="tab-info" aria-controls="panel-info">기본 정보</button>
        <button role="tab" aria-selected="false" data-tab="audit" id="tab-audit" aria-controls="panel-audit">Audit Trail <span class="tab-count">${auditLogs.length}</span></button>
      </div>
      <div class="tab-panel" id="panel-info" role="tabpanel" aria-labelledby="tab-info">${information}</div>
      <div class="tab-panel" id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden><section class="panel">${timeline(auditLogs, renderAuditLog, "Audit Trail이 없습니다.")}</section></div>
    ` : `<div class="document-info">${information}</div>`}
    ${isAdmin && document.status === "active" ? disposeModal(document) : ""}
  `, session);
}

function detail(label, value) {
  return `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function documentActions(document) {
  if (document.status === "active") {
    return `<div class="button-group"><a class="button sm" href="/documents/${document.id}/edit">수정</a><button type="button" class="danger-button sm" data-open-modal="dispose-modal">폐기</button></div>`;
  }
  return `<div class="button-group"><form method="post" action="/documents/${document.id}/restore"><button type="submit" class="button sm">폐기 해제</button></form></div>`;
}

function disposeModal(document) {
  return `<dialog id="dispose-modal" class="modal"><form method="post" action="/documents/${document.id}/dispose" class="modal-body"><h3>문서 폐기</h3><label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">폐기 확인</button></div></form></dialog>`;
}

// 큰 구역 도면은 필요할 때만 펼치도록 기본 접힘 native details로 둔다.
// 문서가 보관된 랙(양면이면 그 면의 반쪽)만 파란색으로 강조한다.
function renderDocumentFloorPlan(document, floorPlan = []) {
  if (!floorPlan.length) {
    return "";
  }
  const region = floorPlan.find((item) => item.racks.some((rack) => rack.code === document.rack_code));
  const rackLabel = rackFaceLabel(document);
  const badge = `${document.zone_number ? `${document.zone_number}구역 ` : ""}${escapeHtml(rackLabel || document.rack_code)}번 랙`;

  if (!region) {
    return `
      <details class="panel doc-floor-plan">
        <summary><span>문서고 도면</span><span class="count-badge">${badge}</span></summary>
        <div class="doc-floor-plan-body"><p class="muted">이 문서의 랙은 현재 도면에 표시되지 않는 구역에 있습니다.</p></div>
      </details>
    `;
  }

  const single = readBoolean(document.is_single_sided);
  const orientation = rackViewOrientation(document);
  return `
    <details class="panel doc-floor-plan">
      <summary><span>문서고 도면 · ${escapeHtml(region.label)}</span><span class="count-badge">${badge}</span></summary>
      <div class="doc-floor-plan-body">
        ${zoneFloorPlanView(region, { hitCode: document.rack_code, hitFace: document.rack_face })}
        <p class="muted">파란색이 이 문서가 보관된 ${single ? `단면 랙입니다. ${orientation.description}` : `${escapeHtml(rackLabel)} 면(양면 랙의 ${document.rack_face === "B" ? "우측" : "좌측"})입니다. 1열은 통로 안쪽인 ${orientation.originLabel}에서 시작합니다.`}</p>
      </div>
    </details>
  `;
}

function renderMiniVisualizer(document) {
  const cols = Math.max(1, Number(document.column_count || 1));
  const rows = Math.max(1, Number(document.shelf_count || 3));
  const activeCol = Number(document.column_number || 0);
  const activeRow = Number(document.shelf_number || 0);
  const orientation = rackViewOrientation(document);
  const columns = Array.from({ length: cols }, (_, index) => index + 1);
  if (orientation.origin === "right") columns.reverse();
  let slots = "";

  for (let row = rows; row >= 1; row -= 1) {
    for (const col of columns) {
      const active = col === activeCol && row === activeRow;
      slots += `<div class="mini-slot ${active ? "active" : ""}" title="${col}열 ${row}선반"><span>${col}-${row}</span>${active ? `<i class="fa-solid fa-location-dot" aria-hidden="true"></i>` : ""}</div>`;
    }
  }

  // 선반 나침반: 추상 좌표를 랙 앞에 선 사람의 몸 기준 서수·방향으로 번역해 '어디부터 세지' 혼동을 없앤다.
  const ordinal = [
    activeRow ? `아래에서 ${activeRow}번째 선반` : "",
    activeCol ? `${orientation.originLabel}에서 ${activeCol}번째 열` : ""
  ].filter(Boolean).join(" · ");

  const rackLabel = rackFaceLabel(document);
  return `
    <section class="panel minimap-card">
      <div class="section-title"><h2>서가 위치 · ${document.zone_number ? `${document.zone_number}구역 ` : ""}${escapeHtml(rackLabel || document.rack_code)}번 랙</h2><span class="count-badge">${activeCol}열 ${activeRow}선반</span></div>
      <div class="mini-column-guide" data-column-origin="${orientation.origin}">
        <span>${orientation.origin === "left" ? "1열 · 통로 안쪽" : `${cols}열 · 바깥쪽`}</span>
        <strong>사용자 시선</strong>
        <span>${orientation.origin === "right" ? "1열 · 통로 안쪽" : `${cols}열 · 바깥쪽`}</span>
      </div>
      <div class="mini-rack-stage">
        <div class="mini-axis" aria-hidden="true"><span>위 ↑</span><span>아래 ↓</span></div>
        <div class="mini-rack-grid" data-column-origin="${orientation.origin}" style="--cols:${cols};--rows:${rows}">${slots}</div>
      </div>
      <p class="mini-orientation-note">${escapeHtml(orientation.description)} 선반은 아래에서 1선반부터 위로 올라갑니다.</p>
      ${ordinal ? `<p class="mini-compass"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> ${escapeHtml(ordinal)}${readBoolean(document.is_single_sided) ? "" : ` · 양면 랙 ${escapeHtml(rackLabel)} 면`}</p>` : ""}
    </section>
  `;
}

function rackViewOrientation(document) {
  const isZoneOne = Number(document.zone_number) === 1;
  const single = readBoolean(document.is_single_sided);
  const isZoneOneRightSingle = isZoneOne && single && Number(document.rack_number) === 1;
  const origin = document.rack_face === "B" || isZoneOneRightSingle ? "right" : "left";
  const originLabel = origin === "right" ? "오른쪽" : "왼쪽";
  const description = isZoneOneRightSingle
    ? "1구역 1번 단면랙은 우측 랙과 같은 방향이므로 오른쪽이 1열입니다."
    : single
      ? `단면랙을 정면에서 본 모습이며 ${originLabel}이 1열입니다.`
      : `${document.rack_face === "B" ? "우측 면" : "좌측 면"}을 정면에서 본 모습이며 ${originLabel}이 1열입니다.`;
  return { origin, originLabel, description };
}

function renderAuditLog(log) {
  const labels = { legacy_import: "기존 데이터", create: "등록", update: "수정", move: "이동", dispose: "폐기", restore: "폐기 해제", delete_permanent: "완전 삭제" };
  return timelineItem(`${labels[log.action] || log.action}: ${log.summary}`, `${log.actor} (${log.actor_role}) / ${log.created_at}`, publicAuditDetails(log.details));
}

function publicAuditDetails(details) {
  if (!details) return "";

  try {
    return JSON.stringify(removeInternalStorageCodes(JSON.parse(details)));
  } catch {
    // 과거 자유형식 감사 내용에도 ARC 코드가 있으면 화면에서는 가린다.
    return String(details).replace(/\bARC-\d+\b/gi, "[내부 식별자 숨김]");
  }
}

function removeInternalStorageCodes(value) {
  if (Array.isArray(value)) return value.map(removeInternalStorageCodes);
  if (!value || typeof value !== "object") {
    return typeof value === "string"
      ? value.replace(/\bARC-\d+\b/gi, "[내부 식별자 숨김]")
      : value;
  }

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key.replace(/[_-]/g, "").toLowerCase() !== "storagecode")
    .map(([key, item]) => [key, removeInternalStorageCodes(item)]));
}

export function documentImportPage({ session, result = null, error = "" }) {
  return page("CSV 가져오기", `
    <section class="page-head">
      <h1>문서 대량 등록</h1>
      <a class="button secondary" href="/documents/export.csv">CSV 내보내기</a>
    </section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      ${result ? importResult(result) : ""}
      <form method="post" action="/documents/import" class="stack" enctype="multipart/form-data">
        <label>CSV 파일<input type="file" name="csvFile" accept=".csv,text/csv"></label>
        <label>또는 CSV 붙여넣기<textarea name="csvText" rows="10" placeholder="documentNumber,revisionNumber,revisionDate,disposalDueYear,documentName,category,rackCode,rackColumn,shelfNumber,rackFace,tags,note,status"></textarea></label>
        <button type="submit" class="primary">가져오기</button>
      </form>
      <p class="muted">필수 열: documentNumber, revisionNumber, documentName, category, rackCode, rackColumn, shelfNumber, rackFace. 선택 열: revisionDate, disposalDueYear.</p>
      <p class="muted">rackFace는 1 또는 2로 적습니다(예: 13번 양면 랙 = 13-1/13-2, 구표기 A/B도 허용). 단면 랙은 1만 가능합니다. rackColumn은 1~7열, shelfNumber는 1~6선반입니다.</p>
    </section>
  `, session);
}

function importResult(result) {
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const summary = `<div class="alert ${failures.length ? "warning" : "success"}">${result.created}건 가져오기 완료${result.disposed ? `, 폐기 ${result.disposed}건 반영` : ""}${failures.length ? `, 실패 ${failures.length}건` : ""}</div>`;
  if (!failures.length) {
    return summary;
  }
  const items = failures.slice(0, 20).map((message) => `<li>${escapeHtml(message)}</li>`).join("");
  const more = failures.length > 20 ? `<li>… 외 ${failures.length - 20}건</li>` : "";
  return `${summary}<ul class="import-failures">${items}${more}</ul>`;
}

function paginationView(pagination, { query, filters }) {
  if (pagination.totalPages <= 1) return "";
  const previous = pagination.page > 1 ? pagination.page - 1 : 1;
  const next = pagination.page < pagination.totalPages ? pagination.page + 1 : pagination.totalPages;
  return paginationNav(pagination.page, pagination.totalPages, {
    previousUrl: documentListUrl({ query, filters, page: previous }),
    nextUrl: documentListUrl({ query, filters, page: next })
  });
}

function documentListUrl({ query, filters = {}, page = 1 }) {
  return listUrl("/documents", { query, filters, page }, [
    ["category", "categoryId"],
    ["zone", "zoneNumber"],
    ["tag", "tagId"],
    ["status", "status"],
    ["sort", "sort"]
  ]);
}

function bulkActionBar(action = "/documents/bulk-dispose", returnTo = "/documents/disposal") {
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

function documentToolbar(session) {
  if (session.role !== "Admin") return "";
  return `<div class="button-group document-toolbar"><a class="button" href="/documents/new">문서 등록</a><a class="button secondary" href="/documents/disposal">폐기 작업</a><a class="button secondary" href="/documents/import">CSV 가져오기</a><a class="button secondary" href="/documents/export.csv">엑셀 목록 내보내기</a></div>`;
}
