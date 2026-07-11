// 문서 목록·등록/수정·상세·CSV 가져오기 화면.

import { escapeHtml, locationLabel, rackFaceLabel, readBoolean } from "../utils.js";
import { zoneFloorPlanView } from "./floorPlanViews.js";
import { alertDanger, emptyResult, filterSelectRow, formValue, listUrl, option, page, paginationNav, statusBadge, timeline, timelineItem } from "./layout.js";
import { didYouMeanView, highlight, parsedChipRow, searchInputBlock } from "./searchViews.js";

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
  return page("문서 검색", `
    <section class="page-head">
      <h1>전체 문서</h1>
      ${documentToolbar(session)}
    </section>

    <section class="panel search-panel">
      <form method="get" action="/documents" class="filter-bar" id="documentFilterForm" data-search-form data-auto-submit>
        ${searchInputBlock(query, suggestions)}
        ${filterSelectRow({ categories, tags, filters })}
      </form>
    </section>

    ${parsedChipRow(parsedQuery, query) ? `<section class="panel chip-panel">${parsedChipRow(parsedQuery, query)}</section>` : ""}

    <section class="panel results-panel">
      <div class="section-title">
        <h2>${query ? `"${escapeHtml(query)}" 검색 결과` : "전체 보유문서"}</h2>
        <span class="count-badge">${pagination.totalDocuments}건</span>
      </div>
      ${documentResults(documents, { bulk: session.role === "Admin", emptyQuery: query, showScore: Boolean(query), query })}
      ${!documents.length && didYouMean.length ? didYouMeanView(didYouMean) : ""}
      ${paginationView(pagination, { query, filters })}
      ${session.role === "Admin" ? bulkActionBar() : ""}
    </section>
  `, session);
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

// 위치 입력 편의 스크립트. 서버 검증(validateDocumentInput)이 최종 방어선이다.
// 1) 랙당 42칸이 되면서 길어진 단일 목록 대신 랙 → 열 → 선반 3단으로 고른다(JS 미지원 시 원래 목록 사용).
// 2) 선택된 랙에 맞춰 면 선택지를 실물 표기(13-1/13-2)로 바꾸고, 단면 랙이면 2면을 잠근다.
function locationPickerScript() {
  return `
    <script>
      (function () {
        var slotSelect = document.querySelector('select[name="rackSlotId"]');
        var faceSelect = document.querySelector('select[data-rack-face]');
        if (!slotSelect) return;

        var faceA = faceSelect ? faceSelect.querySelector('option[value="A"]') : null;
        var faceB = faceSelect ? faceSelect.querySelector('option[value="B"]') : null;
        var syncFace = function () {
          if (!faceSelect) return;
          var opt = slotSelect.options[slotSelect.selectedIndex];
          var rackNumber = opt ? opt.getAttribute('data-rack-number') || '' : '';
          var single = opt ? opt.getAttribute('data-single-sided') === '1' : false;
          if (single) {
            faceSelect.value = 'A';
            faceB.disabled = true;
            faceA.textContent = rackNumber ? rackNumber + ' (단면 · 면 구분 없음)' : '단면 · 면 구분 없음';
            faceB.textContent = '단면 랙 · 2면 없음';
          } else {
            faceB.disabled = false;
            faceA.textContent = rackNumber ? rackNumber + '-1 (1면)' : '1면';
            faceB.textContent = rackNumber ? rackNumber + '-2 (2면)' : '2면';
          }
        };
        slotSelect.addEventListener('change', syncFace);

        var slotOptions = Array.prototype.slice.call(slotSelect.options).filter(function (o) { return o.value; });
        var racks = [];
        var rackByKey = {};
        slotOptions.forEach(function (o) {
          var key = o.getAttribute('data-zone') + ':' + o.getAttribute('data-rack-number');
          var rack = rackByKey[key];
          if (!rack) {
            rack = {
              key: key,
              zone: o.getAttribute('data-zone'),
              rackNumber: o.getAttribute('data-rack-number'),
              single: o.getAttribute('data-single-sided') === '1',
              columns: {},
              shelves: {},
              slots: {}
            };
            rackByKey[key] = rack;
            racks.push(rack);
          }
          var column = o.getAttribute('data-column');
          var shelf = o.getAttribute('data-shelf');
          rack.columns[column] = true;
          rack.shelves[shelf] = true;
          rack.slots[column + ':' + shelf] = o.value;
        });
        if (!racks.length) { syncFace(); return; }

        var numericKeys = function (map) {
          return Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
        };
        var fillSelect = function (select, placeholder, items, toLabel, selectedValue) {
          select.innerHTML = '';
          var blank = document.createElement('option');
          blank.value = '';
          blank.textContent = placeholder;
          select.appendChild(blank);
          items.forEach(function (item) {
            var option = document.createElement('option');
            option.value = String(item);
            option.textContent = toLabel(item);
            if (String(item) === String(selectedValue)) option.selected = true;
            select.appendChild(option);
          });
        };

        var row = document.createElement('div');
        row.className = 'picker-row';
        var rackSel = document.createElement('select');
        var colSel = document.createElement('select');
        var shelfSel = document.createElement('select');
        [rackSel, colSel, shelfSel].forEach(function (select) {
          select.required = true;
          row.appendChild(select);
        });

        var currentRack = function () { return rackByKey[rackSel.value] || null; };
        var refreshCells = function (selectedColumn, selectedShelf) {
          var rack = currentRack();
          colSel.disabled = shelfSel.disabled = !rack;
          fillSelect(colSel, '열 선택', rack ? numericKeys(rack.columns) : [], function (n) { return n + '열 (왼쪽에서)'; }, selectedColumn);
          fillSelect(shelfSel, '선반 선택', rack ? numericKeys(rack.shelves) : [], function (n) { return n + '선반 (아래에서)'; }, selectedShelf);
        };
        var apply = function () {
          var rack = currentRack();
          var slotId = rack && colSel.value && shelfSel.value ? rack.slots[colSel.value + ':' + shelfSel.value] || '' : '';
          slotSelect.value = slotId;
          syncFace();
        };

        fillSelect(rackSel, '랙 선택', racks.map(function (rack) { return rack.key; }), function (key) {
          var rack = rackByKey[key];
          return rack.zone + '구역 ' + rack.rackNumber + '번 랙 · ' + (rack.single ? '단면' : '양면 ' + rack.rackNumber + '-1/' + rack.rackNumber + '-2');
        }, '');

        var initial = slotSelect.options[slotSelect.selectedIndex];
        if (initial && initial.value) {
          rackSel.value = initial.getAttribute('data-zone') + ':' + initial.getAttribute('data-rack-number');
          refreshCells(initial.getAttribute('data-column'), initial.getAttribute('data-shelf'));
        } else {
          refreshCells('', '');
        }

        rackSel.addEventListener('change', function () { refreshCells('', ''); apply(); });
        colSel.addEventListener('change', apply);
        shelfSel.addEventListener('change', apply);

        // 원래 목록은 값 운반용으로만 남긴다. required를 3단 선택 쪽으로 옮겨
        // 숨긴 select가 브라우저 필수 검증(포커스 불가 오류)에 걸리지 않게 한다.
        slotSelect.required = false;
        slotSelect.style.display = 'none';
        slotSelect.insertAdjacentElement('afterend', row);
        syncFace();
      })();
    </script>
  `;
}

function locationPicker(slots, selectedRackSlotId) {
  // 위치 선택 스크립트(locationPickerScript)가 랙 → 열 → 선반 3단 선택과 면 표기 동기화에
  // 쓸 수 있도록 각 칸의 좌표·단면 여부를 data 속성으로 싣는다.
  return `
    <label>보관 위치 <em>*</em>
      <select name="rackSlotId" required>
        <option value="">위치 선택</option>
        ${slots.map((slot) => {
          const selected = String(slot.id) === String(selectedRackSlotId ?? "") ? " selected" : "";
          const label = slot.label || `${slot.zone_number}구역 / ${slot.rack_number}번 랙 / ${slot.column_number}열 / ${slot.shelf_number}선반`;
          const data = [
            `data-zone="${escapeHtml(String(slot.zone_number ?? ""))}"`,
            `data-rack-number="${escapeHtml(String(slot.rack_number ?? ""))}"`,
            `data-column="${escapeHtml(String(slot.column_number ?? ""))}"`,
            `data-shelf="${escapeHtml(String(slot.shelf_number ?? ""))}"`,
            `data-single-sided="${readBoolean(slot.is_single_sided) ? "1" : "0"}"`
          ].join(" ");
          return `<option value="${escapeHtml(String(slot.id))}" ${data}${selected}>${escapeHtml(label)}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

export function documentDetailsPage({ session, document, tags, disposalLogs, auditLogs, floorPlan = [] }) {
  const isAdmin = session.role === "Admin";
  return page(document.document_name, `
    <section class="page-head">
      <div>
        <nav class="breadcrumb" aria-label="경로"><a href="/app">홈</a><span>/</span><a href="/documents">문서 검색</a><span>/</span><span>상세</span></nav>
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
        <strong class="loc-label-lg">${escapeHtml(locationLabel(document))}</strong>
        <span class="mono">${escapeHtml(document.rack_code)} · ${escapeHtml(document.storage_code)}</span>
      </div>
      <div class="button-group">
        <button type="button" class="button secondary sm" data-copy-text="${escapeHtml(locationLabel(document))}">위치 복사</button>
        <a class="button secondary sm" href="/documents?q=${encodeURIComponent(document.rack_code)}">같은 랙 문서 보기</a>
      </div>
    </section>
    <div class="tab-nav" role="tablist" aria-label="문서 상세 정보">
      <button role="tab" aria-selected="true" data-tab="info" id="tab-info" aria-controls="panel-info">기본 정보</button>
      <button role="tab" aria-selected="false" data-tab="audit" id="tab-audit" aria-controls="panel-audit">감사 이력 <span class="tab-count">${auditLogs.length}</span></button>
      <button role="tab" aria-selected="false" data-tab="disposal" id="tab-disposal" aria-controls="panel-disposal">폐기 이력 <span class="tab-count">${disposalLogs.length}</span></button>
    </div>
    <div class="tab-panel" id="panel-info" role="tabpanel" aria-labelledby="tab-info">
      <section class="panel detail-grid">
        ${detail("문서번호", document.document_number)}
        ${detail("개정번호", document.revision_number)}
        ${detail("보관코드", document.storage_code)}
        ${detail("대분류", document.category_name)}
        ${detail("태그", tags.length ? tags.map((t) => t.name).join(", ") : "-")}
        ${detail("상태", document.status === "active" ? "보관중" : "폐기")}
        ${detail("비고", document.note || "-")}
      </section>
      ${renderDocumentFloorPlan(document, floorPlan)}
      ${renderMiniVisualizer(document)}
    </div>
    <div class="tab-panel" id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden><section class="panel">${timeline(auditLogs, renderAuditLog, "감사 이력이 없습니다.")}</section></div>
    <div class="tab-panel" id="panel-disposal" role="tabpanel" aria-labelledby="tab-disposal" hidden><section class="panel">${timeline(disposalLogs, renderDisposalLog, "폐기 이력이 없습니다.")}</section></div>
    ${isAdmin && document.status === "active" ? disposeModal(document) : ""}
    ${isAdmin && document.status !== "active" ? deleteModal(document) : ""}
  `, session);
}

function detail(label, value) {
  return `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function documentActions(document) {
  if (document.status === "active") {
    return `<div class="button-group"><a class="button sm" href="/documents/${document.id}/edit">수정</a><button type="button" class="danger-button sm" data-open-modal="dispose-modal">폐기</button></div>`;
  }
  return `<div class="button-group"><form method="post" action="/documents/${document.id}/restore"><button type="submit" class="button sm">폐기 해제</button></form><button type="button" class="danger-button sm" data-open-modal="delete-modal">완전 삭제</button></div>`;
}

function disposeModal(document) {
  return `<dialog id="dispose-modal" class="modal"><form method="post" action="/documents/${document.id}/dispose" class="modal-body"><h3>문서 폐기</h3><label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">폐기 확인</button></div></form></dialog>`;
}

function deleteModal(document) {
  return `<dialog id="delete-modal" class="modal"><form method="post" action="/documents/${document.id}/delete-permanent" class="modal-body"><h3>완전 삭제</h3><p class="danger-text">이 작업은 되돌릴 수 없습니다.</p><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">완전 삭제</button></div></form></dialog>`;
}

// 문서 상세 기본정보: 문서 정보와 서가 위치 사이에, 해당 구역만 확대한 도면을 넣고
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
      <section class="panel doc-floor-plan">
        <div class="section-title"><h2>문서고 도면</h2><span class="count-badge">${badge}</span></div>
        <p class="muted">이 문서의 랙은 현재 도면에 표시되지 않는 구역에 있습니다.</p>
      </section>
    `;
  }

  const single = readBoolean(document.is_single_sided);
  return `
    <section class="panel doc-floor-plan">
      <div class="section-title">
        <h2>문서고 도면 · ${escapeHtml(region.label)}</h2>
        <span class="count-badge">${badge}</span>
      </div>
      ${zoneFloorPlanView(region, { hitCode: document.rack_code, hitFace: document.rack_face })}
      <p class="muted">파란색이 이 문서가 보관된 ${single ? "랙" : `${escapeHtml(rackLabel)} 면(양면 랙의 ${document.rack_face === "B" ? "우측" : "좌측"})`}입니다.</p>
    </section>
  `;
}

function renderMiniVisualizer(document) {
  const cols = Math.max(1, Number(document.column_count || 1));
  const rows = Math.max(1, Number(document.shelf_count || 3));
  const activeCol = Number(document.column_number || 0);
  const activeRow = Number(document.shelf_number || 0);
  let slots = "";

  for (let row = rows; row >= 1; row -= 1) {
    for (let col = 1; col <= cols; col += 1) {
      const active = col === activeCol && row === activeRow;
      slots += `<div class="mini-slot ${active ? "active" : ""}" title="${col}열 ${row}행"><span>${col}-${row}</span>${active ? `<i class="fa-solid fa-location-dot" aria-hidden="true"></i>` : ""}</div>`;
    }
  }

  // 선반 나침반: 추상 좌표를 랙 앞에 선 사람의 몸 기준 서수·방향으로 번역해 '어디부터 세지' 혼동을 없앤다.
  const ordinal = [
    activeRow ? `아래에서 ${activeRow}번째 선반` : "",
    activeCol ? `왼쪽에서 ${activeCol}번째 열` : ""
  ].filter(Boolean).join(" · ");

  const rackLabel = rackFaceLabel(document);
  return `
    <section class="panel minimap-card">
      <div class="section-title"><h2>서가 위치 · ${document.zone_number ? `${document.zone_number}구역 ` : ""}${escapeHtml(rackLabel || document.rack_code)}번 랙</h2><span class="count-badge">${activeCol}열 ${activeRow}행</span></div>
      <div class="mini-rack-stage">
        <div class="mini-axis" aria-hidden="true"><span>위 ↑</span><span>아래 ↓</span></div>
        <div class="mini-rack-grid" style="--cols:${cols};--rows:${rows}">${slots}</div>
      </div>
      ${ordinal ? `<p class="mini-compass"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> ${escapeHtml(ordinal)}${readBoolean(document.is_single_sided) ? "" : ` · 양면 랙 ${escapeHtml(rackLabel)} 면`}</p>` : ""}
    </section>
  `;
}

function renderDisposalLog(log) {
  return timelineItem(log.action === "disposed" ? "문서 폐기" : "폐기 해제", `${log.performed_by} / ${log.created_at}`, log.reason || "-");
}

function renderAuditLog(log) {
  const labels = { legacy_import: "기존 데이터", create: "등록", update: "수정", move: "이동", dispose: "폐기", restore: "폐기 해제", delete_permanent: "완전 삭제" };
  return timelineItem(`${labels[log.action] || log.action}: ${log.summary}`, `${log.actor} (${log.actor_role}) / ${log.created_at}`, log.details || "");
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
        <label>또는 CSV 붙여넣기<textarea name="csvText" rows="10" placeholder="documentNumber,revisionNumber,documentName,category,rackCode,rackColumn,shelfNumber,rackFace,tags,note,status"></textarea></label>
        <button type="submit" class="primary">가져오기</button>
      </form>
      <p class="muted">필수 열: documentNumber, revisionNumber, documentName, category, rackCode, rackColumn, shelfNumber, rackFace</p>
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

export function documentResults(documents, opts = {}) {
  if (!documents.length) {
    return emptyResult(opts.emptyMessage || "조건에 맞는 문서가 없습니다.", opts.emptyQuery);
  }
  return `
    <div class="table-wrap" data-paginate-root>
      <table class="doc-table">
        <thead><tr>
          ${opts.bulk ? `<th class="check-col"><span class="sr-only">선택</span></th>` : ""}
          <th class="loc-col">보관 위치</th>
          <th>문서번호</th>
          <th>개정</th>
          <th>문서명</th>
          <th>대분류</th>
          <th>상태</th>
        </tr></thead>
        <tbody>${documents.map((doc) => documentRow(doc, opts)).join("")}</tbody>
      </table>
    </div>
  `;
}

function documentRow(doc, opts = {}) {
  return `
    <tr class="${doc.status !== "active" ? "is-disposed" : ""}">
      ${opts.bulk ? `<td class="check-col"><input type="checkbox" name="docId" value="${doc.id}" data-bulk-item aria-label="${escapeHtml(doc.document_name)} 선택"></td>` : ""}
      <td class="loc-cell" title="${escapeHtml(locationLabel(doc))}">
        <span class="loc-cell-main">${doc.zone_number ? `${doc.zone_number}구역 ` : ""}${escapeHtml(rackFaceLabel(doc) || doc.rack_code)}</span>
        <small class="loc-cell-sub">${escapeHtml(doc.column_number)}열 ${escapeHtml(doc.shelf_number)}선반</small>
      </td>
      <td class="mono-cell">${highlight(doc.document_number, opts.query || "")}</td>
      <td>${escapeHtml(doc.revision_number)}</td>
      <td class="name-cell">
        <a href="/documents/${doc.id}" data-doc-click="${doc.id}">${highlight(doc.document_name, opts.query || "")}</a>
        ${doc.note ? `<small>${escapeHtml(doc.note)}</small>` : ""}
        ${opts.showScore && doc.match_reason ? `<small class="match-line">${escapeHtml(doc.match_reason)}</small>` : ""}
      </td>
      <td>${escapeHtml(doc.category_name)}</td>
      <td class="status-cell">${statusBadge(doc.status)}</td>
    </tr>
  `;
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

function bulkActionBar() {
  return `
    <div class="bulk-bar" data-bulk-bar hidden>
      <span data-bulk-count>0건 선택</span>
      <form method="post" action="/documents/bulk-dispose" data-bulk-form>
        <input type="hidden" name="ids" data-bulk-ids>
        <label class="bulk-reason"><input name="reason" placeholder="폐기 사유" required></label>
        <button type="submit" class="danger-button sm">일괄 폐기</button>
      </form>
    </div>
  `;
}

function documentToolbar(session) {
  if (session.role !== "Admin") return "";
  return `<div class="button-group"><a class="button" href="/documents/new">문서 등록</a><a class="button secondary" href="/documents/import">CSV 가져오기</a><a class="button secondary" href="/documents/export.csv">CSV 내보내기</a></div>`;
}
