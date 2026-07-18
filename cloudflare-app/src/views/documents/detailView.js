// 문서 상세: 검색·등록·폐기를 잇는 텍스트 중심 연결 화면.

import { escapeHtml, locationLabel, rackFaceLabel, readBoolean } from "../../utils.js";
import { hasPermission, PERMISSIONS } from "../../permissions.js";
import { zoneFloorPlanView } from "../floorPlanViews.js";
import { page, statusBadge, timeline, timelineItem } from "../layout.js";

export function documentDetailsPage({ session, document, tags, disposalLogs, auditLogs, movements = [], floorPlan = [] }) {
  const canManageDocuments = hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS);
  const canManageDisposals = hasPermission(session, PERMISSIONS.MANAGE_DISPOSALS);
  const canViewAudit = hasPermission(session, PERMISSIONS.VIEW_AUDIT);
  const canViewMovements = canViewAudit || hasPermission(session, PERMISSIONS.MOVE_DOCUMENTS);
  const location = locationLabel(document);
  const latestDisposal = disposalLogs.find((log) => log.action === "disposed");

  return page(document.document_name, `
    <section class="document-detail-head">
      <nav class="breadcrumb" aria-label="경로"><a href="/app">문서검색</a><span>/</span><span>문서 상세</span></nav>
      <div class="document-title-row"><div><h1>${escapeHtml(document.document_name)}</h1><p><span class="mono">${escapeHtml(document.document_number)}</span> · ${escapeHtml(document.revision_number)}</p></div>${statusBadge(document.status)}</div>
      <div class="document-location-summary"><small>보관 위치</small><strong class="mono">${escapeHtml(location)}</strong></div>
    </section>

    <section class="document-detail-sections">
      <article class="panel detail-section">
        <h2>기본 정보</h2>
        <dl>
          ${detailRow("문서번호", document.document_number, true)}
          ${detailRow("개정번호", document.revision_number)}
          ${detailRow("문서명", document.document_name)}
          ${detailRow("제/개정일", document.revision_date || "미입력")}
          ${detailRow("대분류", document.category_name || "-")}
          ${detailRow("태그", tags.length ? tags.map((tag) => tag.name).join(", ") : "-")}
        </dl>
      </article>
      <article class="panel detail-section">
        <h2>보존 정보</h2>
        <dl>
          ${detailRow("폐기 예정 년도", document.disposal_due_year ? `${document.disposal_due_year}년` : "미입력")}
          ${detailRow("상태", document.status === "active" ? "보관중" : "폐기")}
          ${detailRow("비고", document.note || "-")}
          ${document.status === "disposed" ? detailRow("폐기 사유", latestDisposal?.reason || "-") : ""}
          ${document.status === "disposed" ? detailRow("폐기 처리일", latestDisposal?.created_at || "-") : ""}
        </dl>
      </article>
    </section>

    <section class="document-location-visuals" aria-label="문서 보관 위치 도면">
      ${renderDocumentFloorPlan(document, floorPlan)}
      ${renderMiniVisualizer(document)}
    </section>

    ${documentActions(document, { canManageDocuments, canManageDisposals, isAdmin: session.role === "Admin" })}

    ${canViewAudit ? `<details class="panel detail-history"><summary>감사 이력 <span class="count-badge">${auditLogs.length}건</span></summary>${timeline(auditLogs, renderAuditLog, "감사 이력이 없습니다.")}</details>` : ""}
    ${canViewMovements ? `<details class="panel detail-history"><summary>위치 이동 이력 <span class="count-badge">${movements.length}건</span></summary>${timeline(movements, renderMovementLog, "위치 이동 이력이 없습니다.")}</details>` : ""}
    ${canManageDisposals && document.status === "active" ? disposeModal(document) : ""}
    ${session.role === "Admin" && document.status === "disposed" ? restoreModal(document) : ""}
  `, session);
}

function detailRow(label, value, mono = false) {
  return `<div><dt>${escapeHtml(label)}</dt><dd class="${mono ? "mono" : ""}">${escapeHtml(value)}</dd></div>`;
}

function documentActions(document, capabilities) {
  const primaryActions = [];
  const stateActions = [];
  if (document.status === "active") {
    if (capabilities.canManageDocuments) {
      primaryActions.push(`<a class="button secondary" href="/documents/${document.id}/edit">수정</a>`);
      primaryActions.push(`<a class="button" href="/documents/${document.id}/revise">새 개정 등록</a>`);
    }
    if (capabilities.canManageDisposals) stateActions.push(`<button type="button" class="danger-button" data-open-modal="dispose-modal">폐기</button>`);
  } else if (capabilities.isAdmin) {
    stateActions.push(`<button type="button" class="button secondary" data-open-modal="restore-modal">폐기 취소</button>`);
  }
  if (!primaryActions.length && !stateActions.length) return "";
  return `<section class="detail-actions" aria-label="문서 작업"><div>${primaryActions.join("")}</div><div>${stateActions.join("")}</div></section>`;
}

function disposeModal(document) {
  return `<dialog id="dispose-modal" class="modal"><form method="post" action="/documents/${document.id}/dispose" class="modal-body"><h3>문서 폐기</h3><p class="muted">문서는 삭제되지 않고 폐기 상태로 변경되며 이력은 보존됩니다.</p><label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">폐기 확인</button></div></form></dialog>`;
}

function restoreModal(document) {
  return `<dialog id="restore-modal" class="modal"><form method="post" action="/documents/${document.id}/restore" class="modal-body"><h3>폐기 취소</h3><label>취소 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>닫기</button><button type="submit" class="button">폐기 취소</button></div></form></dialog>`;
}

// 상세 화면에 문서가 있는 구역을 즉시 표시한다. 접힘 UI를 쓰지 않아 진입 즉시 위치를 확인할 수 있다.
function renderDocumentFloorPlan(document, floorPlan = []) {
  if (!floorPlan.length) return "";

  const region = floorPlan.find((item) => item.racks.some((rack) => rack.code === document.rack_code));
  const rackLabel = rackFaceLabel(document);
  const badge = `${document.zone_number ? `${document.zone_number}구역 ` : ""}${escapeHtml(rackLabel || document.rack_code)}번 랙`;

  if (!region) {
    return `
      <section class="panel doc-floor-plan" aria-labelledby="location-map-title">
        <div class="section-title"><h2 id="location-map-title">위치 도면</h2><span class="count-badge">${badge}</span></div>
        <p class="muted">이 문서의 랙은 현재 도면에 표시되지 않는 구역에 있습니다.</p>
      </section>
    `;
  }

  const single = readBoolean(document.is_single_sided);
  const orientation = rackViewOrientation(document);
  return `
    <section class="panel doc-floor-plan" aria-labelledby="location-map-title">
      <div class="section-title"><h2 id="location-map-title">위치 도면 · ${escapeHtml(region.label)}</h2><span class="count-badge">${badge}</span></div>
      <div class="doc-floor-plan-body">
        ${zoneFloorPlanView(region, { hitCode: document.rack_code, hitFace: document.rack_face })}
        <p class="muted">파란색이 이 문서가 보관된 ${single ? `단면 랙입니다. ${orientation.description}` : `${escapeHtml(rackLabel)} 면(양면 랙의 ${document.rack_face === "B" ? "우측" : "좌측"})입니다. 1열은 통로 안쪽인 ${orientation.originLabel}에서 시작합니다.`}</p>
      </div>
    </section>
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

  const ordinal = [
    activeRow ? `아래에서 ${activeRow}번째 선반` : "",
    activeCol ? `${orientation.originLabel}에서 ${activeCol}번째 열` : ""
  ].filter(Boolean).join(" · ");
  const rackLabel = rackFaceLabel(document);

  return `
    <section class="panel minimap-card" aria-labelledby="rack-position-title">
      <div class="section-title"><h2 id="rack-position-title">랙 위치 · ${document.zone_number ? `${document.zone_number}구역 ` : ""}${escapeHtml(rackLabel || document.rack_code)}번 랙</h2><span class="count-badge">${activeCol}열 ${activeRow}선반</span></div>
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
  const labels = { legacy_import: "기존 데이터", create: "등록", update: "수정", move: "이동", dispose: "폐기", restore: "폐기 취소", delete_permanent: "완전 삭제" };
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
