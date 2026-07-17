// 문서 세트 화면.

import { escapeHtml, locationLabel } from "../utils.js";
import { archiveMap } from "./floorPlanViews.js";
import { alertDanger, alertWarning, emptyState, metric, page, sectionHeader, statusBadge, timeline, timelineItem } from "./layout.js";

export function setsPage({ session, sets }) {
  const isAdmin = session.role === "Admin";
  return page("문서 세트", `
    <section class="page-head">
      <h1>문서 세트</h1>
      <div class="button-group">
        ${isAdmin ? `<a class="button" href="/sets/new">세트 만들기</a>` : ""}
      </div>
    </section>
    <p class="muted">감사 준비문서 목록처럼 자주 찾는 문서 묶음을 저장해 두고 한눈에 관리합니다.</p>
    ${sets.length ? `<section class="rack-grid">
      ${sets.map((set) => `
        <a class="panel rack-card" href="/sets/${set.id}">
          <small>문서 ${Number(set.document_count || 0)}건${Number(set.disposed_count || 0) ? ` · 폐기 ${Number(set.disposed_count)}건 포함` : ""}</small>
          <strong>${escapeHtml(set.name)}</strong>
          <span>${escapeHtml(set.description || "설명 없음")}</span>
        </a>
      `).join("")}
    </section>` : emptyState(isAdmin ? "아직 세트가 없습니다. 세트를 만들고 준비문서를 등록하세요." : "아직 등록된 세트가 없습니다.")}
  `, session);
}

export function setFormPage({ session, values = {}, action, title, error = "" }) {
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        <label>세트 이름 <em>*</em><input name="name" value="${escapeHtml(values.name || "")}" maxlength="100" required placeholder="예: 2026년 정기감사 준비문서"></label>
        <label>설명<textarea name="description" rows="3" placeholder="세트 용도나 기준을 기록해 두세요.">${escapeHtml(values.description || "")}</textarea></label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}

export function setDetailsPage({ session, set, documents, racks, logs = [], addQuery = "", addCandidates = null, addResult = null, error = "" }) {
  const isAdmin = session.role === "Admin";
  const disposedCount = documents.filter((doc) => doc.status !== "active").length;
  const rackCount = new Set(documents.map((doc) => doc.rack_code)).size;
  const zoneCount = new Set(documents.map((doc) => doc.zone_number)).size;
  const hits = new Set(documents.map((doc) => `${doc.rack_code}:${doc.rack_face}`));

  return page(`${set.name} 세트`, `
    <section class="page-head">
      <div><h1>${escapeHtml(set.name)}</h1>${set.description ? `<p class="page-sub">${escapeHtml(set.description)}</p>` : ""}</div>
      <div class="button-group">
        <button type="button" class="button secondary" data-print><i class="fa-solid fa-print"></i> 목록 인쇄</button>
        ${isAdmin ? `<a class="button secondary" href="/sets/${set.id}/edit">세트 수정</a>` : ""}
      </div>
    </section>
    ${error ? alertDanger(error) : ""}
    ${addResult ? setAddResultView(addResult) : ""}
    <section class="metric-strip" aria-label="세트 요약">
      ${metric("문서", documents.length, "세트에 등록된 문서")}
      ${metric("보관 랙", rackCount, `${zoneCount}개 구역`)}
      ${metric("폐기 포함", disposedCount, disposedCount ? "목록 확인 필요" : "없음")}
    </section>
    <section class="panel">
      ${sectionHeader("보관 위치 목록", `${documents.length}건`)}
      ${documents.length ? `<p class="muted">구역 → 랙 → 열 → 선반 순으로 정렬되어 있어 문서고에서 한 번에 돌며 꺼낼 수 있습니다.</p>` : ""}
      ${setDocumentTable(set, documents, isAdmin)}
    </section>
    ${documents.length ? `<section class="panel">
      ${sectionHeader("랙 지도", `${rackCount}개 랙`)}
      ${archiveMap(racks, hits)}
    </section>` : ""}
    ${isAdmin ? setAdminTools(set, addQuery, addCandidates) : ""}
    ${logs.length ? `<section class="panel">
      ${sectionHeader("세트 변경 이력", `${logs.length}건`)}
      ${timeline(logs, renderSetLog, "변경 이력이 없습니다.")}
    </section>` : ""}
  `, session);
}

function renderSetLog(log) {
  const labels = { create: "세트 생성", update: "정보 수정", delete: "세트 삭제", add: "문서 추가", remove: "문서 제외" };
  return timelineItem(labels[log.action] || log.action, `${log.actor} / ${log.created_at}`, log.details || "");
}

function setDocumentTable(set, documents, isAdmin) {
  if (!documents.length) {
    return emptyState(isAdmin ? "아직 세트에 담긴 문서가 없습니다. 아래에서 문서를 추가하세요." : "아직 세트에 담긴 문서가 없습니다.");
  }

  return `
    <div class="table-wrap"><table class="set-doc-table">
      <caption class="sr-only">${escapeHtml(set.name)} 세트 문서 위치 목록</caption>
      <thead><tr><th>순번</th><th>보관 위치</th><th>문서번호</th><th>개정</th><th>문서명</th><th>대분류</th><th>상태</th>${isAdmin ? "<th>관리</th>" : ""}</tr></thead>
      <tbody>${documents.map((doc, index) => `
        <tr class="${doc.status !== "active" ? "is-disposed" : ""}">
          <td>${index + 1}</td>
          <td><strong>${escapeHtml(locationLabel(doc))}</strong></td>
          <td>${escapeHtml(doc.document_number)}</td>
          <td>${escapeHtml(doc.revision_number)}</td>
          <td><a href="/documents/${doc.id}">${escapeHtml(doc.document_name)}</a></td>
          <td>${escapeHtml(doc.category_name)}</td>
          <td>${statusBadge(doc.status)}</td>
          ${isAdmin ? `<td><form method="post" action="/sets/${set.id}/remove" data-confirm="세트에서 이 문서를 제외할까요?"><input type="hidden" name="documentId" value="${doc.id}"><button type="submit" class="danger-button sm">제외</button></form></td>` : ""}
        </tr>
      `).join("")}</tbody>
    </table></div>
  `;
}

function setAddResultView(result) {
  const added = `<div class="alert success" role="status">${result.added}건을 세트에 추가했습니다.</div>`;
  const missing = result.missing.length
    ? alertWarning(`찾지 못한 번호 ${result.missing.length}건: ${result.missing.join(", ")}`)
    : "";
  return `${added}${missing}`;
}

function setAdminTools(set, addQuery, addCandidates) {
  return `
    <section class="panel set-admin-tools">
      ${sectionHeader("문서 추가", "관리자")}
      <div class="set-add-grid">
        <form method="post" action="/sets/${set.id}/add" class="stack">
          <label>문서번호 일괄 추가
            <textarea name="numbers" rows="4" placeholder="문서번호를 줄바꿈이나 쉼표로 구분해 붙여넣으세요.&#10;예) MR-2026-001, PV-2026-014"></textarea>
          </label>
          <button type="submit" class="primary">일괄 추가</button>
        </form>
        <div class="stack">
          <form method="get" action="/sets/${set.id}" class="stack">
            <label>문서 검색으로 추가
              <input name="add-q" value="${escapeHtml(addQuery)}" placeholder="문서명, 문서번호, 위치 검색">
            </label>
            <button type="submit" class="button secondary">검색</button>
          </form>
          ${addCandidates ? setCandidateList(set, addQuery, addCandidates) : ""}
        </div>
      </div>
      <div class="set-danger-row">
        <form method="post" action="/sets/${set.id}/delete" data-confirm="세트를 삭제할까요? 세트에 담긴 문서 자체는 삭제되지 않습니다.">
          <button type="submit" class="danger-button">세트 삭제</button>
        </form>
      </div>
    </section>
  `;
}

function setCandidateList(set, addQuery, candidates) {
  if (!candidates.length) {
    return `<p class="muted">검색 결과가 없습니다.</p>`;
  }

  return `<div class="set-candidate-list">${candidates.map((doc) => `
    <div class="set-candidate ${doc.status !== "active" ? "is-disposed" : ""}">
      <div>
        <strong>${escapeHtml(doc.document_name)}</strong> ${statusBadge(doc.status)}
        <small>${escapeHtml(doc.document_number)} · ${escapeHtml(doc.revision_number)} · ${escapeHtml(locationLabel(doc))}</small>
      </div>
      ${doc.inSet ? `<span class="muted">이미 포함됨</span>` : `
        <form method="post" action="/sets/${set.id}/add">
          <input type="hidden" name="documentId" value="${doc.id}">
          <input type="hidden" name="add-q" value="${escapeHtml(addQuery)}">
          <button type="submit" class="button sm">추가</button>
        </form>
      `}
    </div>
  `).join("")}</div>`;
}
