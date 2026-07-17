// 전역 CSS의 반응형과 인쇄 조각. 순서는 styles.js에서 고정한다.

export function responsivePrintStyles() {
  return `    @media (min-width: 1100px) {
      .topbar { position: fixed; inset: 0 auto 0 0; width: 240px; flex-direction: column; align-items: stretch; padding: var(--sp-4) var(--sp-3); border-right: 1px solid var(--line); border-bottom: 0; }
      .topbar nav { flex-direction: column; align-items: stretch; gap: var(--sp-1); }
      .brand { padding: var(--sp-1) var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--line); margin-bottom: var(--sp-2); }
      .archive-nav-item, .nav-sub-link, .logout-link { justify-content: flex-start; }
      .nav-user { margin: auto 0 0; flex-direction: column; align-items: stretch; gap: var(--sp-1); padding-top: var(--sp-2); border-top: 1px solid var(--line); }
      .session-pill { border-radius: var(--r-md); white-space: normal; text-align: center; }
      .topbar + .app-shell { width: auto; max-width: 1440px; margin-left: calc(240px + var(--sp-6)); margin-right: var(--sp-6); }
      .hamburger, .drawer-close, .nav-scrim { display: none; }
    }
    @media (max-width: 1180px) {
      .viewer-workspace { grid-template-columns: 1fr; }
      .viewer-location-panel { position: static; }
      .viewer-filter-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 1099px) {
      .topbar { justify-content: space-between; }
      .hamburger { display: inline-flex; flex-direction: column; justify-content: center; align-items: center; gap: var(--sp-1); width: 36px; min-height: 36px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); border-radius: var(--r-md); padding: 0; }
      .hamburger:hover { background: var(--gray-50); }
      .hamburger span { display: block; width: 16px; height: 2px; background: currentColor; border-radius: 2px; }
      .drawer-close { display: inline-flex; align-self: flex-end; width: 32px; min-height: 32px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); border-radius: var(--r-md); font-size: 15px; padding: 0; }
      .drawer-close:hover { background: var(--gray-50); }
      .topbar nav { position: fixed; inset: 0 0 0 auto; width: min(320px, 86vw); background: var(--surface); padding: var(--sp-4); flex-direction: column; align-items: stretch; transform: translateX(100%); transition: transform .22s ease; box-shadow: var(--shadow-2); z-index: 60; }
      .topbar nav.is-open { transform: translateX(0); }
      .nav-user { margin: auto 0 0; flex-direction: column; align-items: stretch; padding-top: var(--sp-2); border-top: 1px solid var(--line); }
      .nav-scrim.is-open { position: fixed; inset: 0; background: var(--scrim); z-index: 55; }
    }
    @media (max-width: 1020px) {
      .content-grid { grid-template-columns: 1fr; }
      .filter-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .detail-grid { grid-template-columns: 1fr; gap: 0; }
    }
    @media print {
      .topbar, .skip-nav, .nav-scrim, .button, button, form, .set-admin-tools, .archive-map, .app-toast { display: none !important; }
      .screen-only { display: none !important; }
      .print-only { display: block !important; }
      body { background: var(--surface); }
      .app-shell { width: 100%; padding: 0; }
      .panel { border: 1px solid var(--gray-300); }
      th, td { border-bottom: 1px solid var(--gray-300); }
      .page-head, .metric-strip, .set-lock-panel, .movement-history { display: none !important; }
      .set-print-header { margin-bottom: var(--sp-5); }
      .set-print-header h1 { margin-bottom: var(--sp-2); font-size: 24px; }
      .set-print-header dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-3); margin-top: var(--sp-4); }
      .set-print-header dl div { border: 1px solid var(--gray-300); padding: var(--sp-2); }
      .set-print-header dt { color: var(--gray-500); font-size: 11px; }
      .set-print-header dd { margin: 0; font-weight: 700; }
      .print-check-column, .print-check-cell { display: table-cell !important; width: 44px; text-align: center; font-size: 18px; }
      .set-print-signatures { display: grid !important; grid-template-columns: repeat(2, 1fr); gap: var(--sp-6); margin-top: var(--sp-6); break-inside: avoid; }
      .set-print-signatures div { display: flex; align-items: end; gap: var(--sp-3); }
      .set-print-signatures span { flex: 1; height: 28px; border-bottom: 1px solid var(--gray-700); }
      .set-print-page { position: fixed; right: 0; bottom: 0; color: var(--gray-500); font-size: 11px; }
      .set-print-page span::after { content: counter(page); }
    }
    @media (max-width: 760px) {
      .app-shell { width: calc(100% - var(--sp-6)); padding-top: var(--sp-3); }
      .login-shell { grid-template-columns: 1fr; min-height: auto; }
      .login-side { display: none; }
      .login-panel { padding: var(--sp-6) var(--sp-5); }
      h1 { font-size: 17px; }
      .page-head, .locator-hero { flex-direction: column; align-items: stretch; }
      .head-actions, .document-toolbar { width: 100%; }
      .document-toolbar > * { flex: 1 1 150px; min-width: 0; }
      .search-box { grid-template-columns: auto minmax(0, 1fr); }
      .search-box button { grid-column: 1 / -1; width: 100%; }
      .filter-row, .viewer-filter-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .master-row, .master-form, .admin-link-grid, .set-add-grid { grid-template-columns: 1fr; }
      .doc-row { grid-template-columns: 1fr; gap: var(--sp-2); align-items: start; padding: var(--sp-3) var(--sp-2); }
      .doc-row-actions { flex-direction: row; justify-content: flex-start; }
      .doc-table-wrap { overflow: visible; }
      .doc-table, .doc-table tbody { display: block; width: 100%; }
      .doc-table thead { display: none; }
      .doc-table.is-bulk-selectable thead { display: block; }
      .doc-table.is-bulk-selectable thead tr { margin-bottom: var(--sp-2); }
      .doc-table.is-bulk-selectable thead th { display: none; }
      .doc-table.is-bulk-selectable thead .check-col { display: block; width: 100%; padding: 0; border: 0; background: transparent; }
      .doc-table.is-bulk-selectable .bulk-select-all-text { position: static; width: auto; height: auto; margin: 0; overflow: visible; clip: auto; white-space: normal; }
      .doc-table tbody { display: grid; gap: var(--sp-3); }
      .doc-table tr { display: block; padding: var(--sp-3); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); }
      .doc-table tr.is-disposed { box-shadow: inset 3px 0 0 var(--gray-300); }
      .doc-table tr.is-disposed td:first-child { border-left: 0; }
      .doc-table td { display: grid; grid-template-columns: minmax(104px, 34%) minmax(0, 1fr); gap: var(--sp-3); width: 100%; padding: var(--sp-2) 0; border-bottom: 1px solid var(--gray-100); white-space: normal; }
      .doc-table td:last-child { border-bottom: 0; }
      .doc-table td::before { content: attr(data-label); color: var(--gray-500); font-size: 12px; font-weight: 600; }
      .doc-table .name-cell { padding-top: 0; }
      .doc-table .name-cell a { font-size: 14px; }
      .doc-table .check-col { width: 100%; grid-template-columns: minmax(104px, 34%) minmax(0, 1fr); }
      .doc-table .loc-cell-main, .doc-table .mono-cell { white-space: normal; }
      .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric-card + .metric-card { border-left: 0; }
      .metric-card:nth-child(even) { border-left: 1px solid var(--line); }
      .metric-card:nth-child(n+3) { border-top: 1px solid var(--line); }
      .panel { padding: var(--sp-4); }
      .floor-plan-media { min-width: 760px; }
      .answer-loc { font-size: 19px; }
      .answer-loc span { display: block; margin-left: 0; }
      .answer-actions .button { flex: 1 1 auto; justify-content: center; }
      .search-home { padding-top: var(--sp-4); }
      .bulk-bar, .bulk-bar form { flex-direction: column; align-items: stretch; }
      .app-toast { bottom: var(--sp-4); width: calc(100vw - var(--sp-8)); max-width: none; text-align: center; }
    }
    @media (max-width: 520px) {
      .filter-row, .viewer-filter-row, .management-grid { grid-template-columns: 1fr; }
      .page-head .button-group > *, .document-toolbar > * { flex-basis: 100%; }
      .doc-table td, .doc-table .check-col { grid-template-columns: 92px minmax(0, 1fr); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    }`;
}
