// 로그인 후 업무 화면의 셸과 화면별 위계. 앱인토스 UI/UX 가이드(장식 없는 표면, 주요 행동 하나,
// 상황에 맞는 색·그래픽)와 TDS의 Top·ListRow 구성을 기존 컴포넌트 위에 적용한다.
// 노랑(--action)은 "문서가 있는 곳" 강조에만 쓰고 주요 행동은 브랜드 파랑 채움 버튼 하나로 통일한다.

export function appStyles() {
  return `    /* 셸: 밝은 사이드바와 상단 바 */
    :where(.app-body) .topbar { background: var(--surface); color: var(--gray-900); }
    :where(.app-body) .topbar .brand strong { color: var(--gray-900); font-size: var(--text-lead); }
    :where(.app-body) .topbar .brand-logo { filter: none; }
    :where(.app-body) .topbar :is(.archive-nav-item, .nav-sub-link, .logout-link) { gap: var(--sp-3); min-height: 36px; padding: 0 var(--sp-3); border-radius: var(--r-md); color: var(--gray-700); font-size: 14.5px; font-weight: 600; }
    :where(.app-body) .topbar :is(.archive-nav-item, .nav-sub-link, .logout-link) i { width: 18px; color: var(--gray-500); font-size: 17px; opacity: 1; }
    :where(.app-body) .topbar :is(.archive-nav-item, .nav-sub-link, .logout-link):hover { background: var(--gray-100); color: var(--gray-900); }
    :where(.app-body) .topbar .archive-nav-item.active { background: var(--primary-soft); color: var(--primary); }
    :where(.app-body) .topbar .archive-nav-item.active::before { content: none; }
    :where(.app-body) .topbar .archive-nav-item.active i { color: var(--primary); }
    :where(.app-body) .topbar .nav-group-label { min-height: 32px; margin-top: var(--sp-2); padding: 0 var(--sp-3); border-radius: var(--r-md); color: var(--gray-500); font-size: var(--text-meta); font-weight: 700; }
    :where(.app-body) .topbar .nav-group-label::after { content: ""; width: 16px; height: 16px; margin-left: auto; background: currentColor; -webkit-mask: var(--icon-chevron-down) center/contain no-repeat; mask: var(--icon-chevron-down) center/contain no-repeat; transition: transform .15s ease; }
    :where(.app-body) .topbar .nav-group[open] > .nav-group-label::after { content: ""; transform: rotate(180deg); }
    :where(.app-body) .topbar .nav-group-label:hover { background: var(--gray-50); color: var(--gray-700); }
    :where(.app-body) .topbar .nav-group.has-active > .nav-group-label { background: transparent; color: var(--gray-700); box-shadow: none; }
    :where(.app-body) .topbar .nav-sub-link { font-size: 14px; }
    :where(.app-body) .topbar .nav-user { gap: var(--sp-1); border-top-color: var(--gray-100); }
    /* 도움말·비밀번호·로그아웃은 한 줄 세 칸으로 둬 긴 운영 메뉴가 있어도 사이드바 한 화면에 들어오게 한다. */
    :where(.app-body) .topbar .nav-user-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-1); }
    :where(.app-body) .topbar .nav-user-links .logout-form { display: block; }
    :where(.app-body) .topbar .nav-user-links :is(.nav-sub-link, .logout-link) { flex-direction: column; justify-content: center; gap: 2px; width: 100%; min-height: 52px; padding: var(--sp-1); font-size: var(--text-caption); text-align: center; }
    :where(.app-body) .topbar .nav-user-links :is(.nav-sub-link, .logout-link) i { width: 18px; height: 18px; font-size: 18px; }
    :where(.app-body) .topbar .session-pill { display: grid; gap: 2px; padding: var(--sp-3); border-radius: var(--r-md); background: var(--gray-50); color: var(--gray-800); line-height: 1.4; text-align: left; white-space: normal; }
    :where(.app-body) .topbar .session-pill strong { color: var(--gray-900); font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
    :where(.app-body) .topbar .session-pill small { color: var(--gray-500); font-size: var(--text-caption); font-weight: 500; }
    :where(.app-body) .command-trigger { min-height: 40px; padding: 0 var(--sp-3); border: 1px solid var(--gray-200); border-radius: var(--r-md); background: var(--gray-50); color: var(--gray-500); font-size: 14px; font-weight: 500; }
    :where(.app-body) .command-trigger:hover { border-color: var(--gray-300); background: var(--surface); color: var(--gray-800); }
    :where(.app-body) .command-trigger kbd { margin-left: auto; padding: 0 var(--sp-1); border-color: var(--gray-200); background: var(--surface); color: var(--gray-500); font-size: 11px; line-height: 18px; }
    :where(.app-body) .demo-readonly-banner { gap: var(--sp-2); border-bottom-color: var(--line); background: var(--gray-50); color: var(--gray-700); font-size: var(--text-meta); }
    :where(.app-body) .demo-readonly-banner i { color: var(--primary); }
    @media (min-width: 1100px) {
      :where(.app-body) .topbar { gap: var(--sp-2); padding: var(--sp-5) var(--sp-3) var(--sp-4); border-right-color: var(--line); }
      :where(.app-body) .topbar .brand { gap: var(--sp-3); padding: 0 var(--sp-2) var(--sp-4); margin-bottom: var(--sp-1); border-bottom-color: var(--gray-100); }
      :where(.app-body) .command-trigger { width: 100%; justify-content: flex-start; }
      :where(.app-body) .topbar ~ .app-shell { padding-top: var(--sp-8); }
    }
    @media (max-width: 1099px) {
      :where(.app-body) .topbar { min-height: 56px; padding: var(--sp-2) var(--sp-4); border-bottom-color: var(--line); background: var(--surface); }
      :where(.app-body) .topbar nav { padding-top: var(--sp-5); }
      :where(.app-body) .topbar :is(.archive-nav-item, .nav-sub-link, .logout-link) { min-height: 48px; font-size: var(--text-body); }
      :where(.app-body) .drawer-close { border-color: transparent; background: var(--gray-100); color: var(--gray-700); font-size: 20px; }
      :where(.app-body) .mobile-tabs { border-top-color: var(--line); background: var(--surface); }
      :where(.app-body) .mobile-tab { gap: 2px; color: var(--gray-500); font-size: 11.5px; font-weight: 600; }
      :where(.app-body) .mobile-tab i { font-size: 20px; }
      :where(.app-body) .mobile-tab.active { background: transparent; color: var(--primary); }
      :where(.app-body) .mobile-tab:hover { background: transparent; color: var(--gray-900); }
    }

    /* 화면 제목(Top): 제목 → 설명 → 행동 */
    :where(.app-body) .page-head:has(> :is(.breadcrumb, p)) { flex-direction: column; align-items: flex-start; gap: var(--sp-2); }
    :where(.app-body) .page-head:has(> :is(.breadcrumb, p)) > :is(h1, p, .breadcrumb) { margin: 0; }
    :where(.app-body) .page-head { align-items: flex-end; gap: var(--sp-4) var(--sp-6); margin: 0 0 var(--sp-6); padding: 0; }
    :where(.app-body) .page-head p { margin: var(--sp-2) 0 0; max-width: 720px; color: var(--gray-600); font-size: var(--text-body); font-weight: 400; line-height: 1.6; }
    :where(.app-body) .page-head :is(.button.secondary, button.secondary) { background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); }
    :where(.app-body) .page-head :is(.button.secondary, button.secondary):hover { background: var(--gray-50); }
    :where(.app-body) .breadcrumb { align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); color: var(--gray-500); font-size: var(--text-meta); font-weight: 500; }
    :where(.app-body) .breadcrumb a { color: var(--gray-600); text-decoration: none; }
    :where(.app-body) .breadcrumb a:hover { color: var(--primary); }
    /* 제목 줄 높이를 버튼 높이와 같게 두어 행동 버튼 유무와 관계없이 모든 화면의 제목 위치를 같게 한다. */
    :where(.app-body) .page-head h1 { display: flex; align-items: center; min-height: var(--control-height); margin: 0; }
    :where(.app-body) .page-head-copy { display: grid; gap: var(--sp-1); min-width: 0; }
    :where(.app-body) .page-head-copy .page-sub { margin: 0; }
    :where(.app-body) .page-back { margin: 0; }
    :where(.app-body) .page-back a { display: inline-flex; align-items: center; gap: var(--sp-1); color: var(--gray-600); font-weight: 600; text-decoration: none; }
    :where(.app-body) .page-back a::before { content: ""; width: 16px; height: 16px; background: currentColor; -webkit-mask: var(--icon-arrow-left) center/contain no-repeat; mask: var(--icon-arrow-left) center/contain no-repeat; }
    :where(.app-body) .page-back a:hover { color: var(--primary); }

    /* 행동 위계: 주요 행동은 파랑 채움 하나, 노랑은 위치 강조 전용 */
    :where(.app-body) :is(.action-button, button.action-button, .button.action-button) { background: var(--primary); border-color: var(--primary); color: var(--surface); }
    :where(.app-body) :is(.action-button, button.action-button, .button.action-button):hover { background: var(--primary-strong); border-color: var(--primary-strong); color: var(--surface); }
    :where(.app-body) .text-button { min-height: 0; padding: 0; border: 0; background: transparent; color: var(--primary); font-size: 14px; font-weight: 600; text-decoration: none; }
    :where(.app-body) .text-button:hover { background: transparent; color: var(--primary-strong); text-decoration: underline; }

    /* 알림: 상황에 맞는 색만 쓴다(오류가 아니면 경고색을 쓰지 않는다) */
    :where(.app-body) .alert { position: relative; margin-bottom: var(--sp-3); padding: var(--sp-3) var(--sp-4) var(--sp-3) calc(var(--sp-4) + 28px); border-radius: var(--r-md); background: var(--gray-50); color: var(--gray-700); font-size: 14px; font-weight: 500; line-height: 1.6; }
    :where(.app-body) .alert::before { content: ""; position: absolute; top: calc(var(--sp-3) + 2px); left: var(--sp-4); width: 20px; height: 20px; background: currentColor; -webkit-mask: var(--icon-info) center/contain no-repeat; mask: var(--icon-info) center/contain no-repeat; }
    :where(.app-body) :is(.alert.warning, .alert.danger)::before { -webkit-mask-image: var(--icon-alert); mask-image: var(--icon-alert); }
    :where(.app-body) .alert.success::before { -webkit-mask-image: var(--icon-check); mask-image: var(--icon-check); }
    :where(.app-body) .alert.neutral { background: var(--gray-50); color: var(--gray-700); }
    :where(.app-body) .alert.success { background: var(--success-soft); color: var(--success); }
    :where(.app-body) .alert.info { background: var(--primary-soft); color: var(--primary-strong); }
    :where(.app-body) .alert.warning { background: var(--warning-soft); color: var(--warning); }
    :where(.app-body) .alert.danger { background: var(--danger-soft); color: var(--danger); }

    /* 검색 */
    /* 제목과 검색창을 한 줄에, 필터를 그 아래 한 줄에 두어 첫 결과가 위로 올라오게 한다. */
    :where(.app-body) .search-workspace-head { grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--sp-3) var(--sp-6); padding: 0; margin-bottom: var(--sp-3); }
    :where(.app-body) .search-box { min-height: 52px; padding: var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-4); border: 1px solid var(--gray-300); border-radius: var(--r-lg); background: var(--surface); }
    :where(.app-body) .search-box:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
    :where(.app-body) .search-box > i { color: var(--gray-500); font-size: 18px; }
    :where(.app-body) .search-box input { min-height: 44px; font-size: var(--text-lead); }
    :where(.app-body) .search-box button { min-height: 44px; padding: 0 var(--sp-5); border-radius: var(--r-md); }
    :where(.app-body) .search-results-controls { display: grid; gap: var(--sp-2); margin: 0 0 var(--sp-4); padding: 0; background: transparent; }
    :where(.app-body) .viewer-filter-row { gap: var(--sp-3); align-items: end; }
    :where(.app-body) .viewer-filter-row label { display: grid; gap: var(--sp-1); color: var(--gray-600); font-size: var(--text-meta); }
    :where(.app-body) .viewer-filter-row label > select { margin: 0; }
    :where(.app-body) .search-results-controls .viewer-filter-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-5); }
    :where(.app-body) .search-results-controls .viewer-filter-row label { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--gray-600); font-weight: 600; white-space: nowrap; }
    :where(.app-body) .search-results-controls .viewer-filter-row select { width: auto; min-width: 132px; background-color: var(--surface); }
    :where(.app-body) .search-results-controls [data-viewer-filter-reset] { background: transparent; color: var(--gray-600); }
    :where(.app-body) .search-results-controls [data-viewer-filter-reset]:hover { background: var(--gray-100); color: var(--gray-900); }
    :where(.app-body) .viewer-workspace .results-panel { padding: var(--sp-4) var(--sp-6) var(--sp-4); }
    :where(.app-body) .viewer-results-heading { margin-bottom: var(--sp-1); }
    :where(.app-body) .viewer-results-title { display: flex; align-items: baseline; gap: var(--sp-2); min-width: 0; }
    :where(.app-body) .result-count { color: var(--gray-500); font-size: var(--text-body); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    :where(.app-body) .viewer-result-header th { padding-block: var(--sp-2); color: var(--gray-500); font-size: var(--text-meta); }
    @media (min-width: 761px) {
      :where(.app-body) .viewer-result-row td { padding-block: var(--sp-2); border-bottom-color: var(--gray-100); }
      :where(.app-body) .viewer-result-row { height: 64px; }
      :where(.app-body) .has-preview .viewer-result-header th:last-child { width: 104px; }
    }
    :where(.app-body) .viewer-result-row:hover { background: var(--gray-50); }
    :where(.app-body) .viewer-result-name a { color: var(--gray-900); font-size: var(--text-body); font-weight: 600; line-height: 1.45; }
    :where(.app-body) .viewer-result-identity { margin-top: var(--sp-1); color: var(--gray-600); font-size: 14px; }
    :where(.app-body) .viewer-result-location { color: var(--primary); font-size: var(--text-body); font-weight: 600; font-variant-numeric: tabular-nums; }
    :where(.app-body) .viewer-result-category { color: var(--gray-600); font-size: 14px; }
    :where(.app-body) .viewer-result-action .button { min-height: 34px; padding: 0 var(--sp-3); font-size: 14px; }
    :where(.app-body) .viewer-result-row.is-previewed { background: var(--primary-soft); box-shadow: inset 3px 0 var(--primary); }
    :where(.app-body) .comparison-setting, :where(.app-body) .column-settings summary { color: var(--gray-600); font-size: var(--text-meta); font-weight: 600; }
    :where(.app-body) .pagination { gap: var(--sp-3); margin-top: var(--sp-5); color: var(--gray-600); font-size: 14px; }
    :where(.app-body) .viewer-workspace .viewer-preview { border: 0; border-radius: var(--r-xl); padding: var(--sp-6); gap: var(--sp-4); }
    :where(.app-body) .viewer-workspace .viewer-preview.is-inline[open] { top: var(--sp-6); box-shadow: none; }
    :where(.app-body) .preview-document-name { color: var(--gray-900); font-size: var(--text-section); font-weight: 700; line-height: 1.45; }
    :where(.app-body) .preview-document-number { color: var(--gray-600); font-size: 14px; }
    :where(.app-body) .preview-location { gap: var(--sp-1); padding: var(--sp-4); border-radius: var(--r-md); background: var(--gray-50); }
    :where(.app-body) .preview-location small { color: var(--gray-600); font-size: var(--text-meta); font-weight: 600; }
    :where(.app-body) .preview-location strong { color: var(--gray-900); font-size: var(--text-section); font-weight: 700; }
    :where(.app-body) .preview-slot { min-height: 30px; border-color: var(--gray-100); background: var(--gray-50); color: var(--gray-500); }
    :where(.app-body) .preview-slot.is-active { border-color: var(--action-strong); background: var(--action); color: var(--action-ink); }
    :where(.app-body) .viewer-preview [data-preview-link] { min-height: var(--control-height-lg); }
    :where(.app-body) .didyoumean { border-radius: var(--r-md); }

    /* 문서 상세: 제목 영역 → 보관 위치 → 도면·랙 → 정보 */
    :where(.app-body) .document-detail-head { gap: var(--sp-5); padding: var(--sp-6) var(--sp-8); margin-bottom: var(--sp-4); border: 0; border-radius: var(--r-lg); background: var(--surface); color: var(--gray-900); }
    :where(.app-body) .document-detail-head .breadcrumb { margin: 0; color: var(--gray-500); }
    :where(.app-body) .document-detail-head .breadcrumb a { display: inline-flex; align-items: center; gap: var(--sp-1); color: var(--gray-600); font-weight: 600; }
    :where(.app-body) .document-detail-head .breadcrumb a::before { content: ""; width: 16px; height: 16px; background: currentColor; -webkit-mask: var(--icon-arrow-left) center/contain no-repeat; mask: var(--icon-arrow-left) center/contain no-repeat; }
    :where(.app-body) .document-detail-head .document-title-row h1 { color: var(--gray-900); font-size: 26px; line-height: 1.35; }
    :where(.app-body) .document-detail-head .document-title-row p { margin-top: var(--sp-2); color: var(--gray-600); font-size: var(--text-body); }
    :where(.app-body) .document-detail-head .document-title-row p .mono { color: var(--gray-800); font-weight: 600; }
    :where(.app-body) .document-detail-head .detail-actions { margin: 0; padding-top: var(--sp-5); border-top: 1px solid var(--gray-100); }
    :where(.app-body) .document-detail-head .detail-action-groups { align-items: center; margin: 0; padding: 0; border: 0; }
    :where(.app-body) .detail-action-groups > .detail-state-actions { padding: 0; border: 0; }
    :where(.app-body) .document-location-summary { gap: var(--sp-5); padding: var(--sp-6) var(--sp-8); border: 0; border-radius: var(--r-lg); background: var(--surface); }
    :where(.app-body) .location-hero-copy { gap: var(--sp-2); }
    :where(.app-body) .document-location-summary small { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--gray-600); font-size: 14px; font-weight: 600; }
    :where(.app-body) .document-location-summary small::before { content: ""; width: 10px; height: 10px; margin: 0 var(--sp-1) 0 2px; border-radius: 999px; background: var(--action); box-shadow: 0 0 0 4px var(--action-soft), 0 0 0 5px var(--action-strong); }
    :where(.app-body) .document-location-summary strong { color: var(--gray-900); font-family: inherit; font-size: 26px; font-weight: 700; line-height: 1.35; font-variant-numeric: tabular-nums; word-break: keep-all; }
    :where(.app-body) .location-hero-copy span { color: var(--gray-600); font-size: var(--text-body); font-weight: 500; }
    :where(.app-body) .historical-location .document-location-summary strong { color: var(--gray-700); }
    :where(.app-body) .document-location-visuals { gap: var(--sp-4); margin-top: var(--sp-4); }
    :where(.app-body) .doc-floor-plan .floor-plan-tools { color: var(--gray-600); font-size: 14px; }
    :where(.app-body) .doc-floor-plan-body .muted { font-size: 14px; }
    :where(.app-body) .minimap-card { border: 0; background: var(--surface); color: var(--gray-900); }
    :where(.app-body) .minimap-card .section-title h2 { color: var(--gray-900); }
    :where(.app-body) .minimap-card .count-badge { background: var(--action-soft); color: var(--action-ink); }
    :where(.app-body) .mini-column-guide { color: var(--gray-500); font-size: var(--text-meta); }
    :where(.app-body) .mini-axis-shelf { font-size: var(--text-meta); }
    :where(.app-body) .minimap-card .mini-slot { border-color: var(--gray-100); background: var(--gray-50); color: var(--gray-500); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
    :where(.app-body) .minimap-card .mini-slot.active { border-color: var(--action-strong); background: var(--action); color: var(--action-ink); box-shadow: 0 0 0 3px var(--action-soft); }
    :where(.app-body) .document-detail-sections { grid-template-columns: minmax(0, 1fr); gap: var(--sp-4); }
    :where(.app-body) .document-info dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); column-gap: var(--sp-8); }
    :where(.app-body) .document-info dl div:last-child { border-bottom: 0; }
    :where(.app-body) .detail-history-group h2 { margin-bottom: var(--sp-2); }
    :where(.app-body) .detail-history-group .detail-history { margin: 0; padding: var(--sp-2) 0; border-top: 1px solid var(--gray-100); }
    :where(.app-body) .detail-history-group .detail-history > summary { min-height: 40px; font-size: var(--text-body); font-weight: 600; }
    :where(.app-body) .detail-section h2 { margin-bottom: var(--sp-2); }
    :where(.app-body) .detail-section dl div { grid-template-columns: 128px minmax(0, 1fr); align-items: baseline; padding: var(--sp-3) 0; border-bottom-color: var(--gray-100); }
    :where(.app-body) .detail-section dl div:last-child { border-bottom: 0; }
    :where(.app-body) .detail-section dt { color: var(--gray-500); font-size: 14px; font-weight: 500; }
    :where(.app-body) .detail-section dd { color: var(--gray-900); font-size: var(--text-body); font-weight: 500; }
    :where(.app-body) :is(.detail-history, .detail-actions) > summary { min-height: 32px; }
    :where(.app-body) .detail-history > summary::after, :where(.app-body) .historical-location > summary::after { content: ""; width: 20px; height: 20px; margin-left: auto; background: var(--gray-400); -webkit-mask: var(--icon-chevron-down) center/contain no-repeat; mask: var(--icon-chevron-down) center/contain no-repeat; transition: transform .15s ease; }
    :where(.app-body) .detail-history[open] > summary::after, :where(.app-body) .historical-location[open] > summary::after { transform: rotate(180deg); }
    :where(.app-body) .detail-history > summary .count-badge { margin-left: var(--sp-2); }
    :where(.app-body) .historical-location > summary { display: flex; align-items: center; list-style: none; }
    :where(.app-body) .historical-location > summary::-webkit-details-marker { display: none; }
    :where(.app-body) .timeline-content { border-radius: var(--r-md); }
    :where(.app-body) .timeline-header strong { font-size: 14px; }
    :where(.app-body) .timeline-header span, :where(.app-body) .timeline-content p { font-size: var(--text-meta); }
    :where(.app-body) .revision-history li { border: 0; background: var(--gray-50); }
    :where(.app-body) .revision-history li.current { background: var(--primary-soft); }

    /* 입력 폼 */
    :where(.app-body) .duplicate-check-status:empty, :where(.app-body) .document-detail-alerts:empty { display: none; }
    :where(.app-body) .form-tags > legend { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    :where(.app-body) .tag-picker > .muted { margin: 0; font-size: var(--text-meta); }
    :where(.app-body) .locked-field { border: 0; background: var(--gray-50); }
    :where(.app-body) .document-form { gap: var(--sp-2); padding: var(--sp-6) var(--sp-8); }
    :where(.app-body) .form-section { gap: var(--sp-4); padding: var(--sp-5) 0 var(--sp-6); border-bottom-color: var(--gray-100); }
    :where(.app-body) .form-section > :is(legend, h2) { margin: 0; padding: 0; font-size: var(--text-section); }
    :where(.app-body) .form-grid { gap: var(--sp-4); }
    :where(.app-body) .field-group { gap: var(--sp-2); }
    :where(.app-body) .field-error { font-size: var(--text-meta); }
    :where(.app-body) .field-hint { margin: calc(-1 * var(--sp-2)) 0 0; font-size: var(--text-meta); }
    :where(.app-body) .form-error-summary { border: 0; border-radius: var(--r-md); }
    :where(.app-body) .check-grid { gap: var(--sp-3); padding: var(--sp-4); border-radius: var(--r-md); background: var(--gray-50); }
    :where(.app-body) :is(.check-item, .check-inline) { gap: var(--sp-2); min-height: 32px; color: var(--gray-800); font-size: 14.5px; font-weight: 500; }
    :where(.app-body) .location-selection-preview { gap: var(--sp-4); padding: var(--sp-4); border: 0; border-radius: var(--r-md); background: var(--gray-50); }
    :where(.app-body) .location-selection-preview span { color: var(--gray-500); font-size: var(--text-caption); }
    :where(.app-body) .location-selection-preview strong { font-size: var(--text-body); }
    :where(.app-body) .continuation-options { border: 0; border-radius: var(--r-md); }
    :where(.app-body) .continuation-options > strong { display: block; margin-bottom: var(--sp-2); color: var(--gray-900); font-size: var(--text-body); }
    :where(.app-body) .continuation-options > p.muted { margin: var(--sp-2) 0 0; font-size: 14px; }
    :where(.app-body) .form-review summary { display: flex; align-items: center; gap: var(--sp-2); }
    :where(.app-body) .form-review summary::after, :where(.app-body) .form-review[open] summary::after { content: ""; float: none; width: 20px; height: 20px; margin-left: auto; background: var(--gray-400); -webkit-mask: var(--icon-chevron-down) center/contain no-repeat; mask: var(--icon-chevron-down) center/contain no-repeat; transition: transform .15s ease; }
    :where(.app-body) .form-review[open] summary::after { transform: rotate(180deg); }
    :where(.app-body) .sticky-save-bar { gap: var(--sp-3); padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-5); border: 0; border-radius: var(--r-lg); box-shadow: var(--shadow-2); }
    :where(.app-body) .sticky-save-bar .button-group > * { min-height: 44px; }
    :where(.app-body) .form-completion { color: var(--gray-600); font-size: var(--text-meta); font-weight: 600; }
    :where(.app-body) .form-review { padding: var(--sp-6); }
    :where(.app-body) .form-review summary { font-size: var(--text-section); }
    :where(.app-body) .form-review dt { color: var(--gray-500); font-size: var(--text-meta); }
    :where(.app-body) .form-review dd { color: var(--gray-900); font-size: 14px; }

    /* 운영 관리: 상태 요약 → 확인할 항목 → 도구 목록(ListRow) */
    :where(.app-body) .icon-frame { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: var(--r-md); background: var(--gray-100); color: var(--gray-700); font-size: 20px; }
    :where(.app-body) .admin-status-panel, :where(.app-body) .admin-status-panel.is-attention { gap: var(--sp-6); padding: var(--sp-6) var(--sp-8); border: 0; background: var(--surface); }
    :where(.app-body) .admin-status-copy { gap: var(--sp-2); }
    :where(.app-body) .admin-status-copy h2 { font-size: 20px; }
    :where(.app-body) .admin-status-copy p { color: var(--gray-600); font-size: var(--text-body); }
    :where(.app-body) .admin-status-copy .action-button { margin-top: var(--sp-2); }
    :where(.app-body) .quality-strip { gap: var(--sp-2); margin-bottom: var(--sp-4); }
    :where(.app-body) .quality-strip .warn { gap: var(--sp-2); min-height: 36px; padding: 0 var(--sp-4); border-radius: 999px; font-size: 14px; }
    :where(.app-body) .quality-strip .warn:hover { background: var(--action-soft); }
    :where(.app-body) .search-index-health { gap: var(--sp-5); padding: var(--sp-5) var(--sp-8); }
    :where(.app-body) .search-index-health strong { color: var(--gray-900); font-size: var(--text-body); }
    :where(.app-body) .search-index-health span { color: var(--gray-600); font-size: 14px; }
    :where(.app-body) .search-index-health p { color: var(--gray-600); font-size: 14px; text-align: right; }
    :where(.app-body) :is(.search-index-health.warning, .search-index-health.review) { border-color: transparent; }
    :where(.app-body) .search-index-health.warning p { color: var(--warning); }
    :where(.app-body) .search-index-health.review p { color: var(--danger); }
    :where(.app-body) :is(.search-index-health.warning, .search-index-health.review) p::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: var(--sp-2); border-radius: 999px; background: currentColor; vertical-align: .1em; }
    :where(.app-body) .management-grid { gap: var(--sp-4); align-items: start; }
    :where(.app-body) .management-heading { padding: var(--sp-6) var(--sp-6) var(--sp-4); border-bottom-color: var(--gray-100); }
    :where(.app-body) .management-heading h2 { font-size: var(--text-section); }
    :where(.app-body) .management-heading p { font-size: 14px; }
    :where(.app-body) .management-links { padding: var(--sp-2) 0; }
    :where(.app-body) .management-links .admin-tile { grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--sp-4); min-height: 72px; padding: var(--sp-3) var(--sp-6); border-bottom: 0; }
    :where(.app-body) .management-links .admin-tile:hover { background: var(--gray-50); }
    :where(.app-body) .admin-tile::after { content: ""; width: 20px; height: 20px; background: var(--gray-400); -webkit-mask: var(--icon-chevron-right) center/contain no-repeat; mask: var(--icon-chevron-right) center/contain no-repeat; }
    :where(.app-body) .admin-tile > span:not(.icon-frame) { gap: 2px; }
    :where(.app-body) .admin-tile strong { color: var(--gray-900); font-size: var(--text-body); font-weight: 600; }
    :where(.app-body) .admin-tile small { color: var(--gray-500); font-size: var(--text-meta); font-weight: 500; }
    :where(.app-body) .manual-list strong { font-size: var(--text-body); }
    :where(.app-body) .manual-list span { color: var(--gray-600); font-size: 14px; }

    /* 빈 화면·확인 체크·지표 */
    :where(.app-body) .empty-state { gap: var(--sp-2); padding: var(--sp-5) var(--sp-4); border: 0; border-radius: var(--r-md); background: transparent; color: var(--gray-600); font-size: var(--text-body); }
    :where(.app-body) .empty-state i { color: var(--gray-400); font-size: 24px; }
    :where(.app-body) .empty-state p { margin: 0; }
    :where(.app-body) .empty-state .muted { font-size: 14px; }
    :where(.app-body) label.checkbox, :where(.app-body) .revision-confirm { display: flex; align-items: flex-start; gap: var(--sp-3); width: auto; padding: var(--sp-3) var(--sp-4); border: 0; border-radius: var(--r-md); background: var(--gray-50); color: var(--gray-800); font-size: 14px; font-weight: 500; line-height: 1.55; cursor: pointer; }
    :where(.app-body) label.checkbox input, :where(.app-body) .revision-confirm input { flex: none; width: 20px; height: 20px; min-height: 0; margin: 1px 0 0; padding: 0; }
    :where(.app-body) .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--sp-3); }
    :where(.app-body) .metric { display: grid; gap: var(--sp-1); padding: var(--sp-4); border-radius: var(--r-md); background: var(--gray-50); }
    :where(.app-body) .metric span { color: var(--gray-500); font-size: var(--text-meta); font-weight: 600; }
    :where(.app-body) .metric strong { color: var(--gray-900); font-size: 22px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
    :where(.app-body) .document-state-summary h2 { margin-bottom: var(--sp-2); }
    :where(.app-body) .document-state-summary dl { gap: 0; margin: 0; }
    :where(.app-body) .document-state-summary dl div { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: var(--sp-3); padding: var(--sp-3) 0; border-bottom: 1px solid var(--gray-100); }
    :where(.app-body) .document-state-summary dl div:last-child { border-bottom: 0; }
    :where(.app-body) .document-state-summary dt { color: var(--gray-500); font-size: 14px; }
    :where(.app-body) .document-state-summary dd { margin: 0; color: var(--gray-900); }
    :where(.app-body) :where(td) a:not([class]) { color: var(--gray-900); font-weight: 600; text-decoration: none; }
    :where(.app-body) :where(td) a:not([class]):hover { color: var(--primary); text-decoration: underline; }

    :where(.app-body) nav.filter-row { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-3); }
    :where(.app-body) nav.filter-row > .button { min-height: 36px; padding: 0 var(--sp-4); border-radius: 999px; }
    :where(.app-body) nav.filter-row > .button[aria-current="page"] { background: var(--gray-900); color: var(--surface); }
    :where(.app-body) .location-value { font-weight: 600; font-variant-numeric: tabular-nums; word-break: keep-all; }
    :where(.app-body) td strong + small { display: block; margin-top: 2px; color: var(--gray-500); font-size: var(--text-meta); font-weight: 400; }
    :where(.app-body) form.panel.filter-bar { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items: end; gap: var(--sp-3) var(--sp-4); }
    :where(.app-body) form.panel.filter-bar label { display: grid; gap: var(--sp-1); color: var(--gray-600); font-size: var(--text-meta); }
    :where(.app-body) form.panel.filter-bar label > input { margin: 0; }
    :where(.app-body) form.panel.filter-bar > .button-group { min-height: var(--control-height); }
    :where(.app-body) .search-inline-form { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
    :where(.app-body) .search-inline-form .search-input { flex: 1 1 280px; min-width: 0; margin: 0; }
    :where(.app-body) .search-inline-form .search-input input { margin: 0; }
    :where(.app-body) .report-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); }
    /* 폭 규칙: 목록은 전체 폭, 입력 폼은 720px까지 왼쪽 정렬. 가운데 떠 있는 좁은 카드를 두지 않는다. */
    :where(.app-body) .narrow { max-width: 720px; margin-inline: 0; }
    :where(.app-body) .revision-form-layout { justify-content: start; }
    :where(.app-body) :is(.master-create-panel, .master-management) { max-width: none; margin-inline: 0; }
    /* 조회 조건 줄의 버튼은 입력칸과 같은 높이로 아래선에 맞춘다(격자 칸 높이로 늘어나지 않게). */
    :where(.app-body) :is(.filter-bar, .filter-row) > :is(button, .button) { align-self: end; }
    /* 장식용 왼쪽 강조선은 쓰지 않는다(면 우선). */
    :where(.app-body) .locator-hero { border: 0; }
    :where(.app-body) fieldset:not([class]) { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-5); min-width: 0; margin: 0; padding: var(--sp-4); border: 0; border-radius: var(--r-md); background: var(--gray-50); }
    :where(.app-body) fieldset:not([class]) > legend { float: left; width: 100%; margin: 0 0 var(--sp-1); padding: 0; color: var(--gray-800); font-size: 14px; font-weight: 700; }
    :where(.app-body) fieldset:not([class]) .check-inline { min-height: 32px; font-size: 14px; }
    :where(.app-body) .user-group > summary { min-height: 32px; font-size: var(--text-lead); }
    :where(.app-body) .user-group-title::before, :where(.app-body) .user-group[open] .user-group-title::before { content: ""; width: 20px; height: 20px; background: var(--gray-400); -webkit-mask: var(--icon-chevron-right) center/contain no-repeat; mask: var(--icon-chevron-right) center/contain no-repeat; transition: transform .15s ease; }
    :where(.app-body) .user-group[open] .user-group-title::before { transform: rotate(90deg); }
    :where(.app-body) .user-group-body { border-top-color: var(--gray-100); }
    :where(.app-body) .master-row:last-child { border-bottom: 0; }
    :where(.app-body) .rack-card { gap: var(--sp-1); padding: var(--sp-5); }
    :where(.app-body) .rack-card small { color: var(--gray-500); font-size: var(--text-meta); }
    :where(.app-body) .rack-card strong { color: var(--gray-900); font-size: var(--text-lead); }
    :where(.app-body) .rack-card span { color: var(--gray-600); font-size: var(--text-meta); }
    /* 도면 옆 랙 목록: .zone-overview a의 세로 전용 여백이 랙 버튼의 좌우 여백을 지우지 않게 한다. */
    :where(.app-body) .zone-overview .zone-rack-links a { padding: var(--sp-2) var(--sp-3); border: 1px solid var(--line); }
    :where(.app-body) .rack-cell { border-color: var(--gray-100); }
    :where(.app-body) .rack-axis-shelf, :where(.app-body) .rack-column-guide { font-size: var(--text-meta); }
    :where(.app-body) .rack-cell-disposed { font-size: var(--text-caption); }

    /* 결과 화면: 아이콘 → 제목 → 원인·다음 행동 → 버튼 */
    :where(.app-body) .result-panel { display: grid; justify-items: center; gap: var(--sp-3); margin-top: var(--sp-8); padding: var(--sp-8) var(--sp-6); text-align: center; }
    :where(.app-body) .result-icon { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 999px; background: var(--gray-100); color: var(--gray-600); font-size: 28px; }
    :where(.app-body) .result-panel h1 { margin-top: var(--sp-2); font-size: 20px; }
    :where(.app-body) .result-panel p { max-width: 420px; margin: 0; color: var(--gray-600); }
    :where(.app-body) .result-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-2); margin-top: var(--sp-3); }

    /* 목록·표: 헤더는 옅게, 행은 넉넉하게 */
    :where(.app-body) .tab-nav, :where(.app-body) .workspace-tabs { gap: var(--sp-5); border-bottom-color: var(--line); }
    :where(.app-body) .tab-nav button, :where(.app-body) .workspace-tabs a { min-height: 44px; padding: var(--sp-2) 0 var(--sp-3); border: 0; color: var(--gray-500); font-size: var(--text-body); font-weight: 600; }
    :where(.app-body) .workspace-tabs a { display: inline-flex; align-items: center; border-bottom: 2px solid transparent; }
    :where(.app-body) .tab-nav button[aria-selected="true"], :where(.app-body) .workspace-tabs a[aria-current="page"] { border-color: var(--gray-900); color: var(--gray-900); box-shadow: inset 0 -2px 0 var(--gray-900); }
    :where(.app-body) .workspace-tabs a[aria-current="page"] { box-shadow: none; }

    /* 떠 있는 레이어: 대화상자·선택 바·토스트 */
    :where(.app-body) .modal, :where(.app-body) .app-confirm-dialog, :where(.app-body) .mobile-filter-dialog { border: 0; border-radius: var(--r-xl); }
    :where(.app-body) .modal-body { gap: var(--sp-4); padding: var(--sp-6); }
    :where(.app-body) .modal-body > :is(h2, h3) { font-size: 20px; line-height: 1.45; }
    :where(.app-body) .modal-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); margin-top: var(--sp-2); }
    :where(.app-body) .modal-actions > :only-child { grid-column: 1 / -1; }
    :where(.app-body) .modal-actions > * { min-height: var(--control-height-lg); justify-content: center; }
    :where(.app-body) .modal-actions .danger-button[type="submit"] { background: var(--danger); color: var(--surface); }
    :where(.app-body) .modal-actions .danger-button[type="submit"]:hover { background: var(--danger); filter: brightness(.92); }
    :where(.app-body) .modal-actions .danger-button[type="submit"]:disabled { background: var(--danger-soft); color: var(--danger); filter: none; }
    :where(.app-body) .bulk-bar { gap: var(--sp-3); min-height: 56px; padding: var(--sp-2) var(--sp-3) var(--sp-2) var(--sp-5); border: 0; border-radius: var(--r-lg); font-size: 14px; }
    :where(.app-body) .bulk-bar :is(.button.secondary, button.secondary) { background: rgba(255, 255, 255, .12); color: var(--surface); }
    :where(.app-body) .bulk-bar :is(.button.secondary, button.secondary):hover { background: rgba(255, 255, 255, .18); }
    :where(.app-body) .app-toast { gap: var(--sp-3); padding: var(--sp-3) var(--sp-5); border-radius: var(--r-lg); background: var(--gray-800); font-size: 14.5px; }
    :where(.app-body) .command-palette { border-radius: var(--r-xl); padding: var(--sp-5); }
    :where(.app-body) .command-palette-list a { min-height: 44px; font-size: var(--text-body); }

    @media (max-width: 760px) {
      :where(.app-body) .app-shell { padding-top: var(--sp-4); }
      :where(.app-body) .panel { padding: var(--sp-5) var(--sp-4); }
      /* 데스크톱의 아래 정렬(flex-end)이 세로 배치에서는 제목을 오른쪽으로 민다. 모바일은 왼쪽 기준으로 쌓는다. */
      :where(.app-body) .page-head { flex-direction: column; align-items: stretch; gap: var(--sp-3); margin-bottom: var(--sp-5); }
      :where(.app-body) .page-head .button-group { justify-content: flex-start; }
      :where(.app-body) .page-head .button-group > * { flex: 0 1 auto; }
      :where(.app-body) .page-head p { font-size: 14px; }
      /* 모바일 검색: 검색 버튼은 입력창 안에, 필터는 작은 버튼 하나. 결과 카드는 문서명·번호·위치 세 줄로 줄인다. */
      :where(.app-body) .search-workspace-head { grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); }
      :where(.app-body) .search-box { grid-template-columns: auto minmax(0, 1fr) auto; min-height: 0; padding: var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-3); }
      :where(.app-body) .search-box button { grid-column: auto; width: auto; min-height: var(--touch-height); padding-inline: var(--sp-4); }
      :where(.app-body) .mobile-search-filter-button { width: auto; justify-self: start; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); }
      :where(.app-body) .viewer-workspace .results-panel { padding: var(--sp-2) var(--sp-4); }
      :where(.app-body) .viewer-result-table .viewer-result-row { gap: var(--sp-1) var(--sp-3); padding: var(--sp-3) 0; border-bottom-color: var(--gray-100); }
      :where(.app-body) .viewer-result-row:hover { background: transparent; }
      :where(.app-body) .viewer-result-row .viewer-result-location { flex: 1 1 0; width: auto; min-width: 0; align-self: center; margin-top: 0; }
      :where(.app-body) .viewer-result-row .viewer-result-category { display: none; }
      :where(.app-body) .viewer-result-row .viewer-result-action { flex: none; }
      :where(.app-body) .viewer-result-row .viewer-result-action .button { min-height: 40px; }
      :where(.app-body) .document-detail-head { margin: calc(-1 * var(--sp-4)) calc(-1 * var(--sp-3)) var(--sp-3); padding: var(--sp-4) var(--sp-5) var(--sp-5); border-radius: 0 0 var(--r-lg) var(--r-lg); }
      :where(.app-body) .document-detail-head .breadcrumb a { color: var(--gray-700); }
      :where(.app-body) .document-detail-head .breadcrumb a::before { content: ""; margin-right: 0; }
      :where(.app-body) .document-detail-head .document-title-row h1 { font-size: 22px; }
      :where(.app-body) .document-detail-head .detail-actions { padding-top: var(--sp-4); }
      :where(.app-body) .document-detail-head .detail-action-groups { gap: var(--sp-3); }
      :where(.app-body) .document-detail-head .detail-action-groups > div:not(.detail-state-actions) { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: var(--sp-2); }
      :where(.app-body) .detail-state-actions > div { display: grid; width: 100%; }
      /* 되돌리기 어려운 폐기는 편집 버튼 아래 오른쪽 끝의 글자 버튼으로 둬 화면에서 가장 큰 면이 되지 않게 한다. */
      :where(.app-body) .document-detail-head .detail-state-actions > div { justify-items: end; }
      :where(.app-body) .document-detail-head .detail-state-actions :is(button, .button) { width: auto; padding-inline: var(--sp-3); background: transparent; color: var(--danger); }
      :where(.app-body) .admin-status-panel, :where(.app-body) .admin-status-panel.is-attention { padding: var(--sp-5); }
      :where(.app-body) .search-index-health { align-items: flex-start; flex-direction: column; gap: var(--sp-2); padding: var(--sp-5); }
      :where(.app-body) .search-index-health p { text-align: left; }
      :where(.app-body) .management-heading { padding: var(--sp-5) var(--sp-4) var(--sp-3); }
      :where(.app-body) .management-links .admin-tile { padding: var(--sp-3) var(--sp-4); }
      :where(.app-body) .detail-state-actions { border: 0; padding: 0; }
      :where(.app-body) .document-location-summary { padding: var(--sp-5); }
      :where(.app-body) .document-location-summary strong { font-size: 22px; }
      :where(.app-body) .document-location-visuals .panel { padding: var(--sp-4); }
      :where(.app-body) .detail-section dl div { grid-template-columns: 104px minmax(0, 1fr); }
      :where(.app-body) .document-form { padding: var(--sp-5) var(--sp-4); }
      /* 저장 바: 완료도는 얇은 한 줄, 버튼은 한 줄. 좁아서 넘치면 주요 버튼만 아래 줄로 내려간다. */
      :where(.app-body) .sticky-save-bar { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-2); padding: var(--sp-2) var(--sp-3) var(--sp-3); }
      :where(.app-body) .sticky-save-bar .form-completion { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
      :where(.app-body) .sticky-save-bar .form-completion strong { flex: none; }
      :where(.app-body) .sticky-save-bar .form-completion progress { flex: 1 1 auto; }
      :where(.app-body) .sticky-save-bar .button-group { flex-wrap: wrap; }
      :where(.app-body) .sticky-save-bar .button-group > * { flex: 0 0 auto; padding-inline: var(--sp-3); }
      :where(.app-body) .sticky-save-bar .button-group > :last-child { flex: 1 1 72px; }
      :where(.app-body) .modal-body { padding: var(--sp-5); }
      :where(.app-body) .modal-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      :where(.app-body) .mobile-filter-dialog[open] { border-radius: var(--r-xl) var(--r-xl) 0 0; }
    }
    @media (max-width: 760px) {
      :where(.app-body) .topbar .nav-group-label, :where(.app-body) .topbar .brand { min-height: var(--touch-height); }
      :where(.app-body) .viewer-result-row .viewer-result-action .button, :where(.app-body) :is(.detail-history, .historical-location, .user-group, .form-review) > summary { min-height: var(--touch-height); }
      :where(.app-body) .breadcrumb a { display: inline-flex; align-items: center; min-height: var(--touch-height); }
      :where(.app-body) .chip, :where(.app-body) .quality-strip .warn { min-height: var(--touch-height); }
      :where(.app-body) .rack-cell-disposed { display: flex; align-items: center; min-height: 32px; }
      :where(.app-body) .mobile-tab span { font-size: var(--text-caption); }
      :where(.app-body) :is(input, select, textarea):where(:not([type="checkbox"], [type="radio"], [type="file"], [type="hidden"], [type="range"])) { min-height: var(--touch-height); font-size: 16px; }
      :where(.app-body) :is(.button, button, .danger-button).sm, :where(.app-body) nav.filter-row > .button, :where(.app-body) .quality-issue-nav .chip { min-height: var(--touch-height); }
      :where(.app-body) details > summary { min-height: var(--touch-height); padding-block: var(--sp-2); }
    }
    :where(.app-body) .workflow-step small { font-size: var(--text-caption); }
    :where(.app-body) td small, :where(.app-body) :is(.master-create-form, .category-master-edit-form) label small { font-size: var(--text-caption); }
    @media (max-width: 520px) {
      :where(.app-body) .modal-actions { grid-template-columns: 1fr; }
    }
`;
}
