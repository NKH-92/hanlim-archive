// 문서 상세: 검색·등록·폐기를 잇는 텍스트 중심 연결 화면.

import { documentLink, documentReturnTo } from "../../shared/documents/navigation.js";
import { locationLabel, rackFaceLabel } from "../../domains/racks/index.js";
import { readBoolean } from "../../shared/coercion.js";
import { formatRevisionLabel } from "../../shared/documents/revision.js";
import { escapeHtml } from "../../ui/html/escape.js";
import { hasReadPermission, PERMISSIONS } from "../../permissions.js";
import { zoneFloorPlanView } from "../floorPlanViews.js";
import { page, statusBadge, timeline, timelineItem } from "../layout.js";
import { rackViewOrientation } from "../../domains/racks/domain/orientation.js";

export function documentDetailsPage({ session, document, tags, disposalLogs, auditLogs, movements = [], revisionHistory = [], floorPlan = [], returnTo = "" }) {
  const canManageDocuments = hasReadPermission(session, PERMISSIONS.MANAGE_DOCUMENTS);
  const canManageDisposals = hasReadPermission(session, PERMISSIONS.MANAGE_DISPOSALS);
  const canViewAudit = hasReadPermission(session, PERMISSIONS.VIEW_AUDIT);
  const canViewMovements = canViewAudit || hasReadPermission(session, PERMISSIONS.MOVE_DOCUMENTS);
  const canMoveDocuments = hasReadPermission(session, PERMISSIONS.MOVE_DOCUMENTS);
  returnTo = documentReturnTo(returnTo);
  const location = locationLabel(document);
  const latestDisposal = disposalLogs.find((log) => log.action === "disposed");
  const currentRevision = revisionHistory.find((item) => Number(item.id) === Number(document.id));
  const replacementId = Number(currentRevision?.replacement_document_id || 0);
  const isExcluded = document.sync_state === "excluded";
  const orientation = rackViewOrientation(document);
  const rackLabel = rackFaceLabel(document);
  const locationAction = locationPrimaryAction(document, { replacementId, isExcluded });
  // 정상(현재 대장 포함) 상태는 표시하지 않고 예외인 대장 제외만 배지로 알린다.
  // 문서번호·개정·문서명·상태는 제목 영역에, 폐기 사유·처리일은 폐기 기록에 있으므로 문서 정보에서 되풀이하지 않는다.
  const syncBadge = isExcluded
    ? `<span class="status ledger-excluded" title="현재 대장에는 포함되지 않은 문서">현재 대장 제외</span>`
    : "";

  return page(document.document_name, `<div class="document-detail-page" data-document-detail>
    <section class="document-detail-head">
      <nav class="breadcrumb" aria-label="경로"><a href="${escapeHtml(returnTo || "/app")}" data-back-to-results>검색 결과로</a></nav>
      <div class="document-title-row"><div class="document-title-copy"><h1>${escapeHtml(document.document_name)}</h1><p><span class="mono">${escapeHtml(document.document_number)}</span> · ${escapeHtml(formatRevisionLabel(document.revision_number))}</p></div><div class="document-state-badges">${statusBadge(document.status)}${syncBadge ? ` ${syncBadge}` : ""}</div></div>
      ${isExcluded ? "" : documentActions(document, { canManageDocuments, canMoveDocuments, canManageDisposals, isAdmin: session.role === "Admin" || session.demoReadAuthorized, replacementId, returnTo })}
    </section>

    <div class="document-detail-alerts">
      ${isExcluded ? `<div class="alert warning" role="status">이 문서는 현재 대장에서 제외됐어요. 최신 대장 파일에 다시 넣어 재등록하면 수정·이동·폐기를 할 수 있어요.${document.last_snapshot_id ? ` 마지막 관련 스냅샷: <a href="/document-snapshots/${Number(document.last_snapshot_id)}">#${Number(document.last_snapshot_id)}</a>` : ""}</div>` : ""}
      ${replacementId ? `<div class="alert info" role="status">개정으로 자동 폐기된 이전본이에요. <a href="/documents/${replacementId}">현재 개정본 보기</a></div>` : ""}
    </div>

    ${document.status === "disposed" ? `<section class="panel document-state-summary"><h2>폐기 기록</h2><dl>${detailRow("폐기 사유", latestDisposal?.reason || "기록 없음")}${detailRow("폐기 처리일", latestDisposal?.created_at || "기록 없음")}</dl>${replacementId ? `<a class="button" href="${escapeHtml(documentLink(replacementId, "", returnTo))}">연결된 후속 개정 보기</a>` : ""}</section>` : ""}
    ${document.status === "disposed" || isExcluded ? '<details class="panel historical-location"><summary>마지막 기록 위치 확인</summary>' : ""}
    <section class="panel document-location-summary document-location-hero" aria-labelledby="document-location-title">
      <div class="location-hero-copy">
        <small>${document.status === "disposed" || isExcluded ? "마지막 기록 위치" : "보관 위치"}</small>
        <strong id="document-location-title">${escapeHtml(location)}</strong>
        <span>${escapeHtml(locationGuidance(document, orientation))}</span>
      </div>
      ${locationAction ? `<div class="location-hero-actions">${locationAction}</div>` : ""}
    </section>

    <section class="document-location-visuals" aria-label="문서 보관 위치 도면">
      ${renderDocumentFloorPlan(document, floorPlan)}
      ${renderMiniVisualizer(document)}
    </section>

    ${document.status === "disposed" || isExcluded ? "</details>" : ""}

    <section class="document-detail-sections">
      <article class="panel detail-section document-info">
        <h2>문서 정보</h2>
        <dl>
          ${detailRow("대분류", document.category_name || "없음")}
          ${detailRow("제·개정일", document.revision_date || "없음")}
          ${detailRow("폐기 예정 연도", document.disposal_due_year ? `${document.disposal_due_year}년` : "없음")}
          ${detailRow("태그", tags.length ? tags.map((tag) => tag.name).join(", ") : "없음")}
          ${detailRow("비고", document.note || "없음")}
        </dl>
      </article>
    </section>

    ${revisionHistory.length > 1 ? renderRevisionHistory(revisionHistory, document.id) : ""}

    ${canViewAudit || canViewMovements ? `<section class="panel detail-history-group" aria-labelledby="detail-history-title">
      <h2 id="detail-history-title">이력</h2>
      ${canViewAudit ? `<details class="detail-history"><summary>감사 이력 <span class="count-badge">${auditLogs.length}건</span></summary>${timeline(auditLogs, renderAuditLog, "감사 이력이 없어요.")}</details>` : ""}
      ${canViewMovements ? `<details class="detail-history"><summary>위치 이동 이력 <span class="count-badge">${movements.length}건</span></summary>${timeline(movements, renderMovementLog, "위치 이동 이력이 없어요.")}</details>` : ""}
    </section>` : ""}
    ${!isExcluded && canManageDisposals && document.status === "active" ? disposeModal(document) : ""}
    ${!isExcluded && (session.role === "Admin" || session.demoReadAuthorized) && document.status === "disposed" && !replacementId ? restoreModal(document) : ""}
  </div>`, session);
}

// 위치 제목의 구역·랙은 되풀이하지 않고, 찾아가는 순서(바라볼 면 → 열 → 선반)만 한 줄로 쓴다.
function locationGuidance(document, orientation) {
  const facing = readBoolean(document.is_single_sided) ? "" : `${document.rack_face === "B" ? "2면" : "1면"}을 바라보고`;
  const column = document.column_number ? `${orientation.originLabel}에서 ${document.column_number}번째 열` : "";
  const shelf = document.shelf_number ? `아래에서 ${document.shelf_number}번째 선반` : "";
  return [[facing, column].filter(Boolean).join(" "), shelf].filter(Boolean).join(" · ");
}

function locationPrimaryAction(document, { replacementId, isExcluded }) {
  if (replacementId) return `<a class="button action-button" href="/documents/${replacementId}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>현재 개정본 보기</a>`;
  if (document.status === "disposed") return `<a class="button secondary" href="/app?status=active"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>보관중 문서 검색</a>`;
  if (isExcluded) return `<a class="button secondary" href="/app"><i class="fa-solid fa-list" aria-hidden="true"></i>현재 대장 검색</a>`;
  return "";
}

function detailRow(label, value, mono = false) {
  return `<div><dt>${escapeHtml(label)}</dt><dd class="${mono ? "mono" : ""}">${escapeHtml(value)}</dd></div>`;
}

function documentActions(document, capabilities) {
  const primaryActions = [];
  const stateActions = [];
  if (document.status === "active") {
    if (capabilities.canManageDocuments) {
      primaryActions.push(`<a class="button secondary" href="${escapeHtml(documentLink(document.id, "edit", capabilities.returnTo))}">정보 수정</a>`);
      primaryActions.push(`<a class="button secondary" href="${escapeHtml(documentLink(document.id, "revise", capabilities.returnTo))}">문서 개정</a>`);
    }
    if (capabilities.canMoveDocuments) primaryActions.push(`<a class="button secondary" href="${escapeHtml(documentLink(document.id, "move", capabilities.returnTo))}">위치 이동</a>`);
    if (capabilities.canManageDisposals) stateActions.push(`<button type="button" class="danger-button" data-open-modal="dispose-modal">폐기</button>`);
  } else if (capabilities.isAdmin && !capabilities.replacementId) {
    stateActions.push(`<button type="button" class="button secondary" data-open-modal="restore-modal">폐기 취소</button>`);
  }
  if (!primaryActions.length && !stateActions.length) return "";
  // 되돌리기 어려운 상태 변경은 일반 편집 작업과 같은 줄에 두지 않고 별도 구획으로 분리한다.
  const stateGroup = stateActions.length
    ? `<div class="detail-state-actions" role="group" aria-label="${document.status === "active" ? "폐기 처리" : "폐기 취소"}"><span class="detail-state-label">${document.status === "active" ? "상태 변경 · 되돌리려면 복구 권한이 필요해요" : "상태 변경"}</span><div>${stateActions.join("")}</div></div>`
    : "";
  return `<section class="detail-actions" aria-label="문서 작업"><div class="detail-action-groups">${primaryActions.length ? `<div>${primaryActions.join("")}</div>` : ""}${stateGroup}</div></section>`;
}

function renderRevisionHistory(items, currentDocumentId) {
  return `<section class="panel revision-history" aria-labelledby="revision-history-title">
    <div class="section-title"><h2 id="revision-history-title">개정 이력</h2><span class="count-badge">${items.length}개정</span></div>
    <ol>${items.map((item) => `<li class="${Number(item.id) === Number(currentDocumentId) ? "current" : ""}">
      <a href="/documents/${Number(item.id)}"><strong>${escapeHtml(formatRevisionLabel(item.revision_number))}</strong><span>${escapeHtml(item.revision_date || "제·개정일 없음")}</span></a>
      ${statusBadge(item.status)}
    </li>`).join("")}</ol>
  </section>`;
}

function disposeModal(document) {
  return `<dialog id="dispose-modal" class="modal" aria-labelledby="dispose-title"><form method="post" action="/documents/${document.id}/dispose" class="modal-body"><h3 id="dispose-title">문서 폐기</h3><dl class="disposal-target-summary">${detailRow("문서명", document.document_name)}${detailRow("문서번호", document.document_number, true)}${detailRow("개정", formatRevisionLabel(document.revision_number))}${detailRow("대상 수량", "1건")}${detailRow("기록상 위치", locationLabel(document))}</dl><p class="muted">문서를 지우지 않고 폐기 상태로 바꿔요. 이력은 그대로 남아요.</p><label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>닫기</button><button type="submit" class="danger-button">폐기하기</button></div></form></dialog>`;
}

function restoreModal(document) {
  return `<dialog id="restore-modal" class="modal"><form method="post" action="/documents/${document.id}/restore" class="modal-body"><h3>폐기 취소</h3><label>취소 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>닫기</button><button type="submit" class="button">폐기 취소</button></div></form></dialog>`;
}

// 상세 화면에 문서가 있는 구역을 즉시 표시한다. 접힘 UI를 쓰지 않아 진입 즉시 위치를 확인할 수 있다.
function renderDocumentFloorPlan(document, floorPlan = []) {
  if (!floorPlan.length) return "";

  const region = floorPlan.find((item) => item.racks.some((rack) => rack.code === document.rack_code));

  if (!region) {
    return `
      <section class="panel doc-floor-plan" aria-labelledby="location-map-title">
        <div class="section-title"><h2 id="location-map-title">위치 도면</h2></div>
        <p class="muted">이 문서의 랙은 도면에 없는 구역에 있어요.</p>
      </section>
    `;
  }

  // 위치 문장은 위치 카드에만 둔다. 도면은 노란 핀 하나로 문서가 있는 랙을 보여 준다.
  const rack = region.racks.find((item) => item.code === document.rack_code);
  const scrollId = "document-location-map-scroll";
  return `
    <section class="panel doc-floor-plan" aria-labelledby="location-map-title">
      <div class="section-title"><h2 id="location-map-title">위치 도면 · ${escapeHtml(region.label)}</h2><button type="button" class="button secondary sm" data-document-floor-zoom aria-controls="${scrollId}" aria-pressed="false">도면 크게 보기</button></div>
      <div class="doc-floor-plan-body">
        <div id="${scrollId}" class="doc-floor-plan-scroll" data-document-floor-scroll tabindex="0" aria-label="${escapeHtml(region.label)} 문서 위치 도면. 노란 핀이 문서가 있는 랙이에요. 크게 보기에서는 도면 안에서 좌우로 움직일 수 있어요.">
          ${zoneFloorPlanView(region, { hitCode: document.rack_code, hitFace: document.rack_face, interactive: false, spotlight: true })}
        </div>
        ${rack ? `<a class="button secondary sm rack-result-link" href="/app?rack=${Number(rack.id)}&amp;status=active&amp;sort=location">이 랙의 보관중 문서 보기</a>` : ""}
      </div>
    </section>
  `;
}

// 칸마다 좌표를 적지 않고 왼쪽 선반 번호와 위쪽 방향 안내만 둔다. 문서가 있는 칸만 노랑으로 강조한다.
function renderMiniRackContent(document) {
  const cols = Math.max(1, Math.min(50, Number(document.column_count) || 1));
  const rows = Math.max(1, Math.min(50, Number(document.shelf_count) || 3));
  const activeCol = Number(document.column_number || 0);
  const activeRow = Number(document.shelf_number || 0);
  const orientation = rackViewOrientation(document);
  const columns = Array.from({ length: cols }, (_, index) => index + 1);
  let slots = "";

  for (let row = rows; row >= 1; row -= 1) {
    slots += `<span class="mini-axis-shelf">${row}</span>`;
    for (const col of columns) {
      const active = col === activeCol && row === activeRow;
      slots += `<div class="mini-slot ${active ? "active" : ""}" title="${col}열 ${row}선반">${active ? `<i class="fa-solid fa-location-dot" aria-hidden="true"></i>` : ""}</div>`;
    }
  }

  const rackLabel = rackFaceLabel(document);
  const layoutKey = `mini-rack-${Math.max(0, Number(document.id) || 0)}`;

  return `<style>[data-mini-rack-layout="${layoutKey}"]{--cols:${cols};--rows:${rows};--grid-min:${32 + cols * 52}px;}</style>
      <div class="section-title"><h2 id="rack-position-title">랙 위치 · ${escapeHtml(rackLabel || document.rack_code)}번 랙</h2></div>
      <div class="mini-column-guide" data-column-origin="${orientation.origin}">
        <span>1열 · 왼쪽</span>
        <span>${cols}열 · 오른쪽</span>
      </div>
      <div class="mini-rack-scroll" data-rack-scroll tabindex="0" aria-label="랙 열과 선반 위치. 현재 위치는 ${activeCol}열 ${activeRow}선반이에요.">
        <div class="mini-rack-grid" data-mini-rack-layout="${layoutKey}" data-column-origin="${orientation.origin}" aria-hidden="true">${slots}</div>
      </div>
  `;
}

function renderMiniVisualizer(document) {
  return `<section class="panel minimap-card" aria-labelledby="rack-position-title">${renderMiniRackContent(document)}</section>`;
}

function renderAuditLog(log) {
  const labels = { legacy_import: "기존 데이터", create: "등록", update: "정보 수정", move: "위치 이동", revision_superseded: "개정 대체", revision_created: "개정 등록", dispose: "폐기", restore: "폐기 취소", delete_permanent: "완전 삭제" };
  return timelineItem(`${labels[log.action] || log.action}: ${log.summary}`, `${log.actor} (${log.actor_role}) / ${log.created_at}`, publicAuditDetails(log.details));
}

function renderMovementLog(log) {
  const actor = log.performed_by_name || log.performed_by_username || "알 수 없음";
  return timelineItem(`${log.from_location_snapshot} → ${log.to_location_snapshot}`, `${actor} / ${log.created_at}`, log.reason);
}

function publicAuditDetails(details) {
  if (!details) return "";
  try {
    return JSON.stringify(removeInternalStorageCodes(JSON.parse(details)));
  } catch {
    return String(details).replace(/\bARC-\d+\b/gi, "[내부 식별자 숨김]");
  }
}

function removeInternalStorageCodes(value) {
  if (Array.isArray(value)) return value.map(removeInternalStorageCodes);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.replace(/\bARC-\d+\b/gi, "[내부 식별자 숨김]") : value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key.replace(/[_-]/g, "").toLowerCase() !== "storagecode")
    .map(([key, item]) => [key, removeInternalStorageCodes(item)]));
}
