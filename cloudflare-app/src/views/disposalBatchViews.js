import { escapeHtml } from "../utils.js";
import { alertDanger, option, page } from "./layout.js";

const STATUS_LABELS = Object.freeze({
  draft: "초안",
  frozen: "대상 동결",
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
      <td class="mono"><a href="/disposal-batches/${batch.id}">${escapeHtml(batch.batch_code)}</a></td>
      <td><strong>${escapeHtml(batch.title)}</strong></td>
      <td>${statusLabel(batch.status)}</td>
      <td>${number(batch.target_count)}</td>
      <td>${number(batch.completed_count)} / ${number(batch.excluded_count)} / ${number(batch.changed_count)} / ${number(batch.failed_count)}</td>
      <td>${escapeHtml(batch.created_by_name)}</td>
      <td>${escapeHtml(batch.created_at)}</td>
    </tr>
  `).join("");
  return page("폐기 캠페인", `
    <section class="page-head">
      <div><h1>폐기 캠페인</h1><p class="muted">대상을 동결한 뒤 분할 처리하며, 완료 이력을 보고서로 보존합니다.</p></div>
      <a class="button" href="/disposal-batches/new">새 캠페인</a>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>캠페인 목록</h2><span class="count-badge">${batches.length}건</span></div>
      <div class="table-wrap"><table class="doc-table">
        <thead><tr><th>캠페인 번호</th><th>제목</th><th>상태</th><th>대상</th><th>완료 / 제외 / 변경 / 실패</th><th>생성자</th><th>생성일</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">등록된 폐기 캠페인이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </section>
  `, session);
}

export function disposalBatchFormPage({
  session,
  batch = null,
  values = {},
  categories = [],
  racks = [],
  preview = [],
  capped = false,
  error = ""
}) {
  const criteria = values.criteria || values;
  const action = batch ? `/disposal-batches/${batch.id}/edit` : "/disposal-batches";
  const title = batch ? "폐기 캠페인 초안 수정" : "폐기 캠페인 생성";
  const previewRows = preview.map((item) => `
    <tr>
      <td class="mono">${escapeHtml(item.document_number)}</td>
      <td>${escapeHtml(item.revision_number)}</td>
      <td>${escapeHtml(item.document_name)}</td>
      <td>${escapeHtml(item.category_name)}</td>
      <td>${escapeHtml(item.disposal_due_year ?? "-")}</td>
      <td class="location-cell">${escapeHtml(item.location_snapshot)}</td>
      <td>${escapeHtml(item.updated_at)}</td>
    </tr>
  `).join("");
  return page(title, `
    <section class="page-head">
      <div><h1>${title}</h1><p class="muted">최소 한 조건을 지정하고 미리보기 후 대상을 동결합니다.</p></div>
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
        <div class="section-title"><h2>현재 조건 미리보기</h2><span class="count-badge">${preview.length}${capped ? "+" : ""}건</span></div>
        ${capped ? `<div class="alert warning">대상이 200건을 초과합니다. 조건을 더 좁혀 주세요.</div>` : ""}
        <div class="table-wrap"><table class="doc-table">
          <thead><tr><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>폐기연도</th><th>보관 위치</th><th>최근 수정</th></tr></thead>
          <tbody>${previewRows || `<tr><td colspan="7" class="empty">조건에 맞는 보관중 문서가 없습니다.</td></tr>`}</tbody>
        </table></div>
      </section>
    ` : ""}
  `, session);
}

export function disposalBatchDetailPage({ session, batch, items = [], itemStatus = "", error = "" }) {
  const itemRows = items.map((item) => `
    <tr>
      <td class="mono">${escapeHtml(item.document_number_snapshot)}</td>
      <td>${escapeHtml(item.revision_number_snapshot)}</td>
      <td>${escapeHtml(item.document_name_snapshot)}</td>
      <td>${escapeHtml(item.category_snapshot || "-")}</td>
      <td class="location-cell">${escapeHtml(item.location_snapshot || "-")}</td>
      <td>${escapeHtml(item.disposal_due_year_snapshot ?? "-")}</td>
      <td>${statusLabel(item.status)}</td>
      <td>${escapeHtml(item.exclusion_reason || item.result_message || "-")}</td>
      <td>${itemAction(batch, item)}</td>
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
      ${detail("조건", criteriaText(batch.criteria))}
      ${detail("생성", `${batch.created_by_name} / ${batch.created_at}`)}
      ${detail("동결", batch.frozen_at ? `${batch.frozen_by_name} / ${batch.frozen_at}` : "-")}
      ${detail("완료", batch.completed_at ? `${batch.completed_by_name} / ${batch.completed_at}` : "-")}
    </section>
    <section class="panel">
      <div class="metric-grid" data-disposal-progress>
        ${metric("대상", batch.target_count, "target_count")}
        ${metric("완료", batch.completed_count, "completed_count")}
        ${metric("제외", batch.excluded_count, "excluded_count")}
        ${metric("변경", batch.changed_count, "changed_count")}
        ${metric("실패", batch.failed_count, "failed_count")}
        ${metric("대기", pending, "pending_count")}
      </div>
      ${batchActions(batch)}
      <p class="muted" data-process-message aria-live="polite"></p>
    </section>
    <section class="panel results-panel">
      <div class="section-title">
        <h2>동결 문서</h2><span class="count-badge">${items.length}건</span>
      </div>
      <nav class="filter-row" aria-label="항목 상태 필터">
        ${["", "pending", "excluded", "completed", "changed", "failed"].map((status) => `<a class="button secondary sm" href="/disposal-batches/${batch.id}${status ? `?status=${status}` : ""}" ${status === itemStatus ? `aria-current="page"` : ""}>${status ? STATUS_LABELS[status] : "전체"}</a>`).join("")}
      </nav>
      <div class="table-wrap"><table class="doc-table">
        <thead><tr><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>동결 위치</th><th>폐기연도</th><th>결과</th><th>사유</th><th>동작</th></tr></thead>
        <tbody>${itemRows || `<tr><td colspan="9" class="empty">해당 상태의 문서가 없습니다.</td></tr>`}</tbody>
      </table></div>
    </section>
    ${processingScript(batch)}
  `, session);
}

function batchActions(batch) {
  if (batch.status === "draft") {
    return `<div class="button-group">
      <a class="button" href="/disposal-batches/${batch.id}/edit">조건 수정·미리보기</a>
      <form method="post" action="/disposal-batches/${batch.id}/freeze"><button type="submit" class="button">대상 동결</button></form>
      <form method="post" action="/disposal-batches/${batch.id}/cancel" data-confirm="이 캠페인을 취소할까요?"><button type="submit" class="danger-button">취소</button></form>
    </div>`;
  }
  if (batch.status === "frozen") {
    return `<div class="button-group">
      <form method="post" action="/disposal-batches/${batch.id}/start"><button type="submit" class="danger-button">폐기 처리 시작</button></form>
      <form method="post" action="/disposal-batches/${batch.id}/cancel" data-confirm="이 캠페인을 취소할까요?"><button type="submit" class="danger-button">취소</button></form>
    </div>`;
  }
  if (batch.status === "processing") {
    return `<div class="button-group">
      <button type="button" class="danger-button" data-process-disposal>계속 처리</button>
      <button type="button" class="button secondary" data-stop-disposal disabled>처리 중단</button>
    </div>`;
  }
  return "";
}

function itemAction(batch, item) {
  if (batch.status !== "frozen") return "";
  if (item.status === "pending") {
    return `<form method="post" action="/disposal-batches/${batch.id}/items/${item.id}/exclude" class="button-group"><input name="reason" placeholder="제외 사유" required><button type="submit" class="button secondary sm">제외</button></form>`;
  }
  if (item.status === "excluded") {
    return `<form method="post" action="/disposal-batches/${batch.id}/items/${item.id}/include"><button type="submit" class="button secondary sm">재포함</button></form>`;
  }
  return "";
}

function processingScript(batch) {
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
      async function processNext() {
        while (running) {
          var body = new URLSearchParams({ csrf_token: csrf });
          var response = await fetch('/disposal-batches/${Number(batch.id)}/process', {
            method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body
          });
          var result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.message || '처리를 계속할 수 없습니다.');
          update(result.batch || {});
          if (result.done) { message.textContent = '폐기 처리가 완료되었습니다.'; window.location.reload(); return; }
          message.textContent = '완료된 항목을 저장했습니다. 남은 항목을 계속 처리합니다.';
        }
      }
      runButton?.addEventListener('click', function () {
        if (running) return;
        running = true; runButton.disabled = true; stopButton.disabled = false;
        message.textContent = '폐기 처리를 시작합니다.';
        processNext().catch(function (error) {
          running = false; runButton.disabled = false; stopButton.disabled = true;
          message.textContent = error.message + ' 다시 시도할 수 있습니다.';
        });
      });
      stopButton?.addEventListener('click', function () {
        running = false; runButton.disabled = false; stopButton.disabled = true;
        message.textContent = '처리를 중단했습니다. 완료된 항목은 저장되었으며 나중에 재개할 수 있습니다.';
      });
    })();
  </script>`;
}

function criteriaText(criteria = {}) {
  const parts = [];
  if (criteria.disposalDueYear) parts.push(`폐기연도 ${criteria.yearMode === "lte" ? `${criteria.disposalDueYear}년 이하` : `${criteria.disposalDueYear}년`}`);
  if (criteria.categoryId) parts.push(`대분류 #${criteria.categoryId}`);
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
