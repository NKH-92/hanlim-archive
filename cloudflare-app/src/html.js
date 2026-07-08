import { escapeHtml, locationLabel, readBoolean } from "./utils.js";

export function page(title, body, session, status = 200) {
  const resolvedBody = session?.csrfToken ? withCsrfToken(body, session.csrfToken) : body;

  return new Response(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - 한림문서고</title>
  <meta name="description" content="한림문서고 문서 검색 및 보관 위치 안내 시스템">
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
  <style>${styles()}</style>
  <script>${clientScript()}</script>
</head>
<body>
  <a href="#main-content" class="skip-nav">본문 바로가기</a>
  ${session ? header(session) : ""}
  <main id="main-content" class="${session ? "app-shell" : "login-main"}">${resolvedBody}</main>
  ${session ? commandPalette() : ""}
</body>
</html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function withCsrfToken(body, token) {
  const hiddenInput = `<input type="hidden" name="csrf_token" value="${escapeHtml(token)}">`;
  return body.replace(/<form\b(?=[^>]*\bmethod=["']post["'])[^>]*>/gi, (formTag) => `${formTag}${hiddenInput}`);
}

function commandPalette() {
  return `
    <dialog id="command-palette" class="cmd-palette">
      <div class="cmd-palette-content">
        <label class="cmd-search-wrap">
          <i class="fa-solid fa-magnifying-glass cmd-icon"></i>
          <span class="sr-only">명령 또는 문서 검색</span>
          <input type="text" id="cmdSearchInput" placeholder="문서명, 문서번호, 위치 또는 메뉴 검색" autocomplete="off">
        </label>
        <div class="cmd-results" id="cmdResults"></div>
      </div>
    </dialog>
  `;
}

export function loginPage({ returnUrl, error, setupWarning, signupSubmitted }) {
  return page("로그인", `
    <section class="login-shell">
      <div class="login-side">
        <span class="login-logo">HA</span>
        <h1>한림문서고</h1>
        <p>문서 정보와 실제 보관 위치를 한 번에 찾는 전용 검색 시스템입니다.</p>
      </div>
      <div class="login-panel">
        <p class="eyebrow">로그인</p>
        <h2>문서고 검색 시작</h2>
        ${setupWarning ? alertWarning(setupWarning) : ""}
        ${error ? alertDanger("아이디 또는 비밀번호가 올바르지 않습니다.") : ""}
        ${signupSubmitted ? `<div class="alert success" role="alert">가입 요청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.</div>` : ""}
        <form method="post" action="/login" class="stack">
          <input type="hidden" name="returnUrl" value="${escapeHtml(returnUrl)}">
          <label>아이디<input name="username" autocomplete="username" required></label>
          <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit" class="primary">로그인</button>
        </form>
        <p class="muted form-foot"><a href="/signup">계정이 없으면 가입 요청</a></p>
      </div>
    </section>
  `, null);
}

export function signupPage({ values = {}, error = "" }) {
  return page("가입 요청", `
    <section class="login-shell">
      <div class="login-side">
        <span class="login-logo">HA</span>
        <h1>한림문서고</h1>
        <p>관리자 승인 후 문서 검색과 위치 조회를 이용할 수 있습니다.</p>
      </div>
      <div class="login-panel">
        <p class="eyebrow">가입 요청</p>
        <h2>사용자 정보 입력</h2>
        ${error ? alertDanger(error) : ""}
        <form method="post" action="/signup" class="stack">
          <label>아이디<input name="username" value="${escapeHtml(values.username)}" autocomplete="username" required></label>
          <label>이름<input name="displayName" value="${escapeHtml(values.displayName)}" required></label>
          <label>비밀번호<input name="password" type="password" autocomplete="new-password" required></label>
          <button type="submit" class="primary">가입 요청</button>
        </form>
        <p class="muted form-foot"><a href="/login">로그인으로 돌아가기</a></p>
      </div>
    </section>
  `, null);
}

export function dashboardPage({
  session,
  query,
  racks = [],
  viewerSearch = { items: [], pagination: { totalItems: 0, totalPages: 1, page: 1, pageSize: 12 }, facets: {}, suggestions: [] },
  floorPlan = [],
  categories = [],
  tags = [],
  filters = {},
  categoryIndex = [],
  quality = null
}) {
  const documents = viewerSearch.items || [];
  const suggestions = viewerSearch.suggestions || [];
  const hits = new Set(documents.map((document) => document.location?.rackCode).filter(Boolean));
  const totalActive = racks.reduce((sum, rack) => sum + Number(rack.active_document_count || 0), 0);

  return page("문서 검색", `
    <section class="viewer-hero" aria-labelledby="viewer-title">
      <div class="viewer-hero-copy">
        <p class="eyebrow">통합 검색</p>
        <h1 id="viewer-title">문서를 찾고 실제 위치로 이동하세요.</h1>
        <p>문서번호, 문서명, 대분류, 태그, 랙 위치를 한 번에 검색하고 도면에서 찾아갈 구역을 바로 확인합니다.</p>
      </div>
      ${viewerSearchForm({ query, suggestions, categories, tags, filters })}
      ${viewerQuickFilters(viewerSearch.facets || {}, { query, filters })}
      <div class="quick-row viewer-recents" data-recent-searches></div>
    </section>

    ${dashboardStats(racks, totalActive, documents, query)}
    ${quality ? dataQualityPanel(quality) : ""}

    <section class="viewer-workspace" data-viewer-app>
      <article class="panel results-panel" aria-labelledby="viewer-results-title" data-viewer-results>
        <div class="section-title">
          <div>
            <p class="eyebrow">${query ? "검색 결과" : "최근 문서"}</p>
            <h2 id="viewer-results-title">${query ? `"${escapeHtml(query)}" 결과` : "최근 보유 문서"}</h2>
          </div>
          <span class="count-badge">${Number(viewerSearch.pagination?.totalItems || 0)}건</span>
        </div>
        ${viewerDocumentResults(documents, query)}
        ${viewerPagination(viewerSearch.pagination, { query, filters })}
      </article>

      <aside class="panel viewer-location-panel" aria-labelledby="viewer-location-title" data-viewer-map>
        <div class="section-title">
          <div>
            <p class="eyebrow">위치 안내</p>
            <h2 id="viewer-location-title">문서고 도면</h2>
          </div>
          <a class="button secondary sm" href="/racks">랙 목록</a>
        </div>
        ${floorPlanView(floorPlan, hits)}
      </aside>
    </section>

    <section class="content-grid viewer-secondary">
      <aside class="panel">
        <div class="section-title"><div><p class="eyebrow">대분류 탐색</p><h2>문서고 인덱스</h2></div></div>
        ${categoryIndexView(categoryIndex)}
      </aside>
      ${session.role === "Admin" ? `<aside class="panel">
        <div class="section-title"><div><p class="eyebrow">관리 흐름</p><h2>기준 정보 바로가기</h2></div></div>
        <div class="admin-link-grid">
          <a href="/racks/configure"><i class="fa-solid fa-table-cells"></i><span>랙 설정</span></a>
          <a href="/categories"><i class="fa-solid fa-layer-group"></i><span>대분류</span></a>
          <a href="/tags"><i class="fa-solid fa-tags"></i><span>태그</span></a>
          <a href="/documents/import"><i class="fa-solid fa-file-import"></i><span>CSV 가져오기</span></a>
        </div>
      </aside>` : `<aside class="panel">
        <div class="section-title"><div><p class="eyebrow">찾기 팁</p><h2>위치로 좁혀 보기</h2></div></div>
        <div class="hint-box">
          <strong>문서번호가 정확하지 않아도 됩니다.</strong>
          <p>구역, 랙 번호, 대분류, 태그를 함께 선택하면 실제 보관 위치에 가까운 결과부터 확인할 수 있습니다.</p>
        </div>
      </aside>`}
    </section>
  `, session);
}

export function documentsPage({
  session,
  query,
  documents,
  categories = [],
  tags = [],
  filters = {},
  categoryIndex = [],
  suggestions = [],
  pagination = { page: 1, pageSize: 30, totalDocuments: documents.length, totalPages: 1 }
}) {
  return page("문서 검색", `
    <section class="page-head">
      <div>
        <p class="eyebrow">문서 검색</p>
        <nav class="breadcrumb" aria-label="경로"><a href="/app">홈</a><span>/</span><span>문서 검색</span></nav>
        <h1>한림문서고 전체 검색</h1>
      </div>
      ${documentToolbar(session)}
    </section>

    <section class="panel search-panel">
      <form method="get" action="/documents" class="filter-bar" id="documentFilterForm" data-search-form>
        ${searchInputBlock(query, suggestions)}
        <div class="filter-row">
          <label>대분류
            <select name="category">
              <option value="">전체 대분류</option>
              ${categories.map((c) => option(c.id, `${c.name}`, filters.categoryId)).join("")}
            </select>
          </label>
          <label>태그
            <select name="tag">
              <option value="">전체 태그</option>
              ${tags.map((tag) => option(tag.id, tag.name, filters.tagId)).join("")}
            </select>
          </label>
          <label>구역
            <select name="zone">
              <option value="">전체 구역</option>
              ${[1, 2, 3].map((zone) => option(zone, `${zone}구역`, filters.zoneNumber)).join("")}
            </select>
          </label>
          <label>상태
            <select name="status">
              <option value="">전체 상태</option>
              ${option("active", "보관중", filters.status)}
              ${option("disposed", "폐기", filters.status)}
            </select>
          </label>
          <label>정렬
            <select name="sort">
              ${option("relevance", "정확도순", filters.sort || "relevance")}
              ${option("updated", "최신순", filters.sort)}
              ${option("docnum", "문서번호순", filters.sort)}
              ${option("category", "대분류순", filters.sort)}
              ${option("location", "랙 위치순", filters.sort)}
            </select>
          </label>
        </div>
      </form>
    </section>

    <section class="content-grid">
      <article class="panel results-panel">
        <div class="section-title">
          <div>
            <p class="eyebrow">${pagination.totalDocuments}건 중 ${documents.length}건 표시</p>
            <h2>${query ? `"${escapeHtml(query)}" 검색 결과` : "전체 보유문서"}</h2>
          </div>
          <span class="count-badge">${pagination.totalDocuments}건</span>
        </div>
        ${documentResults(documents, { bulk: session.role === "Admin", emptyQuery: query, showScore: Boolean(query) })}
        ${paginationView(pagination, { query, filters })}
        ${session.role === "Admin" ? bulkActionBar() : ""}
      </article>

      <aside class="panel index-panel">
        <div class="section-title">
          <div>
            <p class="eyebrow">단계적 탐색</p>
            <h2>대분류별 전체 리스트</h2>
          </div>
        </div>
        ${categoryIndexView(categoryIndex)}
        <div class="hint-box">
          <strong>검색 결과가 없나요?</strong>
          <p>대분류, 태그, 랙 위치를 하나씩 선택해 문서고 전체 인덱스를 좁혀 보세요.</p>
        </div>
      </aside>
    </section>
  `, session);
}

export function qaPage({ session }) {
  return page("Q&A", `
    <section class="page-head">
      <div>
        <p class="eyebrow">도움말</p>
        <h1>Q&amp;A</h1>
      </div>
      <a class="button secondary" href="mailto:nkh92@hanlim.com">담당자 문의</a>
    </section>
    <section class="content-grid">
      <article class="panel">
        <h2>검색 방법</h2>
        <ul class="manual-list">
          <li><strong>문서번호 일부</strong><span>예: PV-2026 대신 2026 또는 PV만 입력해도 검색합니다.</span></li>
          <li><strong>문서명 키워드</strong><span>띄어쓰기와 일부 오타를 허용해 유사한 문서를 우선 보여줍니다.</span></li>
          <li><strong>위치 검색</strong><span>1구역, 2번 랙, 1-01처럼 보관 위치 단서로도 찾을 수 있습니다.</span></li>
        </ul>
      </article>
      <article class="panel">
        <h2>담당자</h2>
        <dl class="contact-list">
          <div><dt>부서 / 이름</dt><dd>SQA팀 담당자</dd></div>
          <div><dt>이메일</dt><dd><a href="mailto:nkh92@hanlim.com">nkh92@hanlim.com</a></dd></div>
        </dl>
      </article>
    </section>
  `, session);
}

export function adminDashboardPage({ session, pendingCount }) {
  return page("관리자", `
    <section class="page-head">
      <div>
        <p class="eyebrow">관리자</p>
        <h1>문서고 운영 관리</h1>
      </div>
    </section>
    <section class="admin-grid">
      <a class="panel admin-tile" href="/admin/settings"><small>가입 요청</small><strong>${pendingCount}건 대기</strong></a>
      <a class="panel admin-tile" href="/documents"><small>문서 관리</small><strong>검색 / 수정 / 이동 / 폐기</strong></a>
      <a class="panel admin-tile" href="/documents/import"><small>CSV</small><strong>대량 등록 / 내보내기</strong></a>
      <a class="panel admin-tile" href="/racks/configure"><small>랙 설정</small><strong>구역별 랙 수 조정</strong></a>
      <a class="panel admin-tile" href="/categories"><small>분류</small><strong>대분류 관리</strong></a>
      <a class="panel admin-tile" href="/tags"><small>태그</small><strong>검색 보조 키워드 관리</strong></a>
    </section>
  `, session);
}

export function adminSettingsPage({ session, users }) {
  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");
  const rejected = users.filter((u) => u.status === "rejected");
  return page("관리자 설정", `
    <section class="page-head"><div><p class="eyebrow">설정</p><h1>사용자 승인 관리</h1></div></section>
    <section class="panel">${sectionHeader("가입 요청", `${pending.length}건`)}${pending.length ? userRequestTable(pending) : emptyState("대기 중인 가입 요청이 없습니다.")}</section>
    <section class="two-col">
      <article class="panel">${sectionHeader("승인된 사용자", `${approved.length}명`)}${approved.length ? userRequestTable(approved) : emptyState("승인된 사용자가 없습니다.")}</article>
      <article class="panel">${sectionHeader("반려된 요청", `${rejected.length}건`)}${rejected.length ? userRequestTable(rejected) : emptyState("반려된 요청이 없습니다.")}</article>
    </section>
  `, session);
}

export function documentFormPage({ session, title, action, values = {}, categories, tags, slots, selectedTags = [], error = "", showLocation = true }) {
  return page(title, `
    <section class="page-head"><div><p class="eyebrow">${session.role === "Admin" ? "관리자" : "사용자"}</p><h1>${escapeHtml(title)}</h1></div></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        <label>문서번호 <em>*</em><input name="documentNumber" value="${escapeHtml(formValue(values, "documentNumber", "document_number"))}" required></label>
        <label>개정번호 <em>*</em><input name="revisionNumber" value="${escapeHtml(formValue(values, "revisionNumber", "revision_number") || "Rev.0")}" required></label>
        <label>문서명 <em>*</em><input name="documentName" value="${escapeHtml(formValue(values, "documentName", "document_name"))}" required></label>
        <label>대분류 <em>*</em><select name="categoryId" required>${categories.map((c) => option(c.id, c.name, formValue(values, "categoryId", "category_id"))).join("")}</select></label>
        ${showLocation ? `${locationPicker(slots, formValue(values, "rackSlotId", "rack_slot_id"))}
        <label>보관 면 <em>*</em><select name="rackFace" required>${option("A", "A면", formValue(values, "rackFace", "rack_face") || "A")}${option("B", "B면", formValue(values, "rackFace", "rack_face"))}</select></label>` : ""}
        <fieldset class="check-grid">
          <legend>태그</legend>
          ${tags.map((tag) => `<label class="check-item"><input type="checkbox" name="tagIds" value="${tag.id}" ${selectedTags.includes(tag.id) ? "checked" : ""}><span>${escapeHtml(tag.name)}</span></label>`).join("")}
        </fieldset>
        <label>비고<textarea name="note" rows="3">${escapeHtml(formValue(values, "note", "note"))}</textarea></label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}

export function moveFormPage({ session, document, slots, error = "" }) {
  return page("문서 이동", `
    <section class="page-head"><div><p class="eyebrow">${escapeHtml(document.storage_code)}</p><h1>문서 이동</h1></div></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/documents/${document.id}/move" class="stack">
        <label>현재 위치<input value="${escapeHtml(locationLabel(document))}" readonly></label>
        ${locationPicker(slots, document.rack_slot_id)}
        <label>새 보관 면 <select name="rackFace" required>${option("A", "A면", document.rack_face)}${option("B", "B면", document.rack_face)}</select></label>
        <label>이동 사유<textarea name="note" rows="3"></textarea></label>
        <button type="submit" class="primary">이동</button>
      </form>
    </section>
  `, session);
}

export function documentDetailsPage({ session, document, tags, movementLogs, disposalLogs, auditLogs }) {
  const isAdmin = session.role === "Admin";
  return page(document.document_name, `
    <section class="page-head">
      <div>
        <p class="eyebrow">문서 상세</p>
        <nav class="breadcrumb" aria-label="경로"><a href="/app">홈</a><span>/</span><a href="/documents">문서 검색</a><span>/</span><span>상세</span></nav>
        <h1>${escapeHtml(document.document_name)}</h1>
      </div>
      <div class="head-actions">
        ${statusBadge(document.status)}
        ${isAdmin ? documentActions(document) : ""}
      </div>
    </section>
    <section class="locator-hero">
      <div>
        <p class="eyebrow">랙 위치 안내</p>
        <strong>${escapeHtml(locationLabel(document))}</strong>
        <span>${escapeHtml(document.rack_code)} · ${escapeHtml(document.rack_face)}면 · ${escapeHtml(document.storage_code)}</span>
      </div>
      <a class="button secondary" href="/documents?q=${encodeURIComponent(document.rack_code)}">같은 랙 문서 보기</a>
    </section>
    <div class="tab-nav" role="tablist" aria-label="문서 상세 정보">
      <button role="tab" aria-selected="true" data-tab="info" id="tab-info" aria-controls="panel-info">기본 정보</button>
      <button role="tab" aria-selected="false" data-tab="audit" id="tab-audit" aria-controls="panel-audit">감사 이력 <span class="tab-count">${auditLogs.length}</span></button>
      <button role="tab" aria-selected="false" data-tab="movement" id="tab-movement" aria-controls="panel-movement">이동 이력 <span class="tab-count">${movementLogs.length}</span></button>
      <button role="tab" aria-selected="false" data-tab="disposal" id="tab-disposal" aria-controls="panel-disposal">폐기 이력 <span class="tab-count">${disposalLogs.length}</span></button>
    </div>
    <div class="tab-panel" id="panel-info" role="tabpanel" aria-labelledby="tab-info">
      <section class="panel detail-grid">
        ${detail("문서번호", document.document_number)}
        ${detail("개정번호", document.revision_number)}
        ${detail("보관코드", document.storage_code)}
        ${detail("대분류", document.category_name)}
        ${detail("태그", tags.length ? tags.map((t) => t.name).join(", ") : "-")}
        ${detail("상태", document.status === "active" ? "보관중" : "폐기")}
        ${detail("비고", document.note || "-")}
      </section>
      ${renderMiniVisualizer(document)}
    </div>
    <div class="tab-panel" id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden><section class="panel">${timeline(auditLogs, renderAuditLog, "감사 이력이 없습니다.")}</section></div>
    <div class="tab-panel" id="panel-movement" role="tabpanel" aria-labelledby="tab-movement" hidden><section class="panel">${timeline(movementLogs, renderMovementLog, "이동 이력이 없습니다.")}</section></div>
    <div class="tab-panel" id="panel-disposal" role="tabpanel" aria-labelledby="tab-disposal" hidden><section class="panel">${timeline(disposalLogs, renderDisposalLog, "폐기 이력이 없습니다.")}</section></div>
    ${isAdmin && document.status === "active" ? disposeModal(document) : ""}
    ${isAdmin && document.status !== "active" ? deleteModal(document) : ""}
  `, session);
}

export function documentImportPage({ session, result = null, error = "" }) {
  return page("CSV 가져오기", `
    <section class="page-head">
      <div><p class="eyebrow">CSV</p><h1>문서 대량 등록</h1></div>
      <a class="button secondary" href="/documents/export.csv">CSV 내보내기</a>
    </section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      ${result ? importResult(result) : ""}
      <form method="post" action="/documents/import" class="stack" enctype="multipart/form-data">
        <label>CSV 파일<input type="file" name="csvFile" accept=".csv,text/csv"></label>
        <label>또는 CSV 붙여넣기<textarea name="csvText" rows="10" placeholder="documentNumber,revisionNumber,documentName,category,rackCode,rackColumn,shelfNumber,rackFace,tags,note,status"></textarea></label>
        <button type="submit" class="primary">가져오기</button>
      </form>
      <p class="muted">필수 열: documentNumber, revisionNumber, documentName, category, rackCode, rackColumn, shelfNumber, rackFace</p>
    </section>
  `, session);
}

export function racksPage({ session, racks }) {
  return page("랙 관리", `
    <section class="page-head"><div><p class="eyebrow">랙</p><h1>보관 랙 목록</h1></div><div class="button-group"><a class="button secondary" href="/racks/configure">구역별 설정</a><a class="button" href="/racks/new">랙 추가</a></div></section>
    <section class="rack-grid">
      ${racks.map((rack) => `
        <a class="panel rack-card" href="/racks/${rack.id}">
          <small>${rack.zone_number}구역</small>
          <strong>${rack.rack_number}번 랙</strong>
          <span>${escapeHtml(rack.code)} · ${rack.column_count || 1}열 ${rack.shelf_count || 3}행 · ${rack.active_document_count || 0}건</span>
        </a>
      `).join("")}
    </section>
  `, session);
}

export function rackConfigurePage({ session, counts, error = "" }) {
  return page("랙 설정", `
    <section class="page-head"><div><p class="eyebrow">랙 설정</p><h1>구역별 랙 수</h1></div></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="/racks/configure" class="stack">
        ${[1, 2, 3].map((zone) => `<label>${zone}구역 랙 수<input type="number" name="zone${zone}Count" min="0" max="15" value="${escapeHtml(counts[zone] ?? 0)}"></label>`).join("")}
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}

export function rackDetailsPage({ session, rack, documents }) {
  return page(`${rack.code} 랙`, `
    <section class="page-head">
      <div><p class="eyebrow">${rack.zone_number}구역</p><h1>${rack.rack_number}번 랙</h1></div>
      <a class="button" href="/racks/${rack.id}/edit">랙 수정</a>
    </section>
    <section class="locator-hero">
      <div><strong>${escapeHtml(rack.code)}</strong><span>${rack.column_count || 1}열 ${rack.shelf_count || 3}행 · ${readBoolean(rack.is_single_sided) ? "단면" : "양면"} · 문서 ${documents.length}건</span></div>
      <a class="button secondary" href="/documents?zone=${rack.zone_number}&sort=location">구역 문서 보기</a>
    </section>
    <section class="panel">${documentResults(documents, { emptyMessage: "이 랙에 등록된 문서가 없습니다." })}</section>
  `, session);
}

export function rackFormPage({ session, values = {}, action, title, error = "" }) {
  return page(title, `
    <section class="page-head"><div><p class="eyebrow">랙</p><h1>${escapeHtml(title)}</h1></div></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        <label>구역<input type="number" name="zoneNumber" min="1" max="3" value="${escapeHtml(values.zone_number ?? values.zoneNumber ?? 1)}" required></label>
        <label>랙 번호<input type="number" name="rackNumber" min="1" max="15" value="${escapeHtml(values.rack_number ?? values.rackNumber ?? 1)}" required></label>
        <label>열 수<input type="number" name="columnCount" min="1" max="20" value="${escapeHtml(values.column_count ?? values.columnCount ?? 1)}" required></label>
        <label>행 수<input type="number" name="shelfCount" min="1" max="20" value="${escapeHtml(values.shelf_count ?? values.shelfCount ?? 3)}" required></label>
        <label>이름<input name="name" value="${escapeHtml(values.name || "")}"></label>
        <label>설명<textarea name="description" rows="3">${escapeHtml(values.description || "")}</textarea></label>
        <label class="check-inline"><input type="checkbox" name="isSingleSided" value="1" ${readBoolean(values.is_single_sided ?? values.isSingleSided) ? "checked" : ""}> 단면 랙</label>
        <label class="check-inline"><input type="checkbox" name="isActive" value="1" ${readBoolean(values.is_active ?? values.isActive ?? 1) ? "checked" : ""}> 사용</label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
  `, session);
}

export function setsPage({ session, sets }) {
  const isAdmin = session.role === "Admin";
  return page("문서 세트", `
    <section class="page-head">
      <div><p class="eyebrow">문서 세트</p><h1>문서 세트</h1></div>
      ${isAdmin ? `<a class="button" href="/sets/new">세트 만들기</a>` : ""}
    </section>
    <p class="muted">감사 준비문서 목록처럼 자주 찾는 문서 묶음을 저장해 두고, 보관 위치를 한 번에 확인합니다.</p>
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
    <section class="page-head"><div><p class="eyebrow">문서 세트</p><h1>${escapeHtml(title)}</h1></div></section>
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

export function setDetailsPage({ session, set, documents, racks, addQuery = "", addCandidates = null, addResult = null, error = "" }) {
  const isAdmin = session.role === "Admin";
  const disposedCount = documents.filter((doc) => doc.status !== "active").length;
  const rackCount = new Set(documents.map((doc) => doc.rack_code)).size;
  const zoneCount = new Set(documents.map((doc) => doc.zone_number)).size;
  const hits = new Set(documents.map((doc) => `${doc.rack_code}:${doc.rack_face}`));

  return page(`${set.name} 세트`, `
    <section class="page-head">
      <div><p class="eyebrow">문서 세트</p><h1>${escapeHtml(set.name)}</h1></div>
      <div class="button-group">
        <button type="button" class="button secondary" data-print><i class="fa-solid fa-print"></i> 목록 인쇄</button>
        ${isAdmin ? `<a class="button secondary" href="/sets/${set.id}/edit">세트 수정</a>` : ""}
      </div>
    </section>
    ${set.description ? `<p class="muted">${escapeHtml(set.description)}</p>` : ""}
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
  `, session);
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
            <textarea name="numbers" rows="4" placeholder="문서번호 또는 보관코드를 줄바꿈이나 쉼표로 구분해 붙여넣으세요.&#10;예) MR-2026-001, PV-2026-014"></textarea>
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

export function categoriesPage({ session, categories, values = {}, error = "" }) {
  return masterPage({ session, title: "대분류 관리", action: "/categories", rows: categories, values, error, type: "categories" });
}

export function tagsPage({ session, tags, values = {}, error = "" }) {
  return masterPage({ session, title: "태그 관리", action: "/tags", rows: tags, values, error, type: "tags" });
}

export function passwordPage({ session, error = "", success = false }) {
  return page("비밀번호 변경", `
    <section class="page-head"><div><p class="eyebrow">계정</p><h1>비밀번호 변경</h1></div></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      ${success ? `<div class="alert success">비밀번호가 변경되었습니다.</div>` : ""}
      <form method="post" action="/account/password" class="stack">
        <label>현재 비밀번호<input type="password" name="currentPassword" autocomplete="current-password" required></label>
        <label>새 비밀번호<input type="password" name="newPassword" autocomplete="new-password" required></label>
        <label>새 비밀번호 확인<input type="password" name="confirmPassword" autocomplete="new-password" required></label>
        <button type="submit" class="primary">변경</button>
      </form>
    </section>
  `, session);
}

export function accessDeniedPage(session) {
  return errorPage("접근 권한이 없습니다.", session, 403);
}

export function notFoundPage(session) {
  return errorPage("요청한 페이지를 찾을 수 없습니다.", session, 404);
}

export function errorPage(message, session, status = 500) {
  return page("오류", `<section class="panel narrow">${alertDanger(message)}<a class="button secondary" href="/app">검색 화면으로 이동</a></section>`, session, status);
}

function header(session) {
  const home = session.role === "Admin" ? "/admin" : "/app";
  const adminLinks = [
    ["/admin", "fa-user-shield", "관리자"],
    ["/app", "fa-magnifying-glass", "검색"],
    ["/documents", "fa-file-lines", "문서"],
    ["/sets", "fa-list-check", "세트"],
    ["/racks", "fa-box-archive", "랙"],
    ["/categories", "fa-layer-group", "대분류"],
    ["/tags", "fa-tags", "태그"]
  ];
  const userLinks = [
    ["/app", "fa-magnifying-glass", "검색"],
    ["/documents", "fa-file-lines", "전체 문서"],
    ["/sets", "fa-list-check", "세트"],
    ["/qa", "fa-circle-question", "Q&A"]
  ];
  const links = session.role === "Admin" ? adminLinks : userLinks;

  return `
    <header class="topbar">
      <a href="${home}" class="brand"><span class="brand-mark"><i class="fa-solid fa-building-columns"></i></span><span><strong>한림문서고</strong><small>통합 문서 위치 검색</small></span></a>
      <button type="button" class="hamburger" aria-label="메뉴 열기" data-hamburger><span></span><span></span><span></span></button>
      <nav aria-label="주 메뉴" data-nav-menu>
        <button type="button" class="drawer-close" data-drawer-close aria-label="메뉴 닫기">×</button>
        ${links.map(([href, icon, text]) => `<a href="${href}" class="archive-nav-item"><i class="fa-solid ${icon}"></i>${text}</a>`).join("")}
        <div class="nav-user">
          <span class="session-pill">${escapeHtml(session.displayName)} · ${session.role === "Admin" ? "관리자" : "사용자"}</span>
          <a href="/account/password" class="nav-sub-link"><i class="fa-solid fa-key"></i>비밀번호</a>
          <a href="/logout" class="logout-link"><i class="fa-solid fa-right-from-bracket"></i>로그아웃</a>
        </div>
      </nav>
      <div class="nav-scrim" data-nav-scrim></div>
    </header>
  `;
}

function globalSearchForm({ action, query, suggestions, large = false }) {
  return `<form method="get" action="${action}" class="global-search ${large ? "large" : ""}" data-search-form>${searchInputBlock(query, suggestions)}</form>`;
}

function viewerSearchForm({ query, suggestions, categories, tags, filters }) {
  return `
    <form method="get" action="/app" class="viewer-search-form" data-search-form data-viewer-form>
      ${searchInputBlock(query, suggestions)}
      <div class="viewer-filter-row">
        <label>대분류
          <select name="category">
            <option value="">전체</option>
            ${categories.map((category) => option(category.id, category.name, filters.categoryId)).join("")}
          </select>
        </label>
        <label>태그
          <select name="tag">
            <option value="">전체</option>
            ${tags.map((tag) => option(tag.id, tag.name, filters.tagId)).join("")}
          </select>
        </label>
        <label>구역
          <select name="zone">
            <option value="">전체</option>
            ${[1, 2, 3].map((zone) => option(zone, `${zone}구역`, filters.zoneNumber)).join("")}
          </select>
        </label>
        <label>상태
          <select name="status">
            <option value="">전체</option>
            ${option("active", "보관중", filters.status)}
            ${option("disposed", "폐기", filters.status)}
          </select>
        </label>
        <label>정렬
          <select name="sort">
            ${option("relevance", "정확도순", filters.sort || "relevance")}
            ${option("updated", "최신순", filters.sort)}
            ${option("location", "위치순", filters.sort)}
            ${option("docnum", "문서번호순", filters.sort)}
            ${option("category", "대분류순", filters.sort)}
          </select>
        </label>
        <a class="button secondary sm" href="/app">초기화</a>
      </div>
    </form>
  `;
}

function viewerQuickFilters(facets, { query, filters }) {
  const zones = (facets.zones || []).slice(0, 3);
  const categories = (facets.categories || []).slice(0, 4);
  const statuses = (facets.statuses || []).filter((facet) => facet.count > 0);
  const chips = [
    ...zones.map((facet) => ({
      label: `${facet.label} ${facet.count}건`,
      href: viewerUrl({ query, filters, patch: { zoneNumber: facet.value } }),
      active: Number(filters.zoneNumber || 0) === Number(facet.value)
    })),
    ...categories.map((facet) => ({
      label: `${facet.label} ${facet.count}건`,
      href: viewerUrl({ query, filters, patch: { categoryId: facet.value } }),
      active: String(filters.categoryId || "") === String(facet.value)
    })),
    ...statuses.map((facet) => ({
      label: `${facet.label} ${facet.count}건`,
      href: viewerUrl({ query, filters, patch: { status: facet.value } }),
      active: String(filters.status || "") === String(facet.value)
    }))
  ];

  if (!chips.length) return "";
  return `
    <nav class="quick-filter-row" aria-label="빠른 필터">
      <span>빠른 필터</span>
      ${chips.map((chip) => `<a class="chip ${chip.active ? "active" : ""}" href="${chip.href}">${escapeHtml(chip.label)}</a>`).join("")}
    </nav>
  `;
}

function searchInputBlock(query, suggestions = []) {
  const id = `searchSuggestions-${Math.random().toString(36).slice(2)}`;
  return `
    <div class="search-box">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input name="q" value="${escapeHtml(query)}" placeholder="문서명, 문서번호, 키워드, 대분류, 랙 위치 검색" aria-label="검색어" list="${id}" autocomplete="off" data-suggest-input>
      <datalist id="${id}" data-suggest-list>
        ${suggestions.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label || item.value)}</option>`).join("")}
      </datalist>
      <button type="submit" class="primary">검색</button>
    </div>
  `;
}

function viewerDocumentResults(documents, query) {
  if (!documents.length) {
    return emptyResult("조건에 맞는 문서가 없습니다.", query);
  }
  return `<div class="viewer-result-list">${documents.map((document) => viewerDocumentCard(document)).join("")}</div>`;
}

function viewerDocumentCard(document) {
  const location = document.location || {};
  const locationText = location.label || "위치 미지정";
  const rackCode = location.rackCode || "";
  return `
    <article class="viewer-result-card ${document.status !== "active" ? "is-disposed" : ""}">
      <div class="viewer-location-main">
        <small>찾아갈 위치</small>
        <strong>${escapeHtml(locationText)}</strong>
        <div class="viewer-location-actions">
          ${rackCode ? `<a class="button secondary sm" href="/documents?q=${encodeURIComponent(rackCode)}&sort=location">같은 랙 문서</a>` : ""}
          <button type="button" class="button secondary sm" data-copy-text="${escapeHtml(locationText)}">위치 복사</button>
        </div>
      </div>
      <div class="viewer-doc-main">
        <div class="result-title">
          <a href="/documents/${document.id}">${escapeHtml(document.documentName || "문서명 없음")}</a>
          ${statusBadge(document.status)}
        </div>
        <dl class="result-meta">
          <div><dt>문서번호</dt><dd>${escapeHtml(document.documentNumber)}</dd></div>
          <div><dt>개정</dt><dd>${escapeHtml(document.revisionNumber)}</dd></div>
          <div><dt>대분류</dt><dd>${escapeHtml(document.categoryName || "-")}</dd></div>
          <div><dt>랙</dt><dd>${escapeHtml(rackCode || "-")}</dd></div>
        </dl>
        ${document.tags?.length ? `<div class="tag-row">${document.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        ${document.matchReason ? `<p class="match-reason"><i class="fa-solid fa-bullseye"></i>${escapeHtml(document.matchReason)}</p>` : ""}
      </div>
      <a class="button sm" href="/documents/${document.id}">상세 확인</a>
    </article>
  `;
}

function floorPlanView(regions, hits) {
  const activeRackCount = regions.reduce((sum, region) => sum + region.racks.filter((rack) => hits.has(rack.code)).length, 0);
  return `
    <div class="floor-plan-shell">
      <div class="floor-plan-media">
        <img src="/images/Archive.png" alt="한림 문서고 도면">
        ${regions.map((region) => `
          <section class="floor-region" aria-label="${escapeHtml(region.label)}" style="--top:${region.topPct}%;--left:${region.leftPct}%;--width:${region.widthPct}%;--height:${region.heightPct}%;">
            <span class="floor-region-label">${escapeHtml(region.label)}</span>
            ${region.racks.map((rack) => {
              const isHit = hits.has(rack.code);
              return `<a class="floor-rack ${isHit ? "is-hit" : ""}" href="/documents?q=${encodeURIComponent(rack.code)}&sort=location" style="--rack-left:${rack.leftPct}%;--rack-top:${rack.topPct}%;" title="${escapeHtml(rack.code)} ${rack.documentCount}건">
                <span>${escapeHtml(String(rack.rackNumber))}</span>
              </a>`;
            }).join("")}
          </section>
        `).join("")}
      </div>
      <div class="floor-plan-summary">
        <span>일치 랙 ${activeRackCount}개</span>
        <span><i class="legend-box"></i>랙</span>
        <span><i class="legend-box hit"></i>검색 위치</span>
      </div>
      <div class="zone-list">
        ${regions.map((region) => `<a href="/app?zone=${region.zoneNumber}&sort=location"><strong>${escapeHtml(region.label)}</strong><span>${region.racks.length}개 랙</span></a>`).join("")}
      </div>
    </div>
  `;
}

function viewerPagination(pagination = {}, { query, filters }) {
  const totalPages = Number(pagination.totalPages || 1);
  if (totalPages <= 1) return "";
  const page = Number(pagination.page || 1);
  return `
    <nav class="pagination" aria-label="검색 결과 페이지">
      <a class="button secondary sm ${page === 1 ? "disabled" : ""}" href="${viewerUrl({ query, filters, page: Math.max(1, page - 1) })}">이전</a>
      <span>${page} / ${totalPages}</span>
      <a class="button secondary sm ${page === totalPages ? "disabled" : ""}" href="${viewerUrl({ query, filters, page: Math.min(totalPages, page + 1) })}">다음</a>
    </nav>
  `;
}

function viewerUrl({ query, filters = {}, patch = {}, page = 1 }) {
  const merged = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (merged.categoryId) params.set("category", merged.categoryId);
  if (merged.tagId) params.set("tag", merged.tagId);
  if (merged.zoneNumber) params.set("zone", merged.zoneNumber);
  if (merged.status) params.set("status", merged.status);
  if (merged.sort) params.set("sort", merged.sort);
  if (page > 1) params.set("page", page);
  const text = params.toString();
  return text ? `/app?${text}` : "/app";
}

function dashboardStats(racks, totalActive, documents, query) {
  const capacity = racks.reduce((sum, rack) => {
    const sides = readBoolean(rack.is_single_sided) ? 1 : 2;
    return sum + Number(rack.column_count || 1) * Number(rack.shelf_count || 3) * sides;
  }, 0);
  const usage = capacity ? Math.round((totalActive / capacity) * 100) : 0;
  return `
    <section class="metric-strip" aria-label="요약">
      ${metric("운영 랙", racks.length, "전체 보관 랙")}
      ${metric("보관중 문서", totalActive, "활성 문서")}
      ${metric("위치 수용량", capacity, `사용률 ${usage}%`)}
      ${metric(query ? "검색 결과" : "최근 표시", documents.length, query ? "상위 결과" : "최근 문서")}
    </section>
  `;
}

function metric(label, value, caption) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small></article>`;
}

function dataQualityPanel(quality) {
  const items = [
    ["중복 문서번호", quality.duplicateDocumentNumbers],
    ["누락 위치", quality.missingLocation],
    ["비활성/누락 분류", quality.missingCategory],
    ["단면 랙 B면", quality.invalidRackFace],
    ["문자 깨짐 의심", quality.suspiciousText],
    ["태그 없음", quality.documentsWithoutTags],
    ["폐기 문서", quality.disposedDocuments]
  ];
  return `<section class="quality-strip" aria-label="데이터 품질">${items.map(([label, value]) => `<span class="${value ? "warn" : ""}"><strong>${value}</strong>${label}</span>`).join("")}</section>`;
}

function archiveMap(racks, hits) {
  return `
    <div class="archive-map">
      ${[1, 2, 3].map((zone) => {
        const zoneRacks = racks.filter((rack) => rack.zone_number === zone);
        return `<section class="rack-zone" aria-label="${zone}구역"><h3>${zone}구역</h3><div class="rack-zone-grid">
          ${zoneRacks.map((rack) => {
            const hitA = hits.has(`${rack.code}:A`);
            const hitB = hits.has(`${rack.code}:B`);
            const isHit = hitA || hitB;
            return `<a class="rack-tile ${isHit ? "is-hit" : ""}" href="/documents?q=${encodeURIComponent(rack.code)}" title="${escapeHtml(rack.code)} ${rack.document_count || 0}건">
              <strong>${rack.rack_number}</strong>
              <span>${escapeHtml(rack.code)}</span>
              <small>${hitA ? "A면 일치" : "A"}${readBoolean(rack.is_single_sided) ? "" : ` · ${hitB ? "B면 일치" : "B"}`}</small>
            </a>`;
          }).join("")}
        </div></section>`;
      }).join("")}
    </div>
  `;
}

function documentResults(documents, opts = {}) {
  if (!documents.length) {
    return emptyResult(opts.emptyMessage || "조건에 맞는 문서가 없습니다.", opts.emptyQuery);
  }
  return `<div class="result-list" data-paginate-root>${documents.map((doc) => documentCard(doc, opts)).join("")}</div>`;
}

function documentCard(doc, opts = {}) {
  return `
    <article class="result-card ${doc.status !== "active" ? "is-disposed" : ""}">
      ${opts.bulk ? `<label class="result-check"><input type="checkbox" name="docId" value="${doc.id}" data-bulk-item aria-label="문서 선택"><span></span></label>` : ""}
      <div class="result-main">
        <div class="result-title">
          <a href="/documents/${doc.id}">${escapeHtml(doc.document_name)}</a>
          ${statusBadge(doc.status)}
        </div>
        <dl class="result-meta">
          <div><dt>문서번호</dt><dd>${escapeHtml(doc.document_number)}</dd></div>
          <div><dt>개정</dt><dd>${escapeHtml(doc.revision_number)}</dd></div>
          <div><dt>대분류</dt><dd>${escapeHtml(doc.category_name)}</dd></div>
          <div><dt>보관코드</dt><dd>${escapeHtml(doc.storage_code)}</dd></div>
        </dl>
        ${doc.note ? `<p class="note-line">${escapeHtml(doc.note)}</p>` : ""}
        ${opts.showScore && doc.match_reason ? `<p class="match-reason"><i class="fa-solid fa-bullseye"></i>${escapeHtml(doc.match_reason)} · 점수 ${escapeHtml(doc.relevance_score)}</p>` : ""}
      </div>
      <aside class="location-card">
        <small>랙 위치</small>
        <strong>${escapeHtml(locationLabel(doc))}</strong>
        <a class="button sm secondary" href="/documents/${doc.id}">위치 보기</a>
      </aside>
    </article>
  `;
}

function emptyResult(message, query = "") {
  return `
    <div class="empty-state">
      <i class="fa-regular fa-folder-open"></i>
      <p>${escapeHtml(message)}</p>
      ${query ? `<div class="empty-actions"><a class="button secondary sm" href="/documents">전체 문서 보기</a><a class="button secondary sm" href="/app">대분류로 찾기</a></div>` : ""}
    </div>
  `;
}

function categoryIndexView(categories) {
  const visible = categories.filter((category) => readBoolean(category.is_active) || Number(category.document_count || 0) > 0);
  if (!visible.length) {
    return emptyState("등록된 대분류가 없습니다.");
  }
  return `<div class="category-index">${visible.map((category) => `
    <details class="category-node">
      <summary>
        <span>${escapeHtml(category.name)}</span>
        <strong>${Number(category.active_document_count || 0)}건</strong>
      </summary>
      <p>${escapeHtml(category.description || "설명 없음")}</p>
      <div class="category-actions">
        <a href="/documents?category=${category.id}&sort=location">문서 전체 보기</a>
        ${category.first_zone_number ? `<a href="/documents?zone=${category.first_zone_number}&sort=location">${category.first_zone_number}구역 보기</a>` : ""}
      </div>
    </details>
  `).join("")}</div>`;
}

function paginationView(pagination, { query, filters }) {
  if (pagination.totalPages <= 1) return "";
  const previous = pagination.page > 1 ? pagination.page - 1 : 1;
  const next = pagination.page < pagination.totalPages ? pagination.page + 1 : pagination.totalPages;
  return `
    <nav class="pagination" aria-label="검색 결과 페이지">
      <a class="button secondary sm ${pagination.page === 1 ? "disabled" : ""}" href="${documentListUrl({ query, filters, page: previous })}">이전</a>
      <span>${pagination.page} / ${pagination.totalPages}</span>
      <a class="button secondary sm ${pagination.page === pagination.totalPages ? "disabled" : ""}" href="${documentListUrl({ query, filters, page: next })}">다음</a>
    </nav>
  `;
}

function documentListUrl({ query, filters = {}, page = 1 }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.zoneNumber) params.set("zone", filters.zoneNumber);
  if (filters.tagId) params.set("tag", filters.tagId);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort) params.set("sort", filters.sort);
  if (page > 1) params.set("page", page);
  const text = params.toString();
  return text ? `/documents?${text}` : "/documents";
}

function statusBadge(status) {
  return `<span class="status ${status === "active" ? "active" : "disposed"}">${status === "active" ? "보관중" : "폐기"}</span>`;
}

function bulkActionBar() {
  return `
    <div class="bulk-bar" data-bulk-bar hidden>
      <span data-bulk-count>0건 선택</span>
      <form method="post" action="/documents/bulk-dispose" data-bulk-form>
        <input type="hidden" name="ids" data-bulk-ids>
        <label class="bulk-reason"><input name="reason" placeholder="폐기 사유" required></label>
        <button type="submit" class="danger-button sm">일괄 폐기</button>
      </form>
    </div>
  `;
}

function documentActions(document) {
  if (document.status === "active") {
    return `<div class="button-group"><a class="button sm" href="/documents/${document.id}/edit">수정</a><a class="button sm" href="/documents/${document.id}/move">이동</a><button type="button" class="danger-button sm" data-open-modal="dispose-modal">폐기</button></div>`;
  }
  return `<div class="button-group"><form method="post" action="/documents/${document.id}/restore"><button type="submit" class="button sm">폐기 해제</button></form><button type="button" class="danger-button sm" data-open-modal="delete-modal">완전 삭제</button></div>`;
}

function disposeModal(document) {
  return `<dialog id="dispose-modal" class="modal"><form method="post" action="/documents/${document.id}/dispose" class="modal-body"><h3>문서 폐기</h3><label>폐기 사유 <em>*</em><textarea name="reason" rows="3" required></textarea></label><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">폐기 확인</button></div></form></dialog>`;
}

function deleteModal(document) {
  return `<dialog id="delete-modal" class="modal"><form method="post" action="/documents/${document.id}/delete-permanent" class="modal-body"><h3>완전 삭제</h3><p class="danger-text">이 작업은 되돌릴 수 없습니다.</p><div class="modal-actions"><button type="button" class="button secondary" data-close-modal>취소</button><button type="submit" class="danger-button">완전 삭제</button></div></form></dialog>`;
}

function timeline(rows, renderer, emptyMessage) {
  return rows.length ? `<div class="timeline-container">${rows.map(renderer).join("")}</div>` : emptyState(emptyMessage);
}

function renderMovementLog(log) {
  const from = log.from_rack_code ? locationLabel({
    rack_code: log.from_rack_code,
    zone_number: log.from_zone_number,
    rack_number: log.from_rack_number,
    column_number: log.from_column_number,
    shelf_number: log.from_shelf_number,
    slot_code: log.from_slot_code,
    rack_face: log.from_rack_face
  }) : "최초 등록";
  const to = locationLabel({
    rack_code: log.to_rack_code,
    zone_number: log.to_zone_number,
    rack_number: log.to_rack_number,
    column_number: log.to_column_number,
    shelf_number: log.to_shelf_number,
    slot_code: log.to_slot_code,
    rack_face: log.to_rack_face
  });
  return timelineItem(`${from} → ${to}`, `${log.performed_by} / ${log.created_at}`, log.note || "이동 메모 없음");
}

function renderDisposalLog(log) {
  return timelineItem(log.action === "disposed" ? "문서 폐기" : "폐기 해제", `${log.performed_by} / ${log.created_at}`, log.reason || "-");
}

function renderAuditLog(log) {
  const labels = { legacy_import: "기존 데이터", create: "등록", update: "수정", move: "이동", dispose: "폐기", restore: "폐기 해제", delete_permanent: "완전 삭제" };
  return timelineItem(`${labels[log.action] || log.action}: ${log.summary}`, `${log.actor} (${log.actor_role}) / ${log.created_at}`, log.details || "");
}

function timelineItem(title, meta, body) {
  return `<div class="timeline-item"><div class="timeline-badge"></div><div class="timeline-content"><div class="timeline-header"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta)}</span></div>${body ? `<p>${escapeHtml(body)}</p>` : ""}</div></div>`;
}

function renderMiniVisualizer(document) {
  const cols = Math.max(1, Number(document.column_count || 1));
  const rows = Math.max(1, Number(document.shelf_count || 3));
  const activeCol = Number(document.column_number || 0);
  const activeRow = Number(document.shelf_number || 0);
  let slots = "";

  for (let row = rows; row >= 1; row -= 1) {
    for (let col = 1; col <= cols; col += 1) {
      const active = col === activeCol && row === activeRow;
      slots += `<div class="mini-slot ${active ? "active" : ""}" title="${col}열 ${row}행"><span>${col}-${row}</span>${active ? `<i class="fa-solid fa-location-dot"></i>` : ""}</div>`;
    }
  }

  return `
    <section class="panel minimap-card">
      <div class="section-title"><div><p class="eyebrow">서가 위치</p><h2>${escapeHtml(document.rack_code)} ${escapeHtml(document.rack_face)}면</h2></div><span class="count-badge">${activeCol}열 ${activeRow}행</span></div>
      <div class="mini-rack-grid" style="--cols:${cols};--rows:${rows}">${slots}</div>
    </section>
  `;
}

function detail(label, value) {
  return `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function importResult(result) {
  return `<div class="alert success">${result.created}건 가져오기 완료${result.disposed ? `, 폐기 ${result.disposed}건 반영` : ""}</div>`;
}

function masterPage({ session, title, action, rows, values, error, type }) {
  const isCategory = type === "categories";
  return page(title, `
    <section class="page-head"><div><p class="eyebrow">기준 정보</p><h1>${escapeHtml(title)}</h1></div></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${action}" class="stack">
        <label>이름<input name="name" value="${escapeHtml(values.name || "")}" required></label>
        <label>설명<input name="description" value="${escapeHtml(values.description || "")}"></label>
        ${isCategory ? `<label>정렬 순서<input name="sortOrder" type="number" value="${escapeHtml(values.sortOrder ?? 0)}"></label>` : ""}
        <button type="submit" class="primary">추가</button>
      </form>
    </section>
    <section class="panel">${masterList(rows, type)}</section>
  `, session);
}

function masterList(rows, type) {
  if (!rows.length) return emptyState("등록된 항목이 없습니다.");
  return `<div class="master-list">${rows.map((row) => masterRow(row, type)).join("")}</div>`;
}

function masterRow(row, type) {
  const isCategory = type === "categories";
  const base = `/${type}/${row.id}`;
  return `
    <article class="master-row">
      <form method="post" action="${base}/edit" class="master-form">
        <input name="name" value="${escapeHtml(row.name)}" required>
        <input name="description" value="${escapeHtml(row.description || "")}" placeholder="설명">
        ${isCategory ? `<input name="sortOrder" type="number" value="${escapeHtml(row.sort_order ?? 0)}">` : ""}
        <label class="check-inline"><input type="checkbox" name="isActive" value="1" ${readBoolean(row.is_active) ? "checked" : ""}> 사용</label>
        <button type="submit">수정</button>
      </form>
      <form method="post" action="${base}/delete" data-confirm="삭제하면 신규 등록 화면에 표시되지 않습니다. 계속할까요?">
        <button type="submit" class="danger-button">삭제</button>
      </form>
    </article>
  `;
}

function userRequestTable(users) {
  return `
    <div class="table-wrap"><table>
      <caption class="sr-only">사용자 목록</caption>
      <thead><tr><th>아이디</th><th>이름</th><th>상태</th><th>요청일</th><th>처리</th></tr></thead>
      <tbody>${users.map((user) => `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.display_name)}</td><td>${userStatus(user.status)}</td><td>${escapeHtml(user.requested_at || "-")}</td><td>${userActions(user)}</td></tr>`).join("")}</tbody>
    </table></div>
  `;
}

function userActions(user) {
  if (user.role === "Admin") return `<span class="muted">관리자 계정</span>`;
  if (user.status === "approved") return `<form method="post" action="/admin/users/${user.id}/reject" data-confirm="승인을 취소할까요?"><button type="submit" class="danger-button sm">승인 취소</button></form>`;
  if (user.status === "rejected") return `<form method="post" action="/admin/users/${user.id}/approve"><button type="submit" class="primary sm">재승인</button></form>`;
  return `<div class="button-group"><form method="post" action="/admin/users/${user.id}/approve"><button type="submit" class="primary sm">승인</button></form><form method="post" action="/admin/users/${user.id}/reject"><button type="submit" class="danger-button sm">반려</button></form></div>`;
}

function userStatus(status) {
  if (status === "approved") return `<span class="status active">승인</span>`;
  if (status === "rejected") return `<span class="status disposed">반려</span>`;
  return `<span class="status pending">대기</span>`;
}

function locationPicker(slots, selectedRackSlotId) {
  return `
    <label>보관 위치 <em>*</em>
      <select name="rackSlotId" required>
        <option value="">위치 선택</option>
        ${slots.map((slot) => option(slot.id, slot.label || `${slot.zone_number}구역 / ${slot.rack_number}번 랙 / ${slot.column_number}열 / ${slot.shelf_number}행`, selectedRackSlotId)).join("")}
      </select>
    </label>
  `;
}

function sectionHeader(title, count) {
  return `<div class="section-title"><h2>${escapeHtml(title)}</h2><span class="count-badge">${escapeHtml(count)}</span></div>`;
}

function documentToolbar(session) {
  if (session.role !== "Admin") return "";
  return `<div class="button-group"><a class="button" href="/documents/new">문서 등록</a><a class="button secondary" href="/documents/import">CSV 가져오기</a><a class="button secondary" href="/documents/export.csv">CSV 내보내기</a></div>`;
}

function option(value, label, selected) {
  const sel = String(value) === String(selected ?? "") ? " selected" : "";
  return `<option value="${escapeHtml(String(value))}"${sel}>${escapeHtml(label)}</option>`;
}

function formValue(values, camelKey, snakeKey) {
  return values?.[camelKey] ?? values?.[snakeKey] ?? "";
}

function alertDanger(message) {
  return `<div class="alert danger" role="alert" aria-live="assertive">${escapeHtml(message)}</div>`;
}

function alertWarning(message) {
  return `<div class="alert warning" role="alert">${escapeHtml(message)}</div>`;
}

function emptyState(message) {
  return `<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>${escapeHtml(message)}</p></div>`;
}

function clientScript() {
  return `
    document.addEventListener('DOMContentLoaded', function () {
      var nav = document.querySelector('[data-nav-menu]');
      var scrim = document.querySelector('[data-nav-scrim]');
      var hamburger = document.querySelector('[data-hamburger]');
      var close = document.querySelector('[data-drawer-close]');
      function setNav(open) {
        if (!nav) return;
        nav.classList.toggle('is-open', open);
        if (scrim) scrim.classList.toggle('is-open', open);
      }
      if (hamburger) hamburger.addEventListener('click', function () { setNav(true); });
      if (close) close.addEventListener('click', function () { setNav(false); });
      if (scrim) scrim.addEventListener('click', function () { setNav(false); });

      document.querySelectorAll('[data-confirm]').forEach(function (form) {
        form.addEventListener('submit', function (event) {
          if (!window.confirm(form.dataset.confirm)) event.preventDefault();
        });
      });

      document.querySelectorAll('[data-print]').forEach(function (button) {
        button.addEventListener('click', function () { window.print(); });
      });

      document.querySelectorAll('[data-tab]').forEach(function (tab) {
        tab.addEventListener('click', function () {
          var id = tab.dataset.tab;
          var nav = tab.closest('.tab-nav');
          if (nav) nav.querySelectorAll('[role="tab"]').forEach(function (item) { item.setAttribute('aria-selected', 'false'); });
          tab.setAttribute('aria-selected', 'true');
          document.querySelectorAll('.tab-panel').forEach(function (panel) { panel.hidden = panel.id !== 'panel-' + id; });
        });
      });

      document.querySelectorAll('[data-open-modal]').forEach(function (button) {
        button.addEventListener('click', function () {
          var modal = document.getElementById(button.dataset.openModal);
          if (modal && modal.showModal) modal.showModal();
        });
      });
      document.querySelectorAll('[data-close-modal]').forEach(function (button) {
        button.addEventListener('click', function () {
          var modal = button.closest('dialog');
          if (modal) modal.close();
        });
      });

      document.querySelectorAll('[data-search-form]').forEach(function (form) {
        form.addEventListener('submit', function () {
          var input = form.querySelector('input[name="q"]');
          var value = input ? input.value.trim() : '';
          if (!value) return;
          try {
            var recent = JSON.parse(localStorage.getItem('hanlimRecentSearches') || '[]').filter(function (item) { return item !== value; });
            recent.unshift(value);
            localStorage.setItem('hanlimRecentSearches', JSON.stringify(recent.slice(0, 6)));
          } catch {}
        });
      });

      var recentBox = document.querySelector('[data-recent-searches]');
      if (recentBox) {
        try {
          var recent = JSON.parse(localStorage.getItem('hanlimRecentSearches') || '[]');
          if (recent.length) {
            recentBox.innerHTML = '<span>최근 검색</span>' + recent.map(function (item) {
              return '<a class="chip" href="/app?q=' + encodeURIComponent(item) + '">' + escapeHtmlClient(item) + '</a>';
            }).join('');
          }
        } catch {}
      }

      document.querySelectorAll('[data-copy-text]').forEach(function (button) {
        button.addEventListener('click', function () {
          var text = button.dataset.copyText || '';
          if (!text) return;
          function done() {
            var original = button.textContent;
            button.textContent = '복사됨';
            setTimeout(function () { button.textContent = original; }, 1400);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () {});
          } else {
            var input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', '');
            input.style.position = 'fixed';
            input.style.left = '-9999px';
            document.body.appendChild(input);
            input.select();
            try { document.execCommand('copy'); done(); } catch {}
            input.remove();
          }
        });
      });

      document.querySelectorAll('[data-suggest-input]').forEach(function (input) {
        var datalist = input.parentElement ? input.parentElement.querySelector('[data-suggest-list]') : null;
        var timer = null;
        input.addEventListener('input', function () {
          clearTimeout(timer);
          var q = input.value.trim();
          if (!datalist || q.length < 2) return;
          timer = setTimeout(function () {
            fetch('/api/search-suggestions?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
              .then(function (response) { return response.ok ? response.json() : { suggestions: [] }; })
              .then(function (data) {
                datalist.innerHTML = (data.suggestions || []).map(function (item) {
                  return '<option value="' + escapeHtmlClient(item.value) + '">' + escapeHtmlClient(item.label || item.value) + '</option>';
                }).join('');
              })
              .catch(function () {});
          }, 180);
        });
      });

      var bulkBar = document.querySelector('[data-bulk-bar]');
      var bulkIds = document.querySelector('[data-bulk-ids]');
      var bulkCount = document.querySelector('[data-bulk-count]');
      function syncBulk() {
        var checked = Array.from(document.querySelectorAll('[data-bulk-item]:checked')).map(function (item) { return item.value; });
        if (bulkBar) bulkBar.hidden = checked.length === 0;
        if (bulkIds) bulkIds.value = checked.join(',');
        if (bulkCount) bulkCount.textContent = checked.length + '건 선택';
      }
      document.querySelectorAll('[data-bulk-item]').forEach(function (item) { item.addEventListener('change', syncBulk); });

      var cmd = document.getElementById('command-palette');
      var cmdInput = document.getElementById('cmdSearchInput');
      var cmdResults = document.getElementById('cmdResults');
      var routes = [
        { title: '검색', path: '/app', icon: 'fa-magnifying-glass' },
        { title: '문서 전체', path: '/documents', icon: 'fa-file-lines' },
        { title: '문서 등록', path: '/documents/new', icon: 'fa-plus' },
        { title: '랙 목록', path: '/racks', icon: 'fa-box-archive' },
        { title: '대분류 관리', path: '/categories', icon: 'fa-layer-group' },
        { title: '태그 관리', path: '/tags', icon: 'fa-tags' }
      ];
      function renderCmd() {
        if (!cmdResults || !cmdInput) return;
        var q = cmdInput.value.trim();
        var lower = q.toLowerCase();
        var html = '';
        if (q) {
          html += '<a href="/app?q=' + encodeURIComponent(q) + '" class="cmd-item"><i class="fa-solid fa-file-lines cmd-item-icon"></i><span>"' + escapeHtmlClient(q) + '" 문서 검색</span></a>';
        }
        routes.filter(function (route) { return !q || route.title.toLowerCase().includes(lower); }).forEach(function (route) {
          html += '<a href="' + route.path + '" class="cmd-item"><i class="fa-solid ' + route.icon + ' cmd-item-icon"></i><span>' + route.title + '</span></a>';
        });
        cmdResults.innerHTML = html;
      }
      document.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          if (cmd && cmd.showModal) {
            cmd.showModal();
            renderCmd();
            setTimeout(function () { if (cmdInput) cmdInput.focus(); }, 0);
          }
        } else if (event.key === 'Escape' && cmd && cmd.open) {
          cmd.close();
        }
      });
      if (cmdInput) cmdInput.addEventListener('input', renderCmd);

      function escapeHtmlClient(value) {
        return String(value || '').replace(/[&<>"']/g, function (char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char];
        });
      }
    });
  `;
}

function styles() {
  return `
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --surface: #ffffff;
      --surface-strong: #eef2f6;
      --ink: #172033;
      --muted: #657187;
      --line: #d8dee8;
      --primary: #176b87;
      --primary-strong: #0f5068;
      --success: #16825d;
      --warning: #b7791f;
      --danger: #c2413b;
      --radius: 8px;
      --shadow: 0 14px 34px rgba(23, 32, 51, .08);
    }
    * { box-sizing: border-box; }
    html, body { overflow-x: hidden; }
    body { margin: 0; font-family: "Pretendard Variable", Pretendard, system-ui, sans-serif; background: var(--bg); color: var(--ink); line-height: 1.5; }
    a { color: inherit; }
    .skip-nav { position: absolute; left: -999px; top: 1rem; z-index: 1000; padding: .7rem 1rem; background: var(--ink); color: #fff; border-radius: var(--radius); }
    .skip-nav:focus { left: 1rem; }
    .topbar { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 1rem; padding: .8rem clamp(1rem, 3vw, 2rem); background: rgba(255,255,255,.92); border-bottom: 1px solid var(--line); backdrop-filter: blur(12px); }
    .brand { display: inline-flex; align-items: center; gap: .7rem; text-decoration: none; min-width: max-content; }
    .brand-mark { display: grid; place-items: center; width: 2.4rem; height: 2.4rem; border-radius: 8px; background: var(--primary); color: #fff; }
    .brand strong, .brand small { display: block; }
    .brand small { color: var(--muted); font-size: .78rem; }
    .topbar nav { display: flex; align-items: center; gap: .25rem; flex: 1; }
    .archive-nav-item, .nav-sub-link, .logout-link { display: inline-flex; align-items: center; gap: .45rem; padding: .62rem .75rem; border-radius: 6px; text-decoration: none; color: var(--muted); font-weight: 700; }
    .archive-nav-item:hover, .nav-sub-link:hover, .logout-link:hover { background: var(--surface-strong); color: var(--ink); }
    .nav-user { margin-left: auto; display: flex; align-items: center; gap: .3rem; }
    .session-pill { padding: .45rem .65rem; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: .85rem; white-space: nowrap; }
    .hamburger, .drawer-close { display: none; }
    .app-shell { width: min(1440px, calc(100% - 2rem)); margin: 0 auto; padding: 1.25rem 0 3rem; }
    .login-main { min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
    .login-shell { width: min(980px, 100%); display: grid; grid-template-columns: 1fr 1fr; min-height: 560px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
    .login-side { display: flex; flex-direction: column; justify-content: flex-end; padding: 2.5rem; background: linear-gradient(145deg, #176b87, #2f8f7d); color: #fff; }
    .login-logo { width: 3.2rem; height: 3.2rem; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.4); border-radius: 8px; font-weight: 900; }
    .login-panel { padding: 2.5rem; align-self: center; }
    .eyebrow { margin: 0 0 .35rem; color: var(--primary); font-size: .78rem; font-weight: 900; letter-spacing: 0; }
    h1, h2, h3, p { overflow-wrap: anywhere; }
    h1 { margin: 0; font-size: 2.45rem; line-height: 1.08; }
    h2 { margin: 0; font-size: 1.35rem; }
    .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin: 1rem 0 1.25rem; }
    .breadcrumb { display: flex; gap: .4rem; color: var(--muted); font-size: .88rem; margin-bottom: .3rem; }
    .search-hero { display: grid; gap: 1.25rem; padding: clamp(1.25rem, 4vw, 2.5rem); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
    .hero-copy { max-width: 900px; }
    .hero-copy h1 { max-width: 18ch; }
    .hero-copy p:last-child { margin-bottom: 0; color: var(--muted); font-size: 1.05rem; }
    .viewer-hero { display: grid; gap: 1rem; padding: 1.5rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
    .viewer-hero-copy { max-width: 920px; }
    .viewer-hero-copy h1 { max-width: 20ch; }
    .viewer-hero-copy p:last-child { margin: .65rem 0 0; color: var(--muted); font-size: 1.05rem; }
    .viewer-search-form { display: grid; gap: .75rem; }
    .viewer-search-form .search-box { border-color: rgba(23,107,135,.34); box-shadow: 0 8px 22px rgba(23,107,135,.08); }
    .viewer-search-form .search-box input { min-height: 3rem; border: 0; padding-left: .2rem; font-size: 1.02rem; }
    .viewer-filter-row { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)) auto; gap: .7rem; align-items: end; }
    .quick-filter-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; color: var(--muted); font-weight: 800; }
    .chip.active { border-color: var(--primary); color: var(--primary); background: #e9f5f8; }
    .viewer-recents:empty { display: none; }
    .global-search, .filter-bar { display: grid; gap: .85rem; }
    .search-box { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .75rem; padding: .65rem; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
    .global-search.large .search-box { padding: .85rem; box-shadow: inset 0 0 0 1px rgba(23,107,135,.08); }
    .search-box i { color: var(--muted); margin-left: .35rem; }
    input, select, textarea { width: 100%; min-height: 2.65rem; padding: .65rem .8rem; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink); font: inherit; }
    textarea { resize: vertical; }
    input:focus, select:focus, textarea:focus { outline: 3px solid rgba(23,107,135,.18); border-color: var(--primary); }
    button, .button { display: inline-flex; align-items: center; justify-content: center; gap: .4rem; min-height: 2.55rem; padding: .62rem .9rem; border: 1px solid var(--primary); border-radius: 6px; background: var(--primary); color: #fff; font: inherit; font-weight: 800; text-decoration: none; cursor: pointer; white-space: nowrap; }
    .button.secondary, button.secondary, .secondary { background: var(--surface); color: var(--primary); }
    .danger-button { border-color: var(--danger); background: var(--danger); color: #fff; }
    .sm { min-height: 2.15rem; padding: .45rem .7rem; font-size: .88rem; }
    .disabled { pointer-events: none; opacity: .45; }
    .panel, .metric-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
    .panel { padding: 1.25rem; margin-bottom: 1rem; }
    .narrow { max-width: 760px; margin-inline: auto; }
    .content-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(300px, .8fr); gap: 1rem; align-items: start; margin-top: 1rem; }
    .viewer-workspace { display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(380px, .82fr); gap: 1rem; align-items: start; margin-top: 1rem; }
    .viewer-location-panel { position: sticky; top: 1rem; }
    .viewer-secondary { grid-template-columns: minmax(0, 1fr) minmax(300px, .7fr); }
    .two-col, .admin-grid, .metric-strip, .rack-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .metric-strip { margin: 1rem 0; }
    .metric-card { padding: 1rem; display: grid; gap: .25rem; }
    .metric-card span, .metric-card small { color: var(--muted); }
    .metric-card strong { font-size: 1.65rem; }
    .quality-strip { display: flex; flex-wrap: wrap; gap: .6rem; margin: 1rem 0; }
    .quality-strip span, .chip, .count-badge { display: inline-flex; align-items: center; gap: .35rem; padding: .38rem .65rem; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--muted); font-size: .88rem; text-decoration: none; }
    .quality-strip .warn { border-color: rgba(183,121,31,.45); color: var(--warning); background: #fff8eb; }
    .quick-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; min-height: 1.8rem; }
    .section-title { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
    .filter-row { display: grid; grid-template-columns: repeat(5, minmax(140px, 1fr)); gap: .75rem; }
    label { display: grid; gap: .35rem; font-weight: 800; }
    em { color: var(--danger); font-style: normal; }
    .stack { display: grid; gap: 1rem; }
    .button-group { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
    .result-list { display: grid; gap: .85rem; }
    .viewer-result-list { display: grid; gap: .85rem; }
    .viewer-result-card { display: grid; grid-template-columns: minmax(250px, .5fr) minmax(0, 1fr) auto; gap: 1rem; align-items: stretch; padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
    .viewer-result-card.is-disposed { opacity: .72; }
    .viewer-location-main { display: grid; align-content: space-between; gap: .75rem; padding: .95rem; border-radius: 6px; background: #e8f7f0; border: 1px solid rgba(22,130,93,.28); }
    .viewer-location-main small { color: var(--success); font-weight: 900; }
    .viewer-location-main strong { font-size: 1.12rem; line-height: 1.35; }
    .viewer-location-actions { display: flex; flex-wrap: wrap; gap: .45rem; }
    .viewer-doc-main { min-width: 0; }
    .result-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, .36fr); gap: 1rem; padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; position: relative; }
    .result-card.is-disposed { opacity: .72; }
    .result-check { position: absolute; top: 1rem; right: 1rem; width: auto; }
    .result-title { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; margin-bottom: .7rem; }
    .result-title a { font-size: 1.08rem; font-weight: 900; text-decoration: none; }
    .result-title a:hover { color: var(--primary); }
    .result-meta { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: .65rem; margin: 0; }
    .result-meta div, .detail-item { display: grid; gap: .2rem; padding: .65rem; background: var(--surface-strong); border-radius: 6px; }
    dt, .detail-item small { color: var(--muted); font-size: .78rem; font-weight: 900; }
    dd { margin: 0; font-weight: 800; }
    .note-line, .match-reason, .muted { color: var(--muted); }
    .tag-row { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .7rem; }
    .tag-row span { padding: .25rem .5rem; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: .82rem; background: var(--surface); }
    .location-card { display: grid; align-content: start; gap: .6rem; padding: .85rem; border-radius: 6px; background: #eef8f6; border: 1px solid rgba(22,130,93,.22); }
    .location-card small { color: var(--success); font-weight: 900; }
    .location-card strong { font-size: 1rem; }
    .status { display: inline-flex; align-items: center; width: max-content; padding: .25rem .55rem; border-radius: 999px; font-size: .78rem; font-weight: 900; }
    .status.active { background: #e8f7f0; color: var(--success); }
    .status.disposed { background: #fdecea; color: var(--danger); }
    .status.pending { background: #fff7dd; color: var(--warning); }
    .category-index { display: grid; gap: .55rem; }
    .category-node { border: 1px solid var(--line); border-radius: 6px; padding: .75rem; background: #fff; }
    .category-node summary { display: flex; justify-content: space-between; gap: 1rem; cursor: pointer; font-weight: 900; }
    .category-node p { color: var(--muted); margin: .55rem 0; }
    .category-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .category-actions a { color: var(--primary); font-weight: 800; }
    .hint-box { margin-top: 1rem; padding: .9rem; background: var(--surface-strong); border-radius: 6px; color: var(--muted); }
    .archive-stage { overflow-x: auto; }
    .archive-map { display: grid; gap: 1rem; min-width: 760px; }
    .rack-zone { border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem; background: var(--surface-strong); }
    .rack-zone h3 { margin: 0 0 .8rem; }
    .rack-zone-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: .65rem; }
    .rack-tile { min-height: 82px; display: grid; place-items: center; gap: .12rem; padding: .65rem; border: 1px solid var(--line); border-radius: 6px; background: #fff; text-decoration: none; text-align: center; }
    .rack-tile.is-hit { border-color: var(--success); background: #e8f7f0; box-shadow: 0 0 0 3px rgba(22,130,93,.15); }
    .legend { display: flex; flex-wrap: wrap; gap: .75rem; color: var(--muted); font-size: .88rem; }
    .legend-box { display: inline-block; width: .75rem; height: .75rem; border-radius: 2px; background: #fff; border: 1px solid var(--line); margin-right: .3rem; }
    .legend-box.hit { background: var(--success); }
    .floor-plan-shell { display: grid; gap: .8rem; }
    .floor-plan-media { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius); background: #f1f4f7; aspect-ratio: 1.45; }
    .floor-plan-media img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(.92) contrast(.98); }
    .floor-region { position: absolute; top: var(--top); left: var(--left); width: var(--width); height: var(--height); border: 2px solid rgba(23,107,135,.54); border-radius: 6px; background: rgba(23,107,135,.08); }
    .floor-region-label { position: absolute; top: .35rem; left: .35rem; padding: .22rem .45rem; border-radius: 999px; background: rgba(255,255,255,.9); color: var(--primary); font-size: .78rem; font-weight: 900; }
    .floor-rack { position: absolute; left: var(--rack-left); top: var(--rack-top); transform: translate(-50%, -50%); width: 1.65rem; height: 1.65rem; display: grid; place-items: center; border-radius: 5px; background: #fff; border: 1px solid rgba(23,32,51,.28); color: var(--ink); text-decoration: none; font-size: .72rem; font-weight: 900; box-shadow: 0 4px 10px rgba(23,32,51,.14); }
    .floor-rack.is-hit { background: var(--success); color: #fff; border-color: var(--success); box-shadow: 0 0 0 4px rgba(22,130,93,.22); }
    .floor-plan-summary, .zone-list { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; color: var(--muted); font-size: .88rem; }
    .floor-plan-summary span, .zone-list a { display: inline-flex; align-items: center; gap: .35rem; padding: .35rem .55rem; border: 1px solid var(--line); border-radius: 999px; background: #fff; text-decoration: none; }
    .zone-list a:hover { color: var(--primary); border-color: var(--primary); }
    .admin-link-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; }
    .admin-link-grid a { min-height: 4.2rem; display: flex; align-items: center; gap: .65rem; padding: .8rem; border: 1px solid var(--line); border-radius: 6px; background: #fff; text-decoration: none; font-weight: 900; }
    .admin-link-grid a:hover { color: var(--primary); border-color: var(--primary); }
    .locator-hero { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: 1.2rem; margin-bottom: 1rem; border-radius: var(--radius); background: #e8f7f0; border: 1px solid rgba(22,130,93,.25); }
    .locator-hero strong { display: block; font-size: 1.35rem; }
    .locator-hero span { color: var(--muted); }
    .tab-nav { display: flex; gap: .5rem; overflow-x: auto; margin-bottom: 1rem; }
    .tab-nav button { background: var(--surface); color: var(--muted); border-color: var(--line); }
    .tab-nav button[aria-selected="true"] { background: var(--primary); color: #fff; border-color: var(--primary); }
    .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .75rem; }
    .mini-rack-grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(48px, 1fr)); gap: .45rem; }
    .mini-slot { min-height: 48px; border: 1px solid var(--line); border-radius: 6px; display: grid; place-items: center; background: var(--surface-strong); position: relative; }
    .mini-slot.active { border-color: var(--success); background: #e8f7f0; color: var(--success); font-weight: 900; }
    .mini-slot i { position: absolute; top: .25rem; right: .35rem; }
    .timeline-container { display: grid; gap: .8rem; }
    .timeline-item { display: grid; grid-template-columns: 16px 1fr; gap: .7rem; }
    .timeline-badge { width: 12px; height: 12px; margin-top: .45rem; border-radius: 50%; background: var(--primary); }
    .timeline-content { border: 1px solid var(--line); border-radius: 6px; padding: .85rem; background: #fff; }
    .timeline-header { display: flex; justify-content: space-between; gap: .75rem; color: var(--muted); }
    .alert { padding: .85rem 1rem; border-radius: 6px; margin-bottom: 1rem; border: 1px solid var(--line); }
    .alert.danger { background: #fdecea; border-color: rgba(194,65,59,.3); color: var(--danger); }
    .alert.warning { background: #fff7dd; border-color: rgba(183,121,31,.35); color: var(--warning); }
    .alert.success { background: #e8f7f0; border-color: rgba(22,130,93,.3); color: var(--success); }
    .empty-state { display: grid; place-items: center; gap: .8rem; padding: 2rem; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: var(--radius); background: #fff; }
    .empty-state i { font-size: 2rem; color: var(--primary); }
    .empty-actions { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: center; }
    .bulk-bar { position: sticky; bottom: 1rem; z-index: 20; display: flex; align-items: center; gap: .75rem; padding: .8rem; margin-top: 1rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
    .bulk-bar[hidden] { display: none; }
    .bulk-bar form { display: flex; flex: 1; gap: .5rem; }
    .bulk-reason { flex: 1; }
    .pagination { display: flex; justify-content: center; align-items: center; gap: .75rem; margin-top: 1rem; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: .75rem; border-bottom: 1px solid var(--line); text-align: left; }
    th { color: var(--muted); font-size: .82rem; }
    .check-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .5rem; border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem; }
    .check-item, .check-inline { display: inline-flex; align-items: center; gap: .45rem; width: max-content; }
    .check-item input, .check-inline input, .result-check input { width: auto; min-height: auto; }
    .master-list { display: grid; gap: .7rem; }
    .master-row, .master-form { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) auto auto; gap: .5rem; align-items: center; }
    .admin-tile { display: grid; gap: .3rem; text-decoration: none; }
    .admin-tile small { color: var(--muted); }
    .admin-tile strong { font-size: 1.08rem; }
    .modal { border: 0; border-radius: var(--radius); padding: 0; width: min(520px, calc(100% - 2rem)); }
    .modal::backdrop { background: rgba(23,32,51,.45); }
    .modal-body { padding: 1.25rem; display: grid; gap: 1rem; }
    .modal-actions { display: flex; justify-content: flex-end; gap: .5rem; }
    .danger-text { color: var(--danger); }
    .cmd-palette { border: 0; border-radius: var(--radius); width: min(620px, calc(100% - 2rem)); padding: 0; box-shadow: var(--shadow); }
    .cmd-palette::backdrop { background: rgba(23,32,51,.45); }
    .cmd-search-wrap { display: flex; align-items: center; gap: .7rem; padding: .9rem; border-bottom: 1px solid var(--line); }
    .cmd-search-wrap input { border: 0; outline: 0; }
    .cmd-results { padding: .6rem; display: grid; gap: .25rem; }
    .cmd-item { display: flex; align-items: center; gap: .65rem; padding: .75rem; border-radius: 6px; text-decoration: none; }
    .cmd-item:hover { background: var(--surface-strong); color: var(--primary); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media (min-width: 1100px) {
      .topbar { position: fixed; inset: 0 auto 0 0; width: 276px; flex-direction: column; align-items: stretch; padding: 1.1rem; border-right: 1px solid var(--line); border-bottom: 0; }
      .topbar nav { flex-direction: column; align-items: stretch; gap: .25rem; }
      .brand { padding-bottom: .8rem; border-bottom: 1px solid var(--line); }
      .archive-nav-item, .nav-sub-link, .logout-link { justify-content: flex-start; }
      .nav-user { margin: auto 0 0; flex-direction: column; align-items: stretch; }
      .session-pill { border-radius: 6px; white-space: normal; }
      .topbar + .app-shell { width: min(1320px, calc(100% - 308px - 2rem)); max-width: none; margin-left: calc(276px + 1rem); margin-right: 1rem; padding-top: 1.25rem; }
      .hamburger, .drawer-close, .nav-scrim { display: none; }
    }
    @media (max-width: 1180px) {
      .viewer-workspace { grid-template-columns: 1fr; }
      .viewer-location-panel { position: static; }
      .viewer-filter-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .viewer-result-card { grid-template-columns: minmax(220px, .55fr) minmax(0, 1fr); }
      .viewer-result-card > .button { grid-column: 1 / -1; }
    }
    @media (max-width: 1020px) {
      .content-grid { grid-template-columns: 1fr; }
      .filter-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .result-card { grid-template-columns: 1fr; }
      .result-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .set-doc-table td strong { white-space: nowrap; }
    .set-doc-table tr.is-disposed td { opacity: .62; }
    .set-add-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; }
    .set-candidate-list { display: grid; gap: .5rem; }
    .set-candidate { display: flex; justify-content: space-between; align-items: center; gap: 1rem; border: 1px solid var(--line); border-radius: .6rem; padding: .6rem .8rem; }
    .set-candidate small { display: block; color: inherit; opacity: .72; }
    .set-candidate.is-disposed { opacity: .62; }
    .set-danger-row { margin-top: 1.25rem; display: flex; justify-content: flex-end; }
    @media print {
      .topbar, .cmd-palette, .skip-nav, .nav-scrim, .button, button, form, .set-admin-tools, .archive-map { display: none !important; }
      body { background: #fff; }
      .app-shell { width: 100%; padding: 0; }
      .panel { box-shadow: none; border: 1px solid #d7dbe4; }
    }
    @media (max-width: 760px) {
      .app-shell { width: min(100% - 1rem, 1440px); padding-top: .75rem; }
      .login-shell { grid-template-columns: 1fr; }
      .login-side { display: none; }
      h1 { font-size: 1.9rem; }
      .page-head, .locator-hero, .section-title { flex-direction: column; align-items: stretch; }
      .search-box { grid-template-columns: auto minmax(0, 1fr); }
      .search-box button { grid-column: 1 / -1; width: 100%; }
      .filter-row, .viewer-filter-row, .result-meta, .master-row, .master-form, .viewer-result-card, .admin-link-grid, .set-add-grid { grid-template-columns: 1fr; }
      .viewer-hero { padding: 1rem; }
      .viewer-search-form .search-box input { min-height: 2.7rem; font-size: 1rem; }
      .floor-plan-media { aspect-ratio: 1.1; }
      .floor-rack { width: 1.35rem; height: 1.35rem; font-size: .65rem; }
      .topbar { justify-content: space-between; }
      .hamburger { display: inline-flex; flex-direction: column; gap: 4px; width: 2.4rem; min-height: 2.4rem; background: var(--surface); color: var(--ink); border-color: var(--line); }
      .hamburger span { display: block; width: 1.1rem; height: 2px; background: currentColor; }
      .drawer-close { display: inline-flex; align-self: flex-end; width: 2.2rem; min-height: 2.2rem; background: var(--surface); color: var(--ink); border-color: var(--line); }
      .topbar nav { position: fixed; inset: 0 0 0 auto; width: min(340px, 86vw); background: var(--surface); padding: 1rem; flex-direction: column; align-items: stretch; transform: translateX(100%); transition: transform .2s ease; box-shadow: var(--shadow); }
      .topbar nav.is-open { transform: translateX(0); }
      .nav-user { margin: auto 0 0; flex-direction: column; align-items: stretch; }
      .nav-scrim.is-open { position: fixed; inset: 0; background: rgba(23,32,51,.38); }
      .bulk-bar, .bulk-bar form { flex-direction: column; align-items: stretch; }
    }
  `;
}
