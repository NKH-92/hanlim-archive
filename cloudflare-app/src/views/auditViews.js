import { escapeHtml } from "../utils.js";
import { page, paginationNav } from "./layout.js";

const ENTITY_LABELS = Object.freeze({
  user: "사용자",
  category: "대분류",
  tag: "태그",
  rack: "랙",
  disposal_batch: "폐기 캠페인",
  document: "문서",
  document_set: "문서 세트",
  import_job: "CSV 가져오기"
});

const ACTION_LABELS = Object.freeze({
  approve: "승인",
  reject: "반려",
  disable: "사용중지",
  enable: "다시 사용",
  permissions_update: "권한 변경",
  create: "추가",
  update: "수정",
  deactivate: "사용중지",
  reactivate: "다시 사용",
  freeze: "동결",
  cancel: "취소",
  complete: "완료",
  move: "위치 이동",
  restore: "폐기 복구",
  delete_permanent: "완전삭제"
});

export function auditPage({ session, items = [], filters = {}, pagination = {} }) {
  const currentPage = Number(pagination.page || 1);
  const totalPages = Math.max(1, Number(pagination.totalPages || 1));
  return page("전역 감사로그", `
    <section class="page-head">
      <div><h1>전역 감사로그</h1><p class="muted">중요한 관리 작업의 행위자와 변경 전후 값을 확인합니다.</p></div>
      <a class="button secondary" href="/admin">관리 설정</a>
    </section>
    ${auditFilterForm(filters)}
    <section class="panel">
      <div class="section-title"><h2>감사 이력</h2><span class="count-badge">${Number(pagination.totalItems || 0)}건</span></div>
      ${items.length ? auditTable(items) : `<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>조건에 맞는 감사 이력이 없습니다.</p></div>`}
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
      <label>대상 유형<input name="entityType" value="${escapeHtml(filters.entityType || "")}" placeholder="user, rack ..."></label>
      <label>동작 유형<input name="action" value="${escapeHtml(filters.action || "")}" placeholder="approve, update ..."></label>
      <label>참조번호<input name="reference" value="${escapeHtml(filters.reference || "")}" placeholder="문서번호 또는 참조번호"></label>
      <div class="button-group"><button type="submit" class="button">조회</button><a class="button secondary" href="/admin/audit">초기화</a></div>
    </form>
  `;
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
