// 전역 CSS의 업무 흐름과 상세 화면 조각. 순서는 styles.js에서 고정한다.

export function workflowStyles() {
  return `    .bulk-bar { position: sticky; bottom: var(--sp-4); z-index: 20; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); margin-top: var(--sp-3); background: var(--gray-900); color: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-2); font-size: 13px; }
    .bulk-bar[hidden] { display: none; }
    .bulk-bar form { display: flex; flex: 1; flex-wrap: wrap; gap: var(--sp-2); min-width: 0; }
    .bulk-bar input { background: rgba(255, 255, 255, .12); color: var(--surface); border-color: transparent; min-height: 32px; }
    .bulk-bar input::placeholder { color: rgba(255, 255, 255, .55); }
    .bulk-bar input:focus { background: rgba(255, 255, 255, .18); border-color: rgba(255, 255, 255, .4); box-shadow: none; }
    .bulk-reason { flex: 1 1 240px; min-width: 0; color: var(--surface); }
    .pagination { display: flex; justify-content: center; align-items: center; gap: var(--sp-3); margin-top: var(--sp-4); color: var(--gray-600); font-weight: 600; font-size: 12.5px; }

    .check-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--sp-2); border-radius: var(--r-md); padding: var(--sp-3); background: var(--gray-50); border: 0; }
    .check-item, .check-inline { display: inline-flex; align-items: center; gap: var(--sp-2); width: max-content; font-weight: 500; font-size: 13px; color: var(--ink); }
    .check-item input, .check-inline input { width: auto; min-height: auto; accent-color: var(--primary); }
    .master-list { display: grid; gap: var(--sp-2); }
    .master-row, .master-form { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto auto; gap: var(--sp-2); align-items: center; }

    .manual-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--sp-3); }
    .manual-list li { display: grid; gap: var(--sp-1); padding-bottom: var(--sp-3); border-bottom: 1px solid var(--gray-100); }
    .manual-list li:last-child { border-bottom: 0; padding-bottom: 0; }
    .manual-list strong { font-size: 13.5px; }
    .manual-list span { color: var(--gray-500); font-size: 12.5px; }
    .contact-list { margin: 0; display: grid; gap: var(--sp-2); }
    .contact-list div { display: flex; justify-content: space-between; gap: var(--sp-3); }
    .contact-list dt { color: var(--gray-500); font-size: 12.5px; font-weight: 600; }
    .contact-list dd { margin: 0; font-size: 13px; font-weight: 600; }

    .modal { border: 0; border-radius: var(--r-lg); padding: 0; width: min(440px, calc(100% - var(--sp-8))); box-shadow: var(--shadow-2); }
    .modal::backdrop { background: var(--scrim); }
    .modal-body { padding: var(--sp-5); display: grid; gap: var(--sp-4); }
    .modal-actions { display: flex; justify-content: flex-end; gap: var(--sp-2); }
    .command-palette { width: min(520px, calc(100% - var(--sp-8))); max-height: min(640px, calc(100vh - var(--sp-8))); padding: var(--sp-4); border: 0; border-radius: var(--r-lg); box-shadow: var(--shadow-2); }
    .command-palette::backdrop { background: var(--scrim); }
    .command-palette-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-3); }
    .command-palette-list { display: grid; gap: var(--sp-1); max-height: 420px; overflow-y: auto; margin-top: var(--sp-3); }
    .command-palette-list a { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); border-radius: var(--r-md); color: var(--gray-700); text-decoration: none; font-weight: 600; }
    .command-palette-list a:hover, .command-palette-list a:focus { background: var(--primary-soft); color: var(--primary); outline: 0; }
    .command-palette-list a[hidden] { display: none; }
    .command-palette > .muted { margin: var(--sp-3) 0 0; }
    .danger-text { color: var(--danger); font-size: 13px; margin: 0; }

    .app-toast { position: fixed; left: 50%; bottom: var(--sp-6); transform: translate(-50%, var(--sp-3)); z-index: 200; max-width: min(90vw, 420px); padding: var(--sp-3) var(--sp-5); border-radius: var(--r-md); background: var(--gray-800); color: var(--surface); font-weight: 600; font-size: 13px; box-shadow: var(--shadow-2); opacity: 0; transition: opacity .2s ease, transform .2s ease; pointer-events: none; }
    .app-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
    .app-toast.is-error { background: var(--danger); }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .print-only { display: none; }

    .set-doc-table td strong { white-space: nowrap; font-size: 12.5px; font-weight: 600; color: var(--primary); }
    .set-doc-table tr.is-disposed td:first-child { border-left: 3px solid var(--gray-300); }
    .set-add-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-5); }
    .set-candidate-list { display: grid; gap: var(--sp-2); }
    .set-candidate { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); border-radius: var(--r-md); padding: var(--sp-2) var(--sp-3); background: var(--gray-50); font-size: 13px; }
    .set-candidate small { display: block; color: var(--gray-500); font-size: 12px; }
    .set-candidate.is-disposed { box-shadow: inset 3px 0 0 var(--gray-300); }
    .set-danger-row { margin-top: var(--sp-5); display: flex; justify-content: flex-end; }
    .missing-document-links { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-2); }
    .missing-document-links a { color: var(--primary); font-weight: 700; }
    .lock-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--sp-3); }

    .rack-face-tabs { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
    .rack-face-tabs a { padding: var(--sp-2) var(--sp-4); border: 1px solid var(--line); border-radius: var(--r-md); color: var(--gray-600); font-weight: 700; text-decoration: none; }
    .rack-face-tabs a.active { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
    .rack-column-guide { min-width: 700px; display: flex; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-2); color: var(--gray-500); font-size: 12px; }
    .rack-column-guide strong { color: var(--gray-700); }
    .rack-grid-scroll { overflow-x: auto; padding-bottom: var(--sp-2); outline-offset: 2px; }
    .rack-digital-grid { min-width: 700px; display: grid; grid-template-columns: repeat(var(--cols), minmax(88px, 1fr)); gap: var(--sp-2); }
    .rack-cell { min-height: 76px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); overflow: hidden; }
    .rack-cell > a:first-child { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); color: var(--ink); text-decoration: none; }
    .rack-cell > a:first-child:hover, .rack-cell > a:first-child:focus-visible { background: var(--primary-soft); color: var(--primary); }
    .rack-cell span { font-size: 11px; color: var(--gray-500); }
    .rack-cell strong { font-size: 17px; color: var(--primary); }
    .rack-cell.is-empty { background: var(--gray-50); opacity: .72; }
    .rack-cell.is-selected { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); background: var(--primary-soft); opacity: 1; }
    .rack-cell-disposed { display: block; padding: 2px var(--sp-3); border-top: 1px solid var(--line); color: var(--gray-500); font-size: 11px; text-decoration: none; }

    .movement-preview { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--sp-3); padding: var(--sp-4); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--gray-50); }
    .movement-preview strong { color: var(--primary); }
    .movement-preview span:last-child { color: var(--primary); font-weight: 700; }
    .movement-history td strong { color: var(--primary); }
    .movement-filter { align-items: end; }
    .quality-strip a.warn { color: inherit; text-decoration: none; }
    .quality-issue-nav { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-4); }
    .search-index-health { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); }
    .search-index-health div { display: grid; gap: var(--sp-1); }
    .search-index-health span, .search-index-health p { color: var(--gray-500); margin: 0; }
    .search-index-health.warning { border-color: var(--warning); }
    .search-index-health.review { border-color: var(--danger); }

    mark { background: var(--primary-soft); color: var(--primary); border-radius: 2px; padding: 0; font-weight: inherit; }
`;
}
