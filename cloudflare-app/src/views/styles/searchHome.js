// 전역 CSS의 검색 홈 조각. 순서는 styles.js에서 고정한다.

export function searchHomeStyles() {
  return `    .search-home { width: 100%; margin: 0 auto; padding-top: var(--sp-1); display: grid; gap: var(--sp-3); }
    .search-home .viewer-search-form.is-home { width: 100%; }
    .home-floor-plan { width: 100%; }
    .search-home-hero { display: grid; gap: var(--sp-2); justify-items: center; text-align: center; }
    .search-home-mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: var(--r-lg); background: var(--primary); color: var(--surface); font-size: 20px; }
    .search-home-hero h1 { font-size: 22px; }
    .search-home-sub { margin: 0; color: var(--gray-500); font-size: 13.5px; }
    .search-home .search-box input { min-height: 44px; font-size: 15px; }
    .search-home .viewer-recents { justify-content: flex-start; }
    .search-home-extras { display: grid; gap: var(--sp-4); }
    .search-home-links { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-2); }
    .search-home-links a { display: inline-flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-4); border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--gray-600); font-size: 12.5px; font-weight: 600; text-decoration: none; transition: background .15s ease, color .15s ease, border-color .15s ease; }
    .search-home-links a:hover { background: var(--primary-soft); border-color: var(--primary-soft); color: var(--primary); }
    .search-home-links a i { font-size: .9em; }
    .viewer-workspace.is-home { grid-template-columns: 1fr; }

    .parsed-chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); color: var(--gray-500); font-size: 12.5px; font-weight: 600; }
    .chip-panel { padding: var(--sp-3) var(--sp-5); }

    .answer-card { display: grid; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5); margin: var(--sp-2) 0 var(--sp-4); background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--primary); border-radius: var(--r-lg); }
    .answer-head { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
    .answer-label { color: var(--gray-500); font-size: 12px; font-weight: 600; }
    .answer-grade { font-size: 11px; font-weight: 700; padding: 2px var(--sp-2); border-radius: 999px; }
    .answer-grade.certain { background: var(--success-soft); color: var(--success); }
    .answer-grade.likely { background: var(--warning-soft); color: var(--warning); }
    .answer-loc { font-family: var(--font-mono); font-size: 22px; font-weight: 700; line-height: 1.25; color: var(--primary); letter-spacing: -.01em; }
    .answer-loc span { display: inline-block; margin-left: var(--sp-3); color: var(--gray-900); }
    .answer-doc { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
    .answer-doc > a { font-weight: 700; font-size: 15px; text-decoration: none; }
    .answer-doc > a:hover { color: var(--primary); text-decoration: underline; }
    .answer-meta { width: 100%; display: flex; flex-wrap: wrap; gap: var(--sp-3); color: var(--gray-500); font-size: 12.5px; }
    .answer-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
    .rest-label { margin: 0 0 var(--sp-2); color: var(--gray-600); font-size: 12px; font-weight: 600; }

    .didyoumean { display: grid; gap: var(--sp-2); margin-top: var(--sp-3); padding: var(--sp-4); background: var(--gray-50); border-radius: var(--r-md); }
    .didyoumean p { margin: 0; color: var(--gray-600); font-size: 13px; font-weight: 600; }
    .didyoumean a { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2); text-decoration: none; font-size: 13.5px; }
    .didyoumean a strong { font-weight: 600; }
    .didyoumean a:hover strong { color: var(--primary); text-decoration: underline; }
    .didyoumean a .mono { color: var(--gray-500); font-size: 12px; }
    .didyoumean a small { color: var(--gray-500); font-size: 12px; }
`;
}
