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

    .document-detail-head { display: grid; gap: var(--sp-3); margin-bottom: var(--sp-4); }
    .document-title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); }
    .document-title-row h1 { margin: 0; }
    .document-title-row p { margin: var(--sp-1) 0 0; color: var(--gray-500); }
    .document-location-summary { display: grid; gap: var(--sp-1); padding: var(--sp-3) var(--sp-4); border: 1px solid var(--line); border-left: 4px solid var(--primary); border-radius: var(--r-md); background: var(--surface); }
    .document-location-summary small { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .document-location-summary strong { color: var(--primary); font-size: 15px; }
    .document-detail-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-4); }
    .detail-section h2 { margin-bottom: var(--sp-3); }
    .detail-section dl { margin: 0; }
    .detail-section dl div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: var(--sp-3); padding: var(--sp-2) 0; border-bottom: 1px solid var(--gray-100); }
    .detail-section dt { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .detail-section dd { margin: 0; font-size: 13.5px; font-weight: 600; overflow-wrap: anywhere; }
    .detail-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--sp-3); margin: var(--sp-4) 0; }
    .detail-actions > div { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
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
    .minimap-card { margin-top: var(--sp-4); }
    .doc-floor-plan { margin-top: var(--sp-4); }
    .doc-floor-plan summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); list-style: none; cursor: pointer; font-size: 15px; font-weight: 700; }
    .doc-floor-plan summary::-webkit-details-marker { display: none; }
    .doc-floor-plan summary::after { content: "+"; color: var(--gray-500); font-size: 18px; line-height: 1; }
    .doc-floor-plan[open] summary::after { content: "−"; }
    .doc-floor-plan summary .count-badge { margin-left: auto; }
    .doc-floor-plan-body { margin-top: var(--sp-4); }
    .mini-rack-grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(44px, 1fr)); gap: var(--sp-2); }
    .mini-slot { min-height: 44px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--gray-50); border: 1px solid var(--gray-100); position: relative; color: var(--gray-500); font-size: 12px; }
    .mini-slot.active { background: var(--primary); border-color: var(--primary); color: var(--surface); font-weight: 700; }
    .mini-slot i { position: absolute; top: var(--sp-1); right: var(--sp-1); }
    /* 선반 나침반 */
    .mini-rack-stage { display: flex; align-items: stretch; gap: var(--sp-3); }
    .mini-axis { display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--gray-500); padding: var(--sp-1) 0; white-space: nowrap; }
    .mini-rack-stage .mini-rack-grid { flex: 1; }
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
    .empty-state { display: grid; place-items: center; gap: var(--sp-2); padding: var(--sp-8) var(--sp-4); text-align: center; color: var(--gray-500); font-size: 13px; border-radius: var(--r-md); background: var(--gray-50); border: 1px dashed var(--gray-200); }
    .empty-state i { font-size: 22px; color: var(--gray-300); }
    .empty-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); justify-content: center; }
`;
}
