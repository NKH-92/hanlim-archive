// 문서 상세, 위치 시각화, 권한별 동작, 감사·이동 이력 화면.

import { escapeHtml, locationLabel, rackFaceLabel, readBoolean } from "../../utils.js";
import { hasPermission, PERMISSIONS } from "../../permissions.js";
import { zoneFloorPlanView } from "../floorPlanViews.js";
import { page, statusBadge, timeline, timelineItem } from "../layout.js";

export function documentDetailsPage({ session, document, tags, disposalLogs, auditLogs, movements = [], floorPlan = [] }) {
  const canManageDocuments = hasPermission(session, PERMISSIONS.MANAGE_DOCUMENTS);
  const canMoveDocuments = hasPermission(session, PERMISSIONS.MOVE_DOCUMENTS);
  const canManageDisposals = hasPermission(session, PERMISSIONS.MANAGE_DISPOSALS);
  const canViewAudit = hasPermission(session, PERMISSIONS.VIEW_AUDIT);
  const canViewMovements = canViewAudit || canMoveDocuments;
  const hasDetailTabs = canViewAudit || canViewMovements;
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

  const breadcrumb = `<a href="/app">검색</a><span>/</span><a href="/documents">전체 문서</a><span>/</span><span>상세</span>`;

  return page(document.document_name, `
    <section class="page-head">
      <div>
        <nav class="breadcrumb" aria-label="경로">${breadcrumb}</nav>
        <h1>${escapeHtml(document.document_name)}</h1>
      </div>
      <div class="head-actions">
        ${statusBadge(document.status)}
        ${documentActions(document, { canManageDocuments, canMoveDocuments, canManageDisposals })}
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
        <a class="button secondary sm" href="/documents?q=${encodeURIComponent(document.rack_code)}">같은 랙 문서 보기</a>
      </div>
    </section>
    ${hasDetailTabs ? `
      <div class="tab-nav" role="tablist" aria-label="문서 상세 정보">
        <button role="tab" aria-selected="true" data-tab="info" id="tab-info" aria-controls="panel-info">기본 정보</button>
        ${canViewAudit ? `<button role="tab" aria-selected="false" data-tab="audit" id="tab-audit" aria-controls="panel-audit">감사 이력 <span class="tab-count">${auditLogs.length}</span></button>` : ""}
        ${canViewMovements ? `<button role="tab" aria-selected="false" data-tab="movements" id="tab-movements" aria-controls="panel-movements">위치 이동 <span class="tab-count">${movements.length}</span></button>` : ""}
      </div>
      <div class="tab-panel" id="panel-info" role="tabpanel" aria-labelledby="tab-info">${information}</div>
      ${canViewAudit ? `<div class="tab-panel" id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden><section class="panel">${timeline(auditLogs, renderAuditLog, "감사 이력이 없습니다.")}</section></div>` : ""}
      ${canViewMovements ? `<div class="tab-panel" id="panel-movements" role="tabpanel" aria-labelledby="tab-movements" hidden><section class="panel">${timeline(movements, renderMovementLog, "위치 이동 이력이 없습니다.")}</section></div>` : ""}
    ` : `<div class="document-info">${information}</div>`}
    ${canManageDisposals && document.status === "active" ? disposeModal(document) : ""}
  `, session);
}

function detail(label, value) {
  return `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function documentActions(document, capabilities) {
  if (document.status === "active") {
    const actions = [
      capabilities.canManageDocuments ? `<a class="button sm" href="/documents/${document.id}/edit">수정</a>` : "",
      capabilities.canMoveDocuments ? `<a class="button secondary sm" href="/documents/${document.id}/move">위치 이동</a>` : "",
      capabilities.canManageDisposals ? `<button type="button" class="danger-button sm" data-open-modal="dispose-modal">폐기</button>` : ""
    ].filter(Boolean);
    return actions.length ? `<div class="button-group">${actions.join("")}</div>` : "";
  }
  return capabilities.canManageDisposals
    ? `<div class="button-group"><form method="post" action="/documents/${document.id}/restore" class="inline-form"><label class="sr-only" for="restore-reason-${document.id}">폐기 해제 사유</label><input id="restore-reason-${document.id}" name="reason" placeholder="폐기 해제 사유" required><button type="submit" class="button sm">폐기 해제</button></form></div>`
    : "";
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

function renderMovementLog(log) {
  const actor = log.performed_by_name || log.performed_by_username || "알 수 없음";
  return timelineItem(
    `${log.from_location_snapshot} → ${log.to_location_snapshot}`,
    `${actor} / ${log.created_at}`,
    log.reason
  );
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
