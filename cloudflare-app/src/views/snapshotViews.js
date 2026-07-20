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
  create: "추가",
  update: "변경",
  unchanged: "유지",
  staged: "검증 전"
});

export function documentSnapshotPage({ session, state, snapshots = [], error = "" }) {
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
    <section class="panel snapshot-intro" data-excel-snapshot data-current-version="${Number(state.currentVersion)}">
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
          <p class="muted" data-excel-message aria-live="polite">첫 시트 또는 ‘문서데이터’ 시트의 한글 13개 열을 읽습니다. 최대 1,000건까지 가능합니다.</p>
          <button type="submit" class="primary" data-excel-upload-button>검증 후 변경 내역 만들기</button>
        </form>
      </div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>운영 원칙</h2><span class="count-badge">안전 동기화</span></div>
      <ul class="snapshot-rules">
        <li>오류가 한 건이라도 있으면 현재 문서대장은 변경하지 않습니다.</li>
        <li>엑셀에서 사라진 문서는 삭제 대신 대장에서 제외해 감사·세트·이동 이력을 보존합니다.</li>
        <li>추출된 파일에는 인쇄용 관리대장과 숨김 관리 ID가 함께 들어갑니다.</li>
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

export function documentSnapshotDetailPage({ session, snapshot, rows = [], error = "", applied = false }) {
  const bodyRows = rows.map((row) => {
    const payload = parseJson(row.normalized_json);
    return `
      <tr>
        <td>${number(row.row_number)}</td>
        <td>${actionBadge(row.action)}</td>
        <td class="mono">${escapeHtml(payload?.values?.documentNumber || "-")}</td>
        <td>${escapeHtml(payload?.values?.revisionNumber || "-")}</td>
        <td>${escapeHtml(payload?.values?.documentName || "-")}</td>
      </tr>`;
  }).join("");
  const canApply = snapshot.status === "ready";
  const notice = applied || snapshot.status === "completed"
    ? `<div class="alert success" role="status">이 엑셀 파일이 현재 문서대장으로 반영되었습니다.</div>`
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
    <section class="panel" data-excel-snapshot>
      <div class="metric-grid snapshot-metrics">
        ${metric("전체", snapshot.total_count)}
        ${metric("추가", snapshot.create_count)}
        ${metric("변경", snapshot.update_count)}
        ${metric("유지", snapshot.unchanged_count)}
        ${metric("제외", snapshot.exclude_count)}
      </div>
      <div class="snapshot-apply-row">
        <div><strong>${snapshotStatus(snapshot.status)}</strong><p class="muted">기준 버전 ${number(snapshot.base_version)}${snapshot.previous_snapshot_id ? ` · 이전 스냅샷 #${number(snapshot.previous_snapshot_id)}` : ""} · ${escapeHtml(snapshot.created_by_name)} · ${escapeHtml(snapshot.created_at)}</p></div>
        ${canApply ? `<form method="post" action="/document-snapshots/${Number(snapshot.id)}/apply" data-confirm="이 엑셀을 현재 문서대장으로 반영할까요? 기존 대장에 없는 문서는 제외 상태가 됩니다."><button type="submit" class="primary">현재 대장으로 반영</button></form>` : ""}
      </div>
    </section>
    <section class="panel results-panel">
      <div class="section-title"><h2>행별 변경 내역</h2><span class="count-badge">${rows.length}건</span></div>
      <div class="table-wrap"><table class="doc-table"><thead><tr><th>엑셀 행</th><th>처리</th><th>문서번호</th><th>개정</th><th>문서명</th></tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="5" class="empty">표시할 행이 없습니다.</td></tr>`}</tbody></table></div>
    </section>
  `, session);
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
