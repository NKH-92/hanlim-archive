import { escapeHtml } from "../../../ui/html/escape.js";
import { page, paginationNav } from "../../../views/layout.js";

// 감사 이력에 저장되는 대상·동작 값(영문 키)을 화면과 조회 조건에서는 한국어로만 보여 준다.
const ENTITY_LABELS = Object.freeze({
  document: "문서",
  document_snapshot: "엑셀 대장 동기화",
  disposal_batch: "폐기 캠페인",
  document_set: "문서 세트",
  user: "사용자",
  user_role_template: "역할 템플릿",
  category: "대분류",
  tag: "태그",
  rack: "랙",
  rack_configuration: "구역별 랙 수",
  document_import_job: "CSV 가져오기",
  import_job: "CSV 가져오기(이전)"
});

const ACTION_LABELS = Object.freeze({
  create: "추가",
  update: "수정",
  move: "위치 이동",
  revision: "개정",
  dispose: "폐기",
  restore: "폐기 복구",
  apply: "반영",
  start: "시작",
  process: "처리",
  freeze: "동결",
  finalize: "확정",
  complete: "완료",
  cancel: "취소",
  approve: "승인",
  reject: "반려",
  create_approved: "승인 사용자 추가",
  disable: "계정 사용중지",
  enable: "계정 다시 사용",
  deactivate: "기준정보 사용중지",
  reactivate: "기준정보 다시 사용",
  permissions_update: "권한 변경",
  password_reset: "비밀번호 초기화",
  role_template_update: "역할 템플릿 수정",
  role_template_apply: "역할 템플릿 반영",
  delete: "삭제",
  delete_permanent: "완전삭제"
});

export function auditPage({ session, items = [], filters = {}, pagination = { page: 1, totalPages: 1, totalItems: 0 } }) {
  const currentPage = Number(pagination.page || 1);
  const totalPages = Math.max(1, Number(pagination.totalPages || 1));
  const totalItems = Number(pagination.totalItems || 0);
  return page("전역 감사로그", `
    <section class="page-head">
      <h1>전역 감사로그</h1>
    </section>
    ${auditFilterForm(filters)}
    <section class="panel">
      <div class="section-title"><h2>감사 이력</h2><span class="count-badge">${totalItems}건</span></div>
      ${items.length ? auditTable(items) : `<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>조건에 맞는 감사 이력이 없어요.</p></div>`}
      ${paginationNav(currentPage, totalPages, {
        previousUrl: auditUrl(filters, Math.max(1, currentPage - 1)),
        nextUrl: auditUrl(filters, Math.min(totalPages, currentPage + 1))
      })}
    </section>
  `, session);
}

function auditFilterForm(filters) {
  return `
    <form method="get" action="/admin/audit" class="panel filter-bar">
      <label>시작일<input type="date" name="from" value="${escapeHtml(filters.from || "")}"></label>
      <label>종료일<input type="date" name="to" value="${escapeHtml(filters.to || "")}"></label>
      <label>행위자<input name="actor" value="${escapeHtml(filters.actor || "")}" placeholder="아이디 또는 이름"></label>
      <label>대상<select name="entityType">${labelOptions(ENTITY_LABELS, filters.entityType)}</select></label>
      <label>동작<select name="action">${labelOptions(ACTION_LABELS, filters.action)}</select></label>
      <label>참조번호<input name="reference" value="${escapeHtml(filters.reference || "")}" placeholder="문서번호 또는 참조번호"></label>
      <div class="button-group"><button type="submit" class="button">조회</button><a class="button secondary" href="/admin/audit">초기화</a></div>
    </form>
  `;
}

// 목록에 없는 현재 조건 값(과거 기록의 동작 등)은 그대로 보존해 조회 조건이 사라지지 않게 한다.
function labelOptions(labels, selected = "") {
  const options = Object.entries(labels);
  if (selected && !labels[selected]) options.push([selected, selected]);
  return `<option value="">전체</option>${options.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}`;
}

function auditTable(items) {
  return `
    <div class="table-wrap"><table>
      <caption class="sr-only">전역 감사로그 목록</caption>
      <thead><tr><th>일시</th><th>행위자</th><th>대상</th><th>동작</th><th>요약</th><th>상세</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td class="mono">${escapeHtml(item.created_at || "-")}</td>
          <td><strong>${escapeHtml(item.actor_display_name_snapshot || "-")}</strong><small class="mono">${escapeHtml(item.actor_username_snapshot || "-")}</small></td>
          <td><strong>${escapeHtml(ENTITY_LABELS[item.entity_type] || item.entity_type)}</strong><small class="mono">${escapeHtml(item.entity_reference || item.entity_id || "-")}</small></td>
          <td>${escapeHtml(ACTION_LABELS[item.action] || item.action)}</td>
          <td>${escapeHtml(item.summary || "-")}</td>
          <td>${auditDetails(item.details_json)}</td>
        </tr>
      `).join("")}</tbody>
    </table></div>
  `;
}

function auditDetails(raw) {
  if (!raw) return `<span class="muted">-</span>`;
  let details;
  try {
    details = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return `<details><summary>보기</summary><p>${escapeHtml(raw)}</p></details>`;
  }

  const before = details?.before;
  const after = details?.after;
  if (isRecord(before) || isRecord(after)) {
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
    return `<details><summary>변경 전후</summary><div class="table-wrap"><table>
      <thead><tr><th>항목</th><th>이전</th><th>이후</th></tr></thead>
      <tbody>${keys.map((key) => `<tr><th>${escapeHtml(fieldLabel(key))}</th><td>${formatAuditValue(before?.[key])}</td><td>${formatAuditValue(after?.[key])}</td></tr>`).join("")}</tbody>
    </table></div>${additionalDetails(details)}</details>`;
  }
  return `<details><summary>보기</summary>${objectDetails(details)}</details>`;
}

function additionalDetails(details) {
  const rest = Object.fromEntries(Object.entries(details).filter(([key]) => !["before", "after"].includes(key)));
  return Object.keys(rest).length ? objectDetails(rest) : "";
}

function objectDetails(value) {
  if (!isRecord(value)) return `<p>${formatAuditValue(value)}</p>`;
  return `<dl class="detail-list">${Object.entries(value).map(([key, item]) => `<div><dt>${escapeHtml(fieldLabel(key))}</dt><dd>${formatAuditValue(item)}</dd></div>`).join("")}</dl>`;
}

function formatAuditValue(value) {
  if (value === null || value === undefined || value === "") return `<span class="muted">-</span>`;
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (Array.isArray(value)) return escapeHtml(value.join(", ") || "-");
  if (isRecord(value)) {
    return `<ul class="manual-list">${Object.entries(value).map(([key, item]) => `<li><strong>${escapeHtml(fieldLabel(key))}</strong><span>${formatAuditValue(item)}</span></li>`).join("")}</ul>`;
  }
  return escapeHtml(String(value));
}

function fieldLabel(key) {
  return {
    username: "아이디",
    displayName: "이름",
    role: "역할",
    status: "상태",
    permissions: "권한",
    reason: "사유",
    location: "위치"
  }[key] || key;
}

function auditUrl(filters, targetPage) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
    if (value) params.set(key, value);
  }
  if (targetPage > 1) params.set("page", String(targetPage));
  const query = params.toString();
  return `/admin/audit${query ? `?${query}` : ""}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
