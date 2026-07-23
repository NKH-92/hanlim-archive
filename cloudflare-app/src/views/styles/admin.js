// 전역 CSS의 관리 화면 조각. 순서는 styles.js에서 고정한다.

export function adminStyles() {
  return `    .admin-link-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); }
    .admin-link-grid a { min-height: 56px; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-radius: var(--r-md); background: var(--gray-50); border: 1px solid var(--gray-100); text-decoration: none; font-weight: 600; font-size: 13.5px; transition: background .15s ease, color .15s ease, border-color .15s ease; }
    .admin-link-grid a:hover { background: var(--primary-soft); border-color: var(--primary-soft); color: var(--primary); }
    .admin-link-grid a i { color: var(--primary); }
    .management-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-4); }
    .management-section { margin-bottom: 0; }
    .management-section.is-advanced { border-style: dashed; }
    .management-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-3); margin-bottom: var(--sp-3); }
    .management-heading p { margin: var(--sp-1) 0 0; }
    .management-links { grid-template-columns: 1fr; }
    .management-links .panel { margin-bottom: 0; padding: var(--sp-4); }
    .admin-tile { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--sp-3); text-decoration: none; transition: border-color .15s ease, background .15s ease; }
    .admin-tile:hover { border-color: var(--gray-300); background: var(--gray-50); }
    .admin-tile > i { width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--r-md); background: var(--primary-soft); color: var(--primary); }
    .admin-tile > span { display: grid; gap: var(--sp-1); }
    .admin-tile small { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .admin-tile strong { font-size: 14px; font-weight: 700; }
    .rack-card { display: grid; gap: var(--sp-1); padding: var(--sp-4); text-decoration: none; transition: border-color .15s ease, background .15s ease; }
    .rack-card:hover { border-color: var(--gray-300); background: var(--gray-50); }
    .rack-card small { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .rack-card strong { font-size: 14px; font-weight: 700; }
    .rack-card span { color: var(--gray-600); font-size: 12.5px; }

    .locator-hero { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); padding: var(--sp-4) var(--sp-5); margin-bottom: var(--sp-4); background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--primary); border-radius: var(--r-lg); }
    .locator-hero small { display: block; color: var(--gray-600); font-size: 12px; font-weight: 600; }
    .locator-hero strong { display: block; font-size: 17px; font-weight: 700; margin: var(--sp-1) 0; }
    .loc-label-lg { color: var(--primary); letter-spacing: -.01em; }
    .locator-hero span { color: var(--gray-500); font-size: 12.5px; }

    .document-detail-page, .document-detail-head, .document-detail-sections, .document-location-visuals, .document-location-visuals > *, .detail-section, .doc-floor-plan, .doc-floor-plan-body, .minimap-card, .mini-rack-stage { min-inline-size: 0; max-inline-size: 100%; }
    .document-detail-head { display: grid; gap: var(--sp-3); margin-bottom: var(--sp-3); }
    .document-title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); }
    .document-title-copy { min-width: 0; }
    .document-state-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--sp-2); }
    .document-title-row h1 { margin: 0; }
    .document-title-row p { margin: var(--sp-1) 0 0; color: var(--gray-500); }
    .document-title-row h1, .document-title-row .mono { min-inline-size: 0; overflow-wrap: anywhere; }
    .document-detail-alerts:empty { display: none; }
    .document-detail-alerts .alert { margin-bottom: var(--sp-3); }
    .document-location-summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-5); padding: var(--sp-5); border: 1px solid var(--line); border-left: 4px solid var(--primary); border-radius: var(--r-lg); background: var(--surface); }
    .location-hero-copy { display: grid; min-width: 0; gap: var(--sp-1); }
    .location-hero-copy span { color: var(--gray-600); font-size: 12.5px; font-weight: 600; }
    .location-hero-actions { flex: 0 0 auto; }
    .document-location-summary small { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .document-location-summary strong { min-inline-size: 0; color: var(--primary); font-size: 22px; line-height: 1.25; overflow-wrap: anywhere; }
    .document-detail-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-4); margin-top: var(--sp-4); }
    .detail-section h2 { margin-bottom: var(--sp-3); }
    .detail-section dl { margin: 0; }
    .detail-section dl div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: var(--sp-3); padding: var(--sp-2) 0; border-bottom: 1px solid var(--gray-100); }
    .detail-section dt { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .detail-section dd { margin: 0; font-size: 13.5px; font-weight: 600; overflow-wrap: anywhere; }
    .detail-actions { margin: var(--sp-4) 0; }
    .detail-actions > summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); cursor: pointer; font-weight: 700; list-style: none; }
    .detail-actions > summary::-webkit-details-marker { display: none; }
    .detail-action-groups { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--sp-3); margin-top: var(--sp-4); padding-top: var(--sp-4); border-top: 1px solid var(--line); }
    .detail-action-groups > div { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
    .detail-history { margin-top: var(--sp-4); }
    .detail-history summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); cursor: pointer; font-weight: 700; list-style: none; }
    .detail-history summary::-webkit-details-marker { display: none; }
    .detail-history[open] summary { margin-bottom: var(--sp-4); }

    .tab-nav { display: flex; gap: var(--sp-4); overflow-x: auto; margin-bottom: var(--sp-4); border-bottom: 1px solid var(--line); }
    .tab-nav button { background: transparent; color: var(--gray-500); min-height: 0; padding: var(--sp-2) var(--sp-1) var(--sp-3); border: 0; border-radius: 0; font-size: 13.5px; font-weight: 600; white-space: nowrap; }
    .tab-nav button:hover { background: transparent; color: var(--gray-800); }
    .tab-nav button[aria-selected="true"] { background: transparent; color: var(--gray-900); box-shadow: inset 0 -2px 0 var(--primary); }
    .tab-count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 var(--sp-1); margin-left: var(--sp-1); border-radius: 999px; background: var(--gray-100); color: var(--gray-600); font-size: 11px; font-weight: 700; }
    .tab-nav button[aria-selected="true"] .tab-count { background: var(--primary-soft); color: var(--primary); }

    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--sp-8); }
    .detail-item { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: baseline; gap: var(--sp-3); padding: var(--sp-2) 0; border-bottom: 1px solid var(--gray-100); }
    .detail-item small { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .detail-item strong { font-weight: 600; font-size: 13.5px; }
    .document-location-visuals { display: grid; gap: var(--sp-4); margin-top: var(--sp-4); }
    .document-location-visuals > .panel { margin: 0; }
    .doc-floor-plan-body { display: grid; gap: var(--sp-3); }
    .doc-floor-plan-body .muted { margin: 0; }
    .doc-floor-plan-scroll { inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; overflow: hidden; overscroll-behavior-inline: contain; scrollbar-gutter: stable; }
    .doc-floor-plan-scroll.is-zoomed { overflow-x: auto; overflow-y: hidden; padding-bottom: var(--sp-1); }
    .doc-floor-plan-scroll.is-zoomed .floor-zoom { inline-size: 640px; max-inline-size: none; }
    .rack-result-link { justify-self: start; }
    .mini-rack-grid { display: grid; inline-size: max(100%, var(--grid-min)); min-inline-size: var(--grid-min); grid-template-columns: repeat(var(--cols), minmax(44px, 1fr)); gap: var(--sp-2); }
    .mini-slot { min-height: 44px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--gray-50); border: 1px solid var(--gray-100); position: relative; color: var(--gray-500); font-size: 12px; }
    .mini-slot.active { background: var(--primary); border-color: var(--primary); color: var(--surface); font-weight: 700; }
    .mini-slot i { position: absolute; top: var(--sp-1); right: var(--sp-1); }
    /* 선반 나침반 */
    .mini-rack-stage { display: flex; align-items: stretch; gap: var(--sp-3); }
    .mini-rack-scroll { flex: 1 1 auto; inline-size: 100%; min-inline-size: 0; max-inline-size: 100%; overflow-x: auto; overflow-y: hidden; padding: var(--sp-1); overscroll-behavior-inline: contain; scrollbar-gutter: stable; outline-offset: 2px; }
    .mini-axis { display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--gray-500); padding: var(--sp-1) 0; white-space: nowrap; }
    .mini-column-guide { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-2); color: var(--gray-500); font-size: 11px; font-weight: 600; }
    .mini-column-guide span:last-child { text-align: right; }
    .mini-column-guide strong { padding: var(--sp-1) var(--sp-3); border-radius: 999px; background: var(--gray-100); color: var(--gray-700); font-size: 11px; }
    .mini-orientation-note { margin: var(--sp-2) 0 0; color: var(--gray-500); font-size: 12.5px; }
    .mini-compass { margin: var(--sp-3) 0 0; display: inline-flex; align-items: center; gap: var(--sp-2); font-size: 13px; font-weight: 700; color: var(--primary); background: var(--primary-soft); border-radius: 999px; padding: var(--sp-2) var(--sp-3); font-variant-numeric: tabular-nums; }


    .timeline-container { display: grid; gap: var(--sp-2); }
    .timeline-item { display: grid; grid-template-columns: 14px 1fr; gap: var(--sp-2); }
    .timeline-badge { width: 8px; height: 8px; margin-top: var(--sp-2); border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
    .timeline-content { border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); background: var(--gray-50); }
    .timeline-content p { margin: var(--sp-1) 0 0; color: var(--gray-600); font-size: 12.5px; }
    .timeline-header { display: flex; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }
    .timeline-header strong { font-weight: 600; font-size: 13px; }
    .timeline-header span { color: var(--gray-500); font-size: 12px; }

    .alert { padding: var(--sp-3) var(--sp-4); border-radius: var(--r-md); margin-bottom: var(--sp-3); font-weight: 500; font-size: 13px; }
    .alert.danger { background: var(--danger-soft); color: var(--danger); }
    .alert.warning { background: var(--warning-soft); color: var(--warning); }
    .alert.success { background: var(--success-soft); color: var(--success); }
    .alert.info { background: var(--primary-soft); color: var(--primary); }
    .empty-state { display: grid; place-items: center; gap: var(--sp-2); padding: var(--sp-8) var(--sp-4); text-align: center; color: var(--gray-500); font-size: 13px; border-radius: var(--r-md); background: var(--gray-50); border: 1px dashed var(--gray-200); }
    .empty-state i { font-size: 22px; color: var(--gray-300); }
    .empty-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); justify-content: center; }
`;
}
