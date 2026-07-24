import { escapeHtml } from "../ui/html/escape.js";
import { alertDanger, option, page } from "./layout.js";

const STATUS_LABELS = Object.freeze({
  draft: "초안",
  frozen: "대상 확정",
  processing: "처리 중",
  completed: "완료",
  cancelled: "취소",
  pending: "대기",
  excluded: "제외",
  changed: "변경됨",
  failed: "실패"
});

export function disposalBatchListPage({ session, batches = [] }) {
  const rows = batches.map((batch) => `
    <tr>
      <td class="mono" data-label="캠페인 번호"><a href="/disposal-batches/${batch.id}">${escapeHtml(batch.batch_code)}</a></td>
      <td data-label="제목"><strong>${escapeHtml(batch.title)}</strong></td>
      <td data-label="상태">${statusLabel(batch.status)}</td>
      <td data-label="조건">${escapeHtml(criteriaText(batch.criteria, batch.category_name))}</td>
      <td data-label="폐기 사유">${escapeHtml(batch.disposal_reason)}</td>
      <td data-label="승인 참조">${escapeHtml(batch.approval_reference || "-")}</td>
      <td data-label="총 대상 / 완료">${number(batch.target_count)} / ${number(batch.completed_count)}</td>
      <td data-label="제외 / 변경 / 실패">${number(batch.excluded_count)} / ${number(batch.changed_count)} / ${number(batch.failed_count)}</td>
      <td data-label="담당 / 완료일">${escapeHtml(batch.completed_by_name || batch.created_by_name)}<small>${escapeHtml(batch.completed_at || batch.created_at)}</small></td>
    </tr>
  `).join("");
  return page("정기폐기 캠페인 이력", `
    <section class="page-head">
      <div><h1>정기폐기 캠페인 이력</h1><p class="muted">한 번의 정기폐기를 캠페인 단위로 조회하고, 대상·사유·처리 결과를 함께 추적합니다.</p></div>
      <div class="button-group"><a class="button secondary" href="/documents/disposal">소량 폐기</a><a class="button" href="/disposal-batches/new">새 정기폐기</a></div>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>캠페인 목록</h2><span class="count-badge">${batches.length}건</span></div>
      <div class="table-wrap"><table class="doc-table">
        <thead><tr><th>캠페인 번호</th><th>제목</th><th>상태</th><th>조건</th><th>폐기 사유</th><th>승인 참조</th><th>총 대상 / 완료</th><th>제외 / 변경 / 실패</th><th>담당 / 완료일</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="empty">등록된 정기폐기 캠페인이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </section>
  `, session);
}

export function periodicDisposalPage({
  session,
  values = {},
  categories = [],
  years = [],
  preview = [],
  targetCount = 0,
  maxTargetCount = 0,
  error = ""
}) {
  const criteria = values.criteria || {};
  const hasCriteria = Boolean(criteria.disposalDueYear || criteria.categoryId);
  const category = categories.find((item) => Number(item.id) === Number(criteria.categoryId));
  const criteriaLabel = criteriaText(criteria, category?.name);
  const previewRows = preview.map((item) => `
    <tr>
      <td class="check-col" data-label="선택"><input type="checkbox" checked disabled aria-label="${escapeHtml(item.document_name)} 정기폐기 대상"></td>
      <td class="mono" data-label="문서번호">${escapeHtml(item.document_number)}</td>
      <td data-label="개정">${escapeHtml(item.revision_number)}</td>
      <td data-label="문서명">${escapeHtml(item.document_name)}</td>
      <td data-label="대분류">${escapeHtml(item.category_name)}</td>
      <td data-label="폐기연도">${escapeHtml(item.disposal_due_year ?? "-")}</td>
      <td class="location-cell" data-label="보관 위치">${escapeHtml(item.location_snapshot)}</td>
    </tr>
  `).join("");
  const overLimit = maxTargetCount > 0 && targetCount > maxTargetCount;
  const defaultTitle = values.title || (criteria.disposalDueYear
    ? `${criteria.disposalDueYear}년 정기폐기${category?.name ? ` · ${category.name}` : ""}`
    : `정기폐기${category?.name ? ` · ${category.name}` : ""}`);

  return page("정기폐기 캠페인", `
    <section class="page-head">
      <div><nav class="breadcrumb" aria-label="경로"><a href="/documents/disposal">문서 폐기</a><span>/</span><span>정기폐기</span></nav><h1>정기폐기 캠페인</h1><p class="muted">폐기 예정 연도와 대분류로 찾은 전체 문서를 한 캠페인 대상으로 확정하고 일괄 처리합니다.</p></div>
      <div class="button-group"><a class="button secondary" href="/disposal-batches">캠페인 이력</a><a class="button secondary" href="/documents/disposal">돌아가기</a></div>
    </section>
    ${error ? alertDanger(error) : ""}
    <section class="panel">
      <div class="section-title"><h2>1. 정기폐기 대상 조회</h2>${hasCriteria ? `<span class="count-badge">전체 ${number(targetCount)}건</span>` : ""}</div>
      <form method="get" action="/disposal-batches/new" class="filter-row periodic-disposal-filter">
        <label>폐기 예정 연도<select name="disposalDueYear"><option value="">전체</option>${years.map((year) => option(year, `${year}년`, criteria.disposalDueYear)).join("")}</select></label>
        <label>대분류<select name="categoryId"><option value="">전체</option>${categories.map((item) => option(item.id, item.name, criteria.categoryId)).join("")}</select></label>
        <button type="submit" class="button">대상 조회</button>
        <a class="button secondary" href="/disposal-batches/new">초기화</a>
      </form>
      <p class="muted">두 조건 중 하나 이상을 선택하세요. 조회 결과 전체가 선택되며, 화면에는 검토용 일부 문서만 표시됩니다.</p>
    </section>
    ${hasCriteria ? `
      <section class="panel results-panel">
        <div class="section-title"><h2>전체 선택 결과</h2><span class="count-badge">전체 ${number(targetCount)}건 선택됨</span></div>
        ${overLimit ? `<div class="alert warning">대상이 안전 상한 ${number(maxTargetCount)}건을 초과합니다. 연도 또는 대분류 조건을 더 좁혀 주세요.</div>` : ""}
        ${targetCount > preview.length ? `<div class="alert">검토 편의를 위해 앞의 ${number(preview.length)}건만 표시합니다. 실제 캠페인에는 조건과 일치하는 전체 ${number(targetCount)}건이 대상으로 확정됩니다.</div>` : ""}
        <div class="table-wrap"><table class="doc-table">
          <thead><tr><th class="check-col"><input type="checkbox" checked disabled aria-label="필터 결과 전체 선택됨"></th><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>폐기연도</th><th>보관 위치</th></tr></thead>
          <tbody>${previewRows || `<tr><td colspan="7" class="empty">조건에 맞는 보관중 문서가 없습니다.</td></tr>`}</tbody>
        </table></div>
      </section>
      ${targetCount ? `
        <section class="panel narrow">
          <div class="section-title"><h2>2. 사유 입력 및 전체 폐기</h2><span class="count-badge">${number(targetCount)}건</span></div>
          <form method="post" action="/documents/dispose-filtered" class="stack">
            <input type="hidden" name="disposalDueYear" value="${escapeHtml(criteria.disposalDueYear || "")}">
            <input type="hidden" name="categoryId" value="${escapeHtml(criteria.categoryId || "")}">
            <input type="hidden" name="confirmedTargetCount" value="${numberValue(targetCount)}">
            <label>캠페인 제목 <em>*</em><input name="title" value="${escapeHtml(defaultTitle)}" required></label>
            <label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required>${escapeHtml(values.disposalReason || "")}</textarea></label>
            <label>승인 문서 참조<input name="approvalReference" value="${escapeHtml(values.approvalReference || "")}" placeholder="결재 번호 또는 관련 문서번호"></label>
            <button type="button" class="danger-button" data-open-modal="periodic-disposal-confirm" ${overLimit ? "disabled" : ""}>총 ${number(targetCount)}건 전체 폐기 확인</button>
            <dialog id="periodic-disposal-confirm" class="modal disposal-review-modal" aria-labelledby="periodic-disposal-confirm-title">
              <div class="modal-body">
                <h2 id="periodic-disposal-confirm-title">정기폐기 최종 확인</h2>
                <p class="muted">${escapeHtml(criteriaLabel)} 조건의 현재 보관중 문서 전체를 폐기합니다.</p>
                <p class="disposal-count-confirmation">총 폐기 문서 수가 <strong>${number(targetCount)}건</strong>이 맞습니까?</p>
                <p class="danger-text">확인하면 캠페인 대상이 확정되고 전체 처리가 자동으로 시작됩니다. 문서별 감사이력과 캠페인 집계이력은 모두 보존됩니다.</p>
                <div class="modal-actions">
                  <button type="button" class="button secondary" data-close-modal>취소</button>
                  <button type="submit" class="danger-button" name="confirmDisposal" value="1">예, ${number(targetCount)}건 전체 폐기합니다</button>
                </div>
              </div>
            </dialog>
          </form>
        </section>
      ` : ""}
    ` : ""}
  `, session);
}

export function disposalBatchFormPage({
  session,
  batch = null,
  values = {},
  categories = [],
  racks = [],
  preview = [],
  previewCount = preview.length,
  capped = false,
  error = ""
}) {
  const criteria = values.criteria || values;
  const action = batch ? `/disposal-batches/${batch.id}/edit` : "/disposal-batches";
  const title = batch ? "폐기 캠페인 초안 수정" : "폐기 캠페인 생성";
  const previewRows = preview.map((item) => `
    <tr>
      <td class="mono" data-label="문서번호">${escapeHtml(item.document_number)}</td>
      <td data-label="개정">${escapeHtml(item.revision_number)}</td>
      <td data-label="문서명">${escapeHtml(item.document_name)}</td>
      <td data-label="대분류">${escapeHtml(item.category_name)}</td>
      <td data-label="폐기연도">${escapeHtml(item.disposal_due_year ?? "-")}</td>
      <td class="location-cell" data-label="보관 위치">${escapeHtml(item.location_snapshot)}</td>
      <td data-label="최근 수정">${escapeHtml(item.updated_at)}</td>
    </tr>
  `).join("");
  return page(title, `
    <section class="page-head">
      <div><h1>${title}</h1><p class="muted">최소 한 조건을 지정하고 미리보기 후 대상을 확정합니다.</p></div>
      <a class="button secondary" href="${batch ? `/disposal-batches/${batch.id}` : "/disposal-batches"}">돌아가기</a>
    </section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${action}" class="stack">
        ${batch ? `<input type="hidden" name="expectedUpdatedAt" value="${escapeHtml(batch.updated_at)}">` : ""}
        <label>제목 <em>*</em><input name="title" value="${escapeHtml(values.title || "")}" required></label>
        <label>폐기 사유 <em>*</em><textarea name="disposalReason" rows="3" required>${escapeHtml(values.disposalReason || values.disposal_reason || "")}</textarea></label>
        <label>승인 문서 참조<input name="approvalReference" value="${escapeHtml(values.approvalReference || values.approval_reference || "")}" placeholder="외부 결재번호 또는 문서번호"></label>
        <fieldset class="stack">
          <legend>폐기 조건</legend>
          <label>폐기 예정 연도<input type="number" name="disposalDueYear" min="1900" max="9999" value="${escapeHtml(criteria.disposalDueYear || "")}"></label>
          <label>연도 비교<select name="yearMode">${option("exact", "정확히 일치", criteria.yearMode || "exact")}${option("lte", "선택 연도 이하", criteria.yearMode)}</select></label>
          <label>대분류<select name="categoryId"><option value="">전체</option>${categories.map((item) => option(item.id, item.name, criteria.categoryId)).join("")}</select></label>
          <label>구역<select name="zoneNumber"><option value="">전체</option>${[1, 2, 3].map((zone) => option(zone, `${zone}구역`, criteria.zoneNumber)).join("")}</select></label>
          <label>랙<select name="rackId"><option value="">전체</option>${racks.map((item) => option(item.id, `${item.zone_number}구역 ${item.rack_number}번 랙`, criteria.rackId)).join("")}</select></label>
        </fieldset>
        <button type="submit" class="primary">초안 저장</button>
      </form>
    </section>
    ${batch ? `
      <section class="panel results-panel">
        <div class="section-title"><h2>현재 조건 미리보기</h2><span class="count-badge">전체 ${number(previewCount)}건</span></div>
        ${capped ? `<div class="alert">앞의 ${number(preview.length)}건만 표시합니다. 대상 확정 시 조건에 맞는 전체 ${number(previewCount)}건을 다시 확인합니다.</div>` : ""}
        <div class="table-wrap"><table class="doc-table">
          <thead><tr><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>폐기연도</th><th>보관 위치</th><th>최근 수정</th></tr></thead>
          <tbody>${previewRows || `<tr><td colspan="7" class="empty">조건에 맞는 보관중 문서가 없습니다.</td></tr>`}</tbody>
        </table></div>
      </section>
    ` : ""}
  `, session);
}

export function disposalBatchDetailPage({
  session,
  batch,
  items = [],
  preview = [],
  previewCount = preview.length,
  previewCapped = false,
  itemStatus = "",
  autoStart = false,
  error = ""
}) {
  const previewRows = preview.map((item) => `
    <tr>
      <td class="mono" data-label="문서번호">${escapeHtml(item.document_number)}</td>
      <td data-label="개정">${escapeHtml(item.revision_number)}</td>
      <td data-label="문서명">${escapeHtml(item.document_name)}</td>
      <td data-label="대분류">${escapeHtml(item.category_name)}</td>
      <td data-label="폐기연도">${escapeHtml(item.disposal_due_year ?? "-")}</td>
      <td class="location-cell" data-label="보관 위치">${escapeHtml(item.location_snapshot)}</td>
      <td data-label="최근 수정">${escapeHtml(item.updated_at)}</td>
    </tr>`).join("");
  const itemRows = items.map((item) => `
    <tr>
      <td class="mono" data-label="문서번호">${escapeHtml(item.document_number_snapshot)}</td>
      <td data-label="개정">${escapeHtml(item.revision_number_snapshot)}</td>
      <td data-label="문서명">${escapeHtml(item.document_name_snapshot)}</td>
      <td data-label="대분류">${escapeHtml(item.category_snapshot || "-")}</td>
      <td class="location-cell" data-label="확정 위치">${escapeHtml(item.location_snapshot || "-")}</td>
      <td data-label="폐기연도">${escapeHtml(item.disposal_due_year_snapshot ?? "-")}</td>
      <td data-label="결과">${statusLabel(item.status)}</td>
      <td data-label="사유">${escapeHtml(item.exclusion_reason || item.result_message || "-")}</td>
      <td data-label="동작">${itemAction(batch, item)}</td>
    </tr>
  `).join("");
  const pending = number(batch.pending_count);
  return page(`${batch.batch_code} 폐기 캠페인`, `
    <section class="page-head">
      <div><h1>${escapeHtml(batch.title)}</h1><p class="mono muted">${escapeHtml(batch.batch_code)}</p></div>
      <div class="button-group">
        <a class="button secondary" href="/disposal-batches/${batch.id}/export.csv">CSV</a>
        <button type="button" class="button secondary" data-print-page>인쇄</button>
        <a class="button secondary" href="/disposal-batches">목록</a>
      </div>
    </section>
    ${error ? alertDanger(error) : ""}
    <section class="panel detail-grid">
      ${detail("상태", STATUS_LABELS[batch.status] || batch.status)}
      ${detail("폐기 사유", batch.disposal_reason)}
      ${detail("승인 참조", batch.approval_reference || "-")}
      ${detail("조건", criteriaText(batch.criteria, batch.category_name))}
      ${detail("생성", `${batch.created_by_name} / ${batch.created_at}`)}
      ${detail("대상 확정", batch.frozen_at ? `${batch.frozen_by_name} / ${batch.frozen_at}` : "-")}
      ${detail("완료", batch.completed_at ? `${batch.completed_by_name} / ${batch.completed_at}` : "-")}
    </section>
    ${batch.status === "draft" ? `<section class="panel results-panel" aria-labelledby="disposal-preview-title"><div class="section-title"><h2 id="disposal-preview-title">최신 대상 미리보기</h2><span class="count-badge">전체 ${number(previewCount)}건</span></div>${previewCapped ? `<div class="alert">앞의 ${number(preview.length)}건만 표시합니다. 대상 확정 시 전체 ${number(previewCount)}건을 스냅샷으로 고정합니다.</div>` : ""}<div class="table-wrap"><table class="doc-table"><thead><tr><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>폐기연도</th><th>보관 위치</th><th>최근 수정</th></tr></thead><tbody>${previewRows || `<tr><td colspan="7" class="empty">조건에 맞는 보관중 문서가 없습니다.</td></tr>`}</tbody></table></div></section>` : ""}
    <section class="panel">
      <div class="metric-grid" data-disposal-progress>
        ${metric("대상", batch.target_count, "target_count")}
        ${metric("완료", batch.completed_count, "completed_count")}
        ${metric("제외", batch.excluded_count, "excluded_count")}
        ${metric("변경", batch.changed_count, "changed_count")}
        ${metric("실패", batch.failed_count, "failed_count")}
        ${metric("대기", pending, "pending_count")}
      </div>
      ${batchActions(batch, previewCount)}
      <p class="muted" data-process-message aria-live="polite"></p>
    </section>
    <section class="panel results-panel">
      <div class="section-title">
        <h2>확정 문서</h2><span class="count-badge">${number(items.length)} / ${number(itemStatusCount(batch, itemStatus))}건 표시</span>
      </div>
      ${items.length < itemStatusCount(batch, itemStatus) ? `<div class="alert">화면에는 앞의 ${number(items.length)}건만 표시합니다. 전체 결과는 상단 집계와 CSV에서 확인할 수 있습니다.</div>` : ""}
      <nav class="filter-row" aria-label="항목 상태 필터">
        ${["", "pending", "excluded", "completed", "changed", "failed"].map((status) => `<a class="button secondary sm" href="/disposal-batches/${batch.id}${status ? `?status=${status}` : ""}" ${status === itemStatus ? `aria-current="page"` : ""}>${status ? STATUS_LABELS[status] : "전체"}</a>`).join("")}
      </nav>
      <div class="table-wrap"><table class="doc-table">
        <thead><tr><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>확정 위치</th><th>폐기연도</th><th>결과</th><th>사유</th><th>동작</th></tr></thead>
        <tbody>${itemRows || `<tr><td colspan="9" class="empty">해당 상태의 문서가 없습니다.</td></tr>`}</tbody>
      </table></div>
    </section>
    ${processingScript(batch, autoStart)}
  `, session);
}

function batchActions(batch, previewCount = 0) {
  if (batch.status === "draft") {
    return `<div class="disposal-review-actions">
      <a class="button secondary" href="/disposal-batches/${batch.id}/edit">조건 수정</a>
      <form method="post" action="/disposal-batches/${batch.id}/freeze" class="stack">
        <input type="hidden" name="expectedUpdatedAt" value="${escapeHtml(batch.updated_at)}">
        <label>미리보기 대상 건수 재확인<input type="number" name="confirmedTargetCount" required min="${previewCount}" max="${previewCount}" inputmode="numeric"></label>
        <label class="checkbox"><input type="checkbox" name="confirmPreview" value="1" required> 최신 미리보기 ${number(previewCount)}건과 조건을 확인했습니다.</label>
        <button type="submit" class="button" ${!previewCount ? "disabled" : ""}>전체 대상 확정</button>
      </form>
      <form method="post" action="/disposal-batches/${batch.id}/cancel" data-confirm="아직 폐기된 문서는 없습니다. 이 캠페인 초안을 취소할까요?"><button type="submit" class="danger-button">취소</button></form>
    </div>`;
  }
  if (batch.status === "frozen") {
    return `<div class="button-group">
      <form method="post" action="/disposal-batches/${batch.id}/start" class="stack"><label>확정 대상 건수 재확인<input type="number" name="confirmedTargetCount" required min="${Number(batch.target_count || 0)}" max="${Number(batch.target_count || 0)}" inputmode="numeric"></label><label class="checkbox"><input type="checkbox" name="confirmStart" value="1" required> 확정 대상 ${number(batch.target_count)}건을 확인했으며 폐기 처리를 시작합니다.</label><button type="submit" class="danger-button">폐기 처리 시작</button></form>
      <form method="post" action="/disposal-batches/${batch.id}/cancel" data-confirm="아직 처리되지 않은 항목만 취소되며 이미 완료된 폐기 결과는 유지됩니다. 캠페인을 취소할까요?"><button type="submit" class="danger-button">취소</button></form>
    </div>`;
  }
  if (batch.status === "processing") {
    return `<div class="button-group">
      <button type="button" class="danger-button" data-process-disposal>전체 폐기 재개</button>
      <button type="button" class="button secondary" data-stop-disposal disabled>처리 중단</button>
    </div>`;
  }
  return "";
}

function itemAction(batch, item) {
  if (batch.status !== "frozen") return "";
  if (item.status === "pending") {
    return `<form method="post" action="/disposal-batches/${batch.id}/items/${item.id}/exclude" class="button-group"><label class="sr-only" for="exclude-reason-${item.id}">제외 사유</label><input id="exclude-reason-${item.id}" name="reason" placeholder="제외 사유" required><button type="submit" class="button secondary sm">제외</button></form>`;
  }
  if (item.status === "excluded") {
    return `<form method="post" action="/disposal-batches/${batch.id}/items/${item.id}/include"><button type="submit" class="button secondary sm">재포함</button></form>`;
  }
  return "";
}

function processingScript(batch, autoStart = false) {
  if (batch.status !== "processing") {
    return `<script>document.querySelector('[data-print-page]')?.addEventListener('click', function () { window.print(); });</script>`;
  }
  return `<script>
    (function () {
      var runButton = document.querySelector('[data-process-disposal]');
      var stopButton = document.querySelector('[data-stop-disposal]');
      var message = document.querySelector('[data-process-message]');
      var csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
      var running = false;
      document.querySelector('[data-print-page]')?.addEventListener('click', function () { window.print(); });
      function update(batch) {
        ['target_count','completed_count','excluded_count','changed_count','failed_count','pending_count'].forEach(function (key) {
          var node = document.querySelector('[data-progress-value="' + key + '"]');
          if (node) node.textContent = String(batch[key] || 0);
        });
      }
      function progressText(batch) {
        var completed = Number(batch.completed_count || 0);
        var changed = Number(batch.changed_count || 0);
        var failed = Number(batch.failed_count || 0);
        var excluded = Number(batch.excluded_count || 0);
        var processed = completed + changed + failed + excluded;
        return '전체 ' + Number(batch.target_count || 0).toLocaleString('ko-KR') +
          '건 중 ' + processed.toLocaleString('ko-KR') + '건 처리했습니다.';
      }
      async function processNext() {
        while (running) {
          var body = new URLSearchParams({ csrf_token: csrf });
          var response = await fetch('/disposal-batches/${Number(batch.id)}/process', {
            method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body
          });
          var result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.message || '처리를 계속할 수 없습니다.');
          update(result.batch || {});
          if (result.done) {
            message.textContent = '정기폐기 캠페인 처리가 완료되었습니다.';
            window.location.replace('/disposal-batches/${Number(batch.id)}?completed=1');
            return;
          }
          message.textContent = progressText(result.batch || {}) + ' 남은 문서를 자동으로 계속 처리합니다.';
        }
      }
      function startProcessing() {
        if (running) return;
        running = true; runButton.disabled = true; stopButton.disabled = false;
        message.textContent = '전체 ${number(batch.target_count)}건의 정기폐기를 시작합니다.';
        processNext().catch(function (error) {
          running = false; runButton.disabled = false; stopButton.disabled = true;
          message.textContent = error.message + ' 다시 시도할 수 있습니다.';
        });
      }
      runButton?.addEventListener('click', startProcessing);
      stopButton?.addEventListener('click', function () {
        running = false; runButton.disabled = false; stopButton.disabled = true;
        message.textContent = '처리를 중단했습니다. 완료된 항목은 저장되었으며 나중에 재개할 수 있습니다.';
      });
      if (${autoStart ? "true" : "false"}) startProcessing();
    })();
  </script>`;
}

function criteriaText(criteria = {}, categoryName = "") {
  const parts = [];
  if (criteria.disposalDueYear) parts.push(`폐기연도 ${criteria.yearMode === "lte" ? `${criteria.disposalDueYear}년 이하` : `${criteria.disposalDueYear}년`}`);
  if (criteria.categoryId) parts.push(categoryName ? `대분류 ${categoryName}` : `대분류 #${criteria.categoryId}`);
  if (criteria.zoneNumber) parts.push(`${criteria.zoneNumber}구역`);
  if (criteria.rackId) parts.push(`랙 #${criteria.rackId}`);
  return parts.join(" · ") || "조건 없음";
}

function statusLabel(status) {
  const type = status === "failed" || status === "cancelled" ? "disposed" : status === "completed" ? "active" : "pending";
  return `<span class="status ${type}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

function detail(label, value) {
  return `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function metric(label, value, key) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong data-progress-value="${key}">${number(value)}</strong></div>`;
}

function number(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function numberValue(value) {
  return String(Math.max(0, Number(value) || 0));
}

function itemStatusCount(batch, status) {
  if (status === "pending") return Number(batch.pending_count || 0);
  if (status === "excluded") return Number(batch.excluded_count || 0);
  if (status === "completed") return Number(batch.completed_count || 0);
  if (status === "changed") return Number(batch.changed_count || 0);
  if (status === "failed") return Number(batch.failed_count || 0);
  return Number(batch.target_count || 0);
}
