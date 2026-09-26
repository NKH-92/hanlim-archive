// 전역 CSS의 검색 홈 조각. 순서는 styles.js에서 고정한다.

export function searchHomeStyles() {
  return `    .search-home { width: 100%; margin: 0 auto; padding-top: var(--sp-1); display: grid; gap: var(--sp-3); }
    .search-home .viewer-search-form.is-home { width: 100%; }
    .search-home .search-box input { min-height: 44px; font-size: 15px; }
    .search-home .search-results-controls { margin-top: 0; }
    .search-home-filter { padding-top: var(--sp-1); }
    .viewer-workspace.is-home { grid-template-columns: 1fr; }

    .parsed-chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); color: var(--gray-500); font-size: 12.5px; font-weight: 600; }
    .chip-panel { padding: var(--sp-3) var(--sp-5); }

    .didyoumean { display: grid; gap: var(--sp-2); margin-top: var(--sp-3); padding: var(--sp-4); background: var(--gray-50); border-radius: var(--r-md); }
    .didyoumean p { margin: 0; color: var(--gray-600); font-size: 13px; font-weight: 600; }
    .didyoumean a { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2); text-decoration: none; font-size: 13.5px; }
    .didyoumean a strong { font-weight: 600; }
    .didyoumean a:hover strong { color: var(--primary); text-decoration: underline; }
    .didyoumean a .mono { color: var(--gray-500); font-size: 12px; }
    .didyoumean a small { color: var(--gray-500); font-size: 12px; }

    @media (max-width: 760px) {
      .search-home { margin: calc(-1 * var(--sp-3)) calc(-1 * var(--sp-3)) 0; width: calc(100% + var(--sp-6)); }
    }
`;
}
