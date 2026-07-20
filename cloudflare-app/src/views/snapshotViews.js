import { PERMISSION_LABELS } from "../permissions.js";
import { escapeHtml } from "../ui/html/escape.js";
import { alertDanger, page } from "./layout.js";

const STATUS_LABELS = Object.freeze({
  staging: "업로드 중",
  ready: "반영 대기",
  applying: "반영 중",
  completed: "반영 완료",
  cancelled: "취소",
  failed: "검증 실패"
});

const ACTION_LABELS = Object.freeze({
  create: "신규",
  update: "변경",
  unchanged: "유지",
  staged: "검증 전"
});

const FLAG_LABELS = Object.freeze({
  CREATE: "신규",
  METADATA: "일반정보",
  MOVE: "위치",
  DISPOSE: "폐기",
  RESTORE: "폐기 해제",
  TAG_CHANGE: "태그",
  REINCLUDE: "재포함",
  UNCHANGED: "유지"
});

export function documentSnapshotPage({ session, state, snapshots = [], error = "", applyMode = "admin-only" }) {
  const rows = snapshots.map((snapshot) => `
    <tr>
      <td class="mono"><a href="/document-snapshots/${Number(snapshot.id)}">${escapeHtml(snapshot.snapshot_code)}</a></td>
      <td>${escapeHtml(snapshot.source_name)}</td>
      <td>${snapshotStatus(snapshot.status)}</td>
      <td>${number(snapshot.total_count)}</td>
      <td>${number(snapshot.create_count)} / ${number(snapshot.update_count)} / ${number(snapshot.exclude_count)}</td>
      <td>${escapeHtml(snapshot.created_by_name)}</td>
      <td>${escapeHtml(snapshot.created_at)}</td>
    </tr>
  `).join("");
  return page("엑셀 문서대장 관리", `
    <script src="/assets/jszip.min.js"></script>
    <script src="/assets/exceljs.min.js"></script>
    <section class="page-head">
      <div><h1>엑셀 문서대장 관리</h1><p class="muted">엑셀 파일 한 건을 검증한 뒤 현재 문서대장 전체와 동기화합니다.</p></div>
      <button type="button" class="button secondary" data-excel-export><i class="fa-solid fa-file-excel"></i> 현재 대장 엑셀 추출</button>
    </section>
    ${error ? alertDanger(error) : ""}
    <section class="panel snapshot-intro" data-excel-snapshot data-current-version="${Number(state.currentVersion)}" data-current-snapshot-id="${Number(state.currentSnapshotId || 0)}" data-apply-mode="${escapeHtml(applyMode)}">
      <div class="snapshot-version"><span>현재 대장 버전</span><strong>${number(state.currentVersion)}</strong><small>${escapeHtml(state.updatedAt || "초기 상태")}</small></div>
      <div>
        <h2>새 엑셀로 전체 동기화</h2>
        <p>기존 문서를 즉시 지우지 않습니다. 파일 전체를 검증하고 추가·변경·제외 내역을 먼저 보여준 뒤 확인할 때만 반영합니다.</p>
        <form class="stack" data-excel-snapshot-upload>
          <label>문서고 관리대장 엑셀
            <input type="file" name="excelFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
          </label>
          <div class="snapshot-file-summary" data-excel-file-summary hidden></div>
          <div class="snapshot-progress" data-excel-progress hidden><span data-excel-progress-bar></span></div>
          <p class="muted" data-excel-message aria-live="polite">시스템에서 추출한 관리 파일(_시스템정보 포함)을 권장합니다. 최대 1,000건까지 가능합니다.</p>
          <button type="submit" class="primary" data-excel-upload-button>검증 후 변경 내역 만들기</button>
        </form>
      </div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>운영 원칙</h2><span class="count-badge">안전 동기화</span></div>
      <ul class="snapshot-rules">
        <li>오류가 한 건이라도 있으면 현재 문서대장은 변경하지 않습니다.</li>
        <li>엑셀에서 사라진 문서는 삭제 대신 대장에서 제외해 감사·세트·이동 이력을 보존합니다.</li>
        <li>최종 반영은 전용 권한과 위치·폐기 권한이 필요할 수 있습니다.</li>
        <li>추출 후 시스템이 변경된 오래된 엑셀은 반영하지 않습니다.</li>
      </ul>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>최근 동기화</h2><span class="count-badge">${snapshots.length}건</span></div>
      <div class="table-wrap"><table class="doc-table">
        <thead><tr><th>작업 번호</th><th>파일</th><th>상태</th><th>문서 수</th><th>추가 / 변경 / 제외</th><th>작업자</th><th>생성일</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">아직 엑셀 동기화 작업이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </section>
  `, session);
}

export function documentSnapshotDetailPage({
  session,
  snapshot,
  rows = [],
  exclusions = [],
  error = "",
  applied = false,
  canApply = false,
  applyBlockReason = "",
  requiredPermissions = [],
  missingPermissions = [],
  warnings = [],
  applyMode = "admin-only",
  status = 200
}) {
  const parsedRows = rows.map((row) => ({
    ...row,
    after: parseJson(row.after_json || row.normalized_json),
    before: parseJson(row.before_json),
    changedFields: parseJson(row.changed_fields_json) || [],
    changeFlags: parseJson(row.change_flags_json) || []
  }));
  const bodyRows = parsedRows.map((row) => {
    const values = row.after?.values || {};
    const beforeValues = row.before?.values || {};
    return `
      <tr data-row-filter="${escapeHtml(filterKey(row))}">
        <td>${number(row.row_number)}</td>
        <td>${flagBadges(row.changeFlags, row.action)}</td>
        <td class="mono">${escapeHtml(values.documentNumber || "-")}</td>
        <td>${escapeHtml(values.revisionNumber || "-")}</td>
        <td>${escapeHtml(values.documentName || "-")}</td>
        <td>${escapeHtml((row.changedFields || []).join(", ") || "-")}</td>
        <td>${diffCell(beforeValues, row.changedFields)}</td>
        <td>${diffCell(values, row.changedFields)}</td>
        <td>${escapeHtml(locationText(beforeValues))}</td>
        <td>${escapeHtml(locationText(values))}</td>
        <td>${escapeHtml(statusText(beforeValues.status))} → ${escapeHtml(statusText(values.status))}</td>
      </tr>`;
  }).join("");
  const exclusionRows = exclusions.map((item) => {
    const before = parseJson(item.before_json);
    const values = before?.values || {};
    return `
      <tr>
        <td class="mono">${escapeHtml(values.documentNumber || "-")}</td>
        <td>${escapeHtml(values.revisionNumber || "-")}</td>
        <td>${escapeHtml(values.documentName || "-")}</td>
        <td>${escapeHtml(statusText(values.status))}</td>
        <td>${escapeHtml(locationText(values))}</td>
        <td>업로드 파일에 행 없음</td>
      </tr>`;
  }).join("");
  const notice = applied || snapshot.status === "completed"
    ? `<div class="alert success" role="status">이 엑셀 파일이 현재 문서대장으로 반영되었습니다.</div>`
    : "";
  const permissionText = (requiredPermissions || [])
    .map((permission) => PERMISSION_LABELS[permission] || permission)
    .join(", ");
  const missingText = (missingPermissions || [])
    .map((permission) => PERMISSION_LABELS[permission] || permission)
    .join(", ");
  const excludeCount = Number(snapshot.exclude_count || 0);
  const warningBlock = (warnings || []).length
    ? `<div class="snapshot-warnings" role="status">${(warnings || []).map((warning) => `
        <div class="alert ${warning.level === "danger" ? "danger" : warning.level === "info" ? "success" : "warning"}">
          <strong>${escapeHtml(warning.code || "WARNING")}</strong>
          ${escapeHtml(warning.message || "")}
        </div>`).join("")}</div>`
    : "";
  return page(`${snapshot.snapshot_code} 엑셀 동기화`, `
    <script src="/assets/jszip.min.js"></script>
    <script src="/assets/exceljs.min.js"></script>
    <section class="page-head">
      <div><h1>${escapeHtml(snapshot.snapshot_code)}</h1><p class="muted">${escapeHtml(snapshot.source_name)}</p></div>
      <div class="button-group"><button type="button" class="button secondary" data-excel-export>현재 대장 엑셀 추출</button><a class="button secondary" href="/documents/import">목록</a></div>
    </section>
    ${notice}
    ${error || snapshot.error_summary ? alertDanger(error || snapshot.error_summary) : ""}
    ${applyBlockReason && snapshot.status === "ready" ? alertDanger(applyBlockReason) : ""}
    ${warningBlock}
    <section class="panel" data-excel-snapshot data-apply-mode="${escapeHtml(applyMode)}">
      <div class="metric-grid snapshot-metrics">
        ${metric("전체", snapshot.total_count)}
        ${metric("신규", snapshot.create_count)}
        ${metric("일반정보", snapshot.metadata_count)}
        ${metric("위치", snapshot.move_count)}
        ${metric("태그", snapshot.tag_change_count)}
        ${metric("폐기", snapshot.dispose_count)}
        ${metric("폐기 해제", snapshot.restore_count)}
        ${metric("유지", snapshot.unchanged_count)}
        ${metric("제외", snapshot.exclude_count)}
        ${metric("재포함", snapshot.reinclude_count)}
      </div>
      <div class="snapshot-apply-row">
        <div>
          <strong>${snapshotStatus(snapshot.status)}</strong>
          <p class="muted">기준 버전 ${number(snapshot.base_version)}${snapshot.canonical_rows_hash ? ` · canonical hash ${escapeHtml(String(snapshot.canonical_rows_hash).slice(0, 12))}…` : ""} · ${escapeHtml(snapshot.created_by_name)} · ${escapeHtml(snapshot.created_at)}</p>
          <p class="muted">필요 권한: ${escapeHtml(permissionText || "문서 관리 + 엑셀 반영")}</p>
          ${missingText ? `<p class="muted">부족 권한: ${escapeHtml(missingText)}</p>` : ""}
          <p class="muted">client source hash(브라우저 보고값): <span class="mono">${escapeHtml(snapshot.source_hash || "-")}</span></p>
        </div>
      </div>
      ${canApply ? applyForm(snapshot, excludeCount) : ""}
    </section>
    <section class="panel results-panel">
      <div class="section-title">
        <h2>행별 변경 내역</h2>
        <span class="count-badge">${rows.length}건</span>
      </div>
      <div class="button-group snapshot-filters" role="group" aria-label="변경 유형 필터">
        ${filterButton("전체", "all", true)}
        ${filterButton("신규", "create")}
        ${filterButton("변경", "update")}
        ${filterButton("위치", "move")}
        ${filterButton("폐기", "dispose")}
        ${filterButton("폐기 해제", "restore")}
        ${filterButton("유지", "unchanged")}
      </div>
      <div class="table-wrap"><table class="doc-table" data-snapshot-rows>
        <thead><tr>
          <th>엑셀 행</th><th>처리</th><th>문서번호</th><th>개정</th><th>문서명</th>
          <th>변경 필드</th><th>변경 전</th><th>변경 후</th><th>현재 위치</th><th>변경 위치</th><th>상태 변화</th>
        </tr></thead>
        <tbody>${bodyRows || `<tr><td colspan="11" class="empty">표시할 행이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>대장 제외 예정</h2><span class="count-badge">${exclusions.length}건</span></div>
      <p class="muted">업로드 파일에 없어 현재 대장에서 제외될 문서입니다. 세트 연결과 감사 이력은 보존됩니다.</p>
      <div class="table-wrap"><table class="doc-table">
        <thead><tr><th>문서번호</th><th>개정</th><th>문서명</th><th>현재 상태</th><th>현재 위치</th><th>제외 사유</th></tr></thead>
        <tbody>${exclusionRows || `<tr><td colspan="6" class="empty">제외 예정 문서가 없습니다.</td></tr>`}</tbody>
      </table></div>
    </section>
    <script>
      (function () {
        var buttons = document.querySelectorAll('[data-snapshot-filter]');
        var rows = document.querySelectorAll('[data-row-filter]');
        buttons.forEach(function (button) {
          button.addEventListener('click', function () {
            var key = button.getAttribute('data-snapshot-filter');
            buttons.forEach(function (item) { item.classList.toggle('primary', item === button); item.classList.toggle('secondary', item !== button); });
            rows.forEach(function (row) {
              var value = row.getAttribute('data-row-filter') || '';
              row.hidden = key !== 'all' && value.indexOf(key) === -1;
            });
          });
        });
      })();
    </script>
  `, session, status);
}

function applyForm(snapshot, excludeCount) {
  return `
    <form method="post" action="/document-snapshots/${Number(snapshot.id)}/apply" class="stack snapshot-apply-form">
      <label>반영 사유 (10~500자)
        <textarea name="applyReason" required minlength="10" maxlength="500" rows="3" placeholder="예: 2026년 문서고 정기 대장 현행화"></textarea>
      </label>
      <label>승인 참조 (조건부 필수)
        <input type="text" name="approvalReference" maxlength="200" placeholder="예: CC-2026-0142">
      </label>
      ${excludeCount > 0 ? `
        <label>제외 예정 건수 재확인
          <input type="number" name="confirmedExcludeCount" required min="${excludeCount}" max="${excludeCount}" value="">
        </label>
        <label class="checkbox"><input type="checkbox" name="confirmExclude" value="1" required> 제외 ${number(excludeCount)}건을 검토했고 반영에 동의합니다.</label>
      ` : `<input type="hidden" name="confirmedExcludeCount" value="0">`}
      <button type="submit" class="primary">현재 대장으로 반영</button>
    </form>
  `;
}

function filterButton(label, key, active = false) {
  return `<button type="button" class="button ${active ? "primary" : "secondary"}" data-snapshot-filter="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
}

function filterKey(row) {
  const flags = row.changeFlags || [];
  const parts = [row.action];
  if (flags.includes("MOVE")) parts.push("move");
  if (flags.includes("DISPOSE")) parts.push("dispose");
  if (flags.includes("RESTORE")) parts.push("restore");
  if (flags.includes("CREATE")) parts.push("create");
  if (row.action === "update") parts.push("update");
  if (row.action === "unchanged") parts.push("unchanged");
  return parts.join(" ");
}

function flagBadges(flags = [], action) {
  if (!flags.length) return actionBadge(action);
  return flags.map((flag) => `<span class="status pending">${escapeHtml(FLAG_LABELS[flag] || flag)}</span>`).join(" ");
}

function diffCell(values, changedFields = []) {
  if (!changedFields.length) return "-";
  return escapeHtml(changedFields.map((field) => `${field}: ${formatValue(values?.[field])}`).join(" / "));
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(";");
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function locationText(values = {}) {
  if (!values.rackSlotId && !values.rackCode) return "-";
  const face = values.rackFace === "B" ? "2면" : values.rackFace === "A" ? "1면" : values.rackFace || "";
  return [values.rackCode || values.rackSlotId, values.rackColumn ? `${values.rackColumn}열` : "", values.shelfNumber ? `${values.shelfNumber}선반` : "", face]
    .filter(Boolean)
    .join(" / ");
}

function statusText(status) {
  if (status === "disposed") return "폐기";
  if (status === "active") return "보관중";
  return status || "-";
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${number(value)}</strong></div>`;
}

function snapshotStatus(status) {
  const type = status === "failed" || status === "cancelled" ? "disposed" : status === "completed" ? "active" : "pending";
  return `<span class="status ${type}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

function actionBadge(action) {
  const type = action === "create" ? "active" : action === "update" ? "pending" : "neutral";
  return `<span class="status ${type}">${escapeHtml(ACTION_LABELS[action] || action)}</span>`;
}

function parseJson(value) {
  try { return JSON.parse(value || "null"); } catch { return null; }
}

function number(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}
