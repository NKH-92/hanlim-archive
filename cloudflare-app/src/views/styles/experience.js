// Tectra-inspired 운영 셸과 화면별 정보 위계. 기존 컴포넌트 스타일 뒤에서 의도적으로 보강한다.

export function experienceStyles() {
  return `    .action-button,
    button.action-button,
    .button.action-button { background: var(--action); border-color: var(--action); color: var(--action-ink); }
    .action-button:hover,
    button.action-button:hover,
    .button.action-button:hover { background: var(--action-strong); border-color: var(--action-strong); color: var(--action-ink); }

    .hero-kicker { margin: 0; color: rgba(255, 255, 255, .6); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .operation-hero { position: relative; overflow: hidden; border: 0; border-radius: var(--r-lg); background: var(--hero-bg); color: var(--surface); }
    .operation-hero::after { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255, 255, 255, .05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, .05) 1px, transparent 1px); background-size: var(--sp-8) var(--sp-8); pointer-events: none; }
    .operation-hero > * { position: relative; z-index: 1; }

    .search-home-hero { min-height: 160px; align-content: center; justify-items: stretch; padding: var(--sp-5) var(--sp-6); background: var(--hero-bg); color: var(--surface); border-radius: var(--r-lg); text-align: left; overflow: hidden; position: relative; }
    .search-home-hero::after { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255, 255, 255, .05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, .05) 1px, transparent 1px); background-size: var(--sp-8) var(--sp-8); pointer-events: none; }
    .search-home-copy, .search-home-hero .viewer-search-form, .search-home-hero .viewer-recents { position: relative; z-index: 1; width: min(760px, 100%); }
    .viewer-search-form.is-home .filter-details { display: none; }
    .search-home-copy { display: grid; gap: var(--sp-2); }
    .search-home-copy h1 { color: var(--surface); font-size: clamp(22px, 2.4vw, 30px); line-height: 1.2; }
    .search-home-copy .search-home-sub { color: rgba(255, 255, 255, .82); max-width: 560px; }
    .search-home-hero .search-box { margin-top: var(--sp-2); padding: var(--sp-1); border: 0; background: var(--surface); box-shadow: var(--shadow-1); }
    .search-home-hero .search-box button { min-height: 44px; background: var(--action); color: var(--action-ink); }
    .search-home-hero .search-box button:hover { background: var(--action-strong); }
    .search-home-hero .viewer-recents { color: rgba(255, 255, 255, .82); }
    .search-home-hero .viewer-recents .chip { background: rgba(255, 255, 255, .12); border-color: transparent; color: var(--surface); }
    .search-home-filter { padding: var(--sp-3) var(--sp-4); border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); }

    .search-band.operation-hero { grid-template-columns: minmax(220px, .8fr) minmax(440px, 1.4fr); align-items: center; padding: var(--sp-6) var(--sp-8); }
    .search-band.operation-hero h1 { color: var(--surface); font-size: 24px; }
    .search-band.operation-hero .page-sub { color: rgba(255, 255, 255, .82); }
    .search-band.operation-hero .search-box { border: 0; }
    .search-band.operation-hero .search-box button { background: var(--action); color: var(--action-ink); }
    .search-band.operation-hero .search-box button:hover { background: var(--action-strong); }
    .search-workspace-head { display: grid; grid-template-columns: minmax(220px, .8fr) minmax(440px, 1.4fr); align-items: end; }
    .search-workspace-head .viewer-search-form { min-width: 0; }
    .search-results-controls { margin-top: calc(-1 * var(--sp-2)); }
    .mobile-search-filter-button { display: none; }
    .mobile-filter-dialog { width: min(520px, calc(100% - var(--sp-8))); padding: 0; border: 1px solid var(--line); border-radius: var(--r-lg); color: var(--gray-900); background: var(--surface); box-shadow: var(--shadow-2); }
    .mobile-filter-dialog::backdrop { background: var(--scrim); }
    .mobile-filter-form { display: grid; gap: var(--sp-4); padding: var(--sp-5); }
    .mobile-filter-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); }
    .mobile-filter-head h2 { margin: var(--sp-1) 0 0; }
    .mobile-filter-head small { color: var(--gray-500); font-weight: 700; }
    .mobile-filter-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); }
    .mobile-filter-actions > * { justify-content: center; }

    .document-detail-head { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-5); align-items: end; padding: var(--sp-8); margin-bottom: var(--sp-3); border-radius: var(--r-lg); background: var(--hero-bg); color: var(--surface); }
    .document-detail-head::after { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255, 255, 255, .05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, .05) 1px, transparent 1px); background-size: var(--sp-8) var(--sp-8); pointer-events: none; }
    .document-detail-head > * { position: relative; z-index: 1; }
    .document-detail-head .breadcrumb { color: rgba(255, 255, 255, .6); }
    .document-detail-head .document-title-row { align-self: end; }
    .document-detail-head .document-title-row h1 { color: var(--surface); font-size: 26px; }
    .document-detail-head .document-title-row p { color: rgba(255, 255, 255, .82); }
    .document-location-visuals { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: stretch; }
    .minimap-card { background: var(--primary-deep); border-color: var(--primary-deep); color: var(--surface); }
    .minimap-card .section-title h2, .minimap-card .mini-column-guide strong { color: var(--surface); }
    .minimap-card .count-badge, .minimap-card .mini-column-guide strong { background: rgba(255, 255, 255, .12); color: var(--surface); }
    .minimap-card .mini-column-guide, .minimap-card .mini-axis, .minimap-card .mini-orientation-note { color: rgba(255, 255, 255, .6); }
    .minimap-card .mini-slot { background: rgba(255, 255, 255, .12); border-color: rgba(255, 255, 255, .18); color: rgba(255, 255, 255, .82); }
    .minimap-card .mini-slot.active { background: var(--action); border-color: var(--action); color: var(--action-ink); box-shadow: 0 0 0 3px var(--action-soft); }
    .minimap-card .mini-compass { background: var(--action-soft); color: var(--action-ink); }

    .floor-plan-hero, .workflow-hero, .admin-hero, .disposal-hero { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-6); padding: var(--sp-6) var(--sp-8); margin-bottom: var(--sp-4); }
    .floor-plan-hero h2, .workflow-hero h2, .admin-hero h2, .disposal-hero h2 { margin-top: var(--sp-2); color: var(--surface); font-size: 22px; }
    .floor-plan-hero p, .workflow-hero p, .admin-hero p, .disposal-hero p { margin: var(--sp-1) 0 0; color: rgba(255, 255, 255, .82); }
    .hero-stat { min-width: 128px; padding: var(--sp-4); border: 1px solid rgba(255, 255, 255, .18); border-radius: var(--r-lg); background: rgba(255, 255, 255, .12); text-align: center; }
    .hero-stat strong { display: block; color: var(--action); font-size: 28px; line-height: 1.2; }
    .hero-stat span { color: rgba(255, 255, 255, .82); font-size: 12px; font-weight: 600; }
    .floor-plan-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, .28fr); gap: var(--sp-4); align-items: start; }
    .floor-plan-layout > .panel { margin: 0; }
    .zone-overview { display: grid; gap: var(--sp-1); }
    .zone-overview a { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-3) 0; border-bottom: 1px solid var(--gray-100); color: var(--gray-700); text-decoration: none; }
    .zone-overview a:last-child { border-bottom: 0; }
    .zone-overview a:hover { color: var(--primary); }
    .zone-overview small { display: block; color: var(--text-muted); }
    .floor-rack:focus-visible, .floor-rack:hover { border-color: var(--action); box-shadow: 0 0 0 3px var(--action-soft); }
    .floor-rack.is-hit { background: var(--action); border-color: var(--action); color: var(--action-ink); }

    .ledger-methods { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-4); margin-bottom: var(--sp-4); }
    .ledger-method-card { display: grid; align-content: start; gap: var(--sp-3); margin: 0; border-top: 3px solid var(--primary); }
    .ledger-method-card h2, .ledger-method-card p { margin: 0; }
    .ledger-method-label { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); color: var(--primary); font-size: 12px; font-weight: 800; letter-spacing: .06em; }
    .ledger-method-label i { display: grid; place-items: center; width: 34px; height: 34px; border-radius: var(--r-md); background: var(--primary-soft); font-size: 16px; }
    .ledger-method-note { padding: var(--sp-3); border-radius: var(--r-md); background: var(--gray-50); color: var(--gray-600); }
    .ledger-method-card > .button { margin-top: auto; }
    .snapshot-upload-panel { grid-template-columns: minmax(0, 1fr); scroll-margin-top: var(--sp-4); }
    .workflow-stepper { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin-bottom: var(--sp-4); padding: var(--sp-4) var(--sp-5); border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); }
    .workflow-step { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: var(--sp-2); align-items: center; min-width: 0; }
    .workflow-step:not(:last-child)::after { content: ""; position: absolute; top: 14px; left: 38px; right: var(--sp-2); height: 1px; background: var(--line); }
    .workflow-step-index { position: relative; z-index: 1; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 999px; background: var(--gray-100); color: var(--gray-500); font-size: 12px; font-weight: 800; }
    .workflow-step strong { display: block; font-size: 12.5px; }
    .workflow-step small { display: block; color: var(--gray-500); font-size: 11.5px; }
    .workflow-step.is-complete .workflow-step-index { background: var(--success-soft); color: var(--success); }
    .workflow-step.is-current .workflow-step-index { background: var(--action); color: var(--action-ink); box-shadow: 0 0 0 3px var(--action-soft); }
    .workflow-step.is-current strong { color: var(--gray-900); }
    .snapshot-intro { border-top: 3px solid var(--primary); }
    .snapshot-apply-form { margin-top: var(--sp-4); padding: var(--sp-4); border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--gray-50); }
    .snapshot-final-apply { border-top: 3px solid var(--action); }
    .snapshot-bootstrap-confirm { padding: var(--sp-4); border: 1px solid var(--warning); border-radius: var(--r-md); background: var(--warning-soft); }
    .permission-current, .permission-diff { display: grid; gap: var(--sp-1); padding: var(--sp-3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--gray-50); }
    .permission-current span, .permission-diff p { margin: 0; color: var(--gray-600); }
    .permission-added { color: var(--success) !important; }
    .permission-removed { color: var(--danger) !important; }
    .login-help { display: grid; gap: var(--sp-1); margin-top: var(--sp-4); padding-top: var(--sp-4); border-top: 1px solid var(--line); font-size: 12.5px; }
    .login-help p { margin: 0; }
    .mobile-filter-toggle { display: none; margin-bottom: var(--sp-2); }
    .disposal-review-actions { display: grid; gap: var(--sp-3); margin-top: var(--sp-4); }
    .disposal-review-actions > form { padding: var(--sp-3); border: 1px solid var(--line); border-radius: var(--r-md); }

    .disposal-shell { display: grid; gap: var(--sp-4); }
    .disposal-targets-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-4); }
    .bulk-bar { border: 1px solid rgba(255, 255, 255, .18); }

    .admin-hero-copy { display: grid; gap: var(--sp-2); }
    .admin-hero-actions { display: flex; align-items: center; gap: var(--sp-2); }
    .admin-hero .action-button { align-self: start; }
    .management-section { padding: 0; overflow: hidden; }
    .management-heading { padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--line); }
    .management-heading p { margin: var(--sp-1) 0 0; }
    .management-links { gap: 0; }
    .management-links .admin-tile { margin: 0; border: 0; border-radius: 0; border-bottom: 1px solid var(--gray-100); }
    .management-links .admin-tile:last-child { border-bottom: 0; }

    .locked-field { display: grid; align-content: center; gap: var(--sp-1); padding: var(--sp-3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--gray-50); }
    .locked-field > span { font-size: 12px; font-weight: 700; color: var(--gray-600); }
    .locked-field > strong { font-size: 15px; color: var(--gray-900); }
    .locked-field > small { color: var(--gray-500); }
    .revision-form-layout { grid-template-columns: minmax(0, 760px); justify-content: center; }
    .revision-policy { display: grid; gap: var(--sp-1); }
    .revision-policy p { margin: 0; }
    .revision-source-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-3); margin: 0; }
    .revision-source-summary div { display: grid; gap: var(--sp-1); padding: var(--sp-3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--gray-50); }
    .revision-source-summary dt { color: var(--gray-600); font-size: 12px; font-weight: 700; }
    .revision-source-summary dd { margin: 0; color: var(--gray-900); }
    .revision-confirm { margin-top: var(--sp-4); padding: var(--sp-3); border: 1px solid var(--action); border-radius: var(--r-md); background: var(--action-soft); }
    .revision-history { margin-top: var(--sp-4); }
    .revision-history ol { display: grid; gap: var(--sp-2); margin: var(--sp-3) 0 0; padding: 0; list-style: none; }
    .revision-history li { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-3); border: 1px solid var(--line); border-radius: var(--r-md); }
    .revision-history li.current { border-color: var(--primary); background: var(--primary-soft); }
    .revision-history a { display: flex; align-items: center; gap: var(--sp-3); color: inherit; text-decoration: none; }
    .revision-history a span { color: var(--gray-600); }

    @media (max-width: 1180px) {
      .search-band.operation-hero { grid-template-columns: 1fr; }
      .search-workspace-head { grid-template-columns: 1fr; }
      .floor-plan-layout { grid-template-columns: 1fr; }
      .zone-overview { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .zone-overview a { border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); }
    }
    @media (min-width: 1100px) {
      .topbar { background: var(--primary-deep); border-right-color: rgba(255, 255, 255, .12); color: var(--surface); }
      .topbar .brand { border-bottom-color: rgba(255, 255, 255, .12); }
      .topbar .brand-logo { filter: drop-shadow(0 4px 12px rgba(24, 33, 47, .18)); }
      .topbar .brand strong { color: var(--surface); letter-spacing: .02em; }
      .topbar .brand small { color: rgba(255, 255, 255, .6); }
      .topbar .archive-nav-item, .topbar .nav-sub-link, .topbar .logout-link, .topbar .nav-settings summary { color: rgba(255, 255, 255, .82); }
      .topbar .nav-group-label { color: rgba(255, 255, 255, .55); }
      .topbar .archive-nav-item:hover, .topbar .nav-sub-link:hover, .topbar .logout-link:hover, .topbar .nav-settings summary:hover { background: rgba(255, 255, 255, .12); color: var(--surface); }
      .topbar .archive-nav-item.active { position: relative; background: rgba(255, 255, 255, .14); color: var(--surface); }
      .topbar .archive-nav-item.active::before { content: ""; position: absolute; left: calc(-1 * var(--sp-3)); top: var(--sp-2); bottom: var(--sp-2); width: var(--sp-1); border-radius: 0 var(--r-sm) var(--r-sm) 0; background: var(--action); }
      .topbar .nav-settings, .topbar .nav-user { border-color: rgba(255, 255, 255, .12); }
      .topbar .session-pill { background: rgba(255, 255, 255, .12); color: var(--surface); }
      .topbar .command-trigger { background: rgba(255, 255, 255, .12); border-color: rgba(255, 255, 255, .18); color: rgba(255, 255, 255, .82); }
      .topbar .command-trigger:hover { background: rgba(255, 255, 255, .18); color: var(--surface); }
      .topbar .command-trigger kbd { background: transparent; border-color: rgba(255, 255, 255, .18); color: rgba(255, 255, 255, .6); }
    }
    @media (max-width: 760px) {
      .mobile-filter-toggle { display: inline-flex; }
      .desktop-filter-controls { display: none; }
      .mobile-search-filter-button { display: inline-flex; width: 100%; justify-content: center; min-height: 44px; }
      .mobile-filter-dialog[open] { position: fixed; inset: auto 0 0; width: 100%; max-width: none; max-height: min(82vh, 720px); margin: 0; border-width: 1px 0 0; border-radius: var(--r-lg) var(--r-lg) 0 0; overflow-y: auto; }
      .mobile-filter-form { padding-bottom: max(var(--sp-5), env(safe-area-inset-bottom)); }
      .mobile-filter-dialog .viewer-filter-row { grid-template-columns: 1fr; }
      .mobile-filter-dialog .viewer-filter-row > .button { display: none; }
      .ledger-methods { grid-template-columns: 1fr; }
      .revision-source-summary { grid-template-columns: 1fr; }
      .topbar { background: var(--primary-deep); border-bottom-color: rgba(255, 255, 255, .12); color: var(--surface); }
      .topbar .brand strong { color: var(--surface); }
      .topbar .brand small, .topbar .command-trigger { display: none; }
      .topbar .brand-logo { width: 48px; height: 34px; }
      .topbar .hamburger { background: rgba(255, 255, 255, .12); border-color: rgba(255, 255, 255, .18); color: var(--surface); }
      .search-home { margin: calc(-1 * var(--sp-3)) calc(-1 * var(--sp-3)) 0; width: calc(100% + var(--sp-6)); }
      .search-home-hero { min-height: 0; padding: var(--sp-6) var(--sp-4) var(--sp-5); border-radius: 0 0 var(--r-lg) var(--r-lg); }
      .search-home-copy h1 { font-size: 24px; }
      .search-home-copy .search-home-sub { display: none; }
      .search-home-hero .search-box { margin-top: var(--sp-3); }
      .search-home-hero .viewer-recents { margin-top: var(--sp-2); }
      .search-band.operation-hero { margin: calc(-1 * var(--sp-3)) calc(-1 * var(--sp-3)) 0; padding: var(--sp-5) var(--sp-4); border-radius: 0 0 var(--r-lg) var(--r-lg); }
      .search-band.operation-hero .hero-kicker, .search-band.operation-hero .page-sub { display: none; }
      .search-band.operation-hero h1 { font-size: 20px; }
      .document-detail-head { grid-template-columns: minmax(0, 1fr); margin: calc(-1 * var(--sp-3)) calc(-1 * var(--sp-3)) var(--sp-3); padding: var(--sp-5) var(--sp-4); border-radius: 0 0 var(--r-lg) var(--r-lg); }
      .document-detail-head .breadcrumb { display: flex; align-items: center; margin: 0; }
      .document-detail-head .breadcrumb > span { display: none; }
      .document-detail-head .breadcrumb a { display: inline-flex; align-items: center; min-height: 44px; color: var(--surface); font-weight: 700; }
      .document-detail-head .breadcrumb a::before { content: "←"; margin-right: var(--sp-2); }
      .document-detail-head .document-title-row h1 { font-size: 21px; }
      .document-title-row { flex-direction: column; }
      .document-state-badges { justify-content: flex-start; }
      .document-location-hero { align-items: stretch; flex-direction: column; gap: var(--sp-4); padding: var(--sp-4); }
      .document-location-summary strong { font-size: 19px; }
      .location-hero-actions, .location-hero-actions > * { width: 100%; }
      .location-hero-actions > * { justify-content: center; min-height: 44px; }
      .document-location-visuals { grid-template-columns: minmax(0, 1fr); }
      .document-location-visuals .doc-floor-plan { order: -1; }
      .document-location-visuals .panel { padding: var(--sp-3); overflow: hidden; }
      .document-detail-sections { grid-template-columns: minmax(0, 1fr); }
      .detail-section dl div { grid-template-columns: minmax(88px, .35fr) minmax(0, 1fr); }
      .detail-actions { padding: var(--sp-4); }
      .detail-action-groups, .detail-action-groups > div { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; }
      .detail-action-groups .button, .detail-action-groups button { width: 100%; justify-content: center; min-height: 44px; }
      .doc-floor-plan .floor-plan-tools { align-items: stretch; flex-direction: column; }
      .doc-floor-plan .floor-plan-tools .button { width: 100%; justify-content: center; min-height: 44px; }
      .mini-column-guide { gap: var(--sp-2); }
      .mini-column-guide strong { padding-inline: var(--sp-2); }
      .mini-compass { display: flex; border-radius: var(--r-md); line-height: 1.45; }
      .floor-plan-hero, .workflow-hero, .admin-hero, .disposal-hero { align-items: flex-start; padding: var(--sp-5) var(--sp-4); }
      .hero-stat { min-width: 96px; padding: var(--sp-3); }
      .hero-stat strong { font-size: 22px; }
      .workflow-stepper { grid-template-columns: repeat(4, minmax(64px, 1fr)); overflow-x: auto; padding: var(--sp-3); }
      .workflow-step { grid-template-columns: 24px; justify-items: center; text-align: center; }
      .workflow-step:not(:last-child)::after { top: 12px; left: calc(50% + var(--sp-3)); right: calc(-50% + var(--sp-3)); }
      .workflow-step-index { width: 24px; height: 24px; }
      .workflow-step small { display: none; }
      .workflow-step strong { font-size: 11px; }
      .zone-overview { grid-template-columns: 1fr; }
    }`;
}
