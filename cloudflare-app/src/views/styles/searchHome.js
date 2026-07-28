// 전역 CSS의 검색 홈 조각. 순서는 styles.js에서 고정한다.

export function searchHomeStyles() {
  return `    .search-home { width: 100%; margin: 0 auto; padding-top: var(--sp-1); display: grid; gap: var(--sp-3); }
    .search-home .viewer-search-form.is-home { width: 100%; }
    .search-home-hero { position: relative; display: grid; align-content: center; justify-items: stretch; gap: var(--sp-2); min-height: 160px; padding: var(--sp-5) var(--sp-6); overflow: hidden; border-radius: var(--r-lg); background: var(--hero-bg); color: var(--surface); text-align: left; }
    .search-home-hero::after { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255, 255, 255, .05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, .05) 1px, transparent 1px); background-size: var(--sp-8) var(--sp-8); pointer-events: none; }
    .search-home-copy, .search-home-hero .viewer-search-form, .search-home-hero .viewer-recents { position: relative; z-index: 1; width: min(760px, 100%); }
    .search-home-copy { display: grid; gap: var(--sp-2); }
    .search-home-copy h1 { color: var(--surface); font-size: 28px; line-height: 1.2; }
    .search-home-sub { margin: 0; color: rgba(255, 255, 255, .82); max-width: 560px; font-size: 13.5px; }
    .search-home-hero .search-box { margin-top: var(--sp-2); padding: var(--sp-1); border: 0; background: var(--surface); box-shadow: var(--shadow-1); }
    .search-home-hero .search-box button { min-height: 44px; background: var(--action); color: var(--action-ink); }
    .search-home-hero .search-box button:hover { background: var(--action-strong); }
    .search-home-hero .viewer-recents { color: rgba(255, 255, 255, .82); }
    .search-home-hero .viewer-recents .chip { background: rgba(255, 255, 255, .12); border-color: transparent; color: var(--surface); }
    .search-home .search-box input { min-height: 44px; font-size: 15px; }
    .search-home .viewer-recents { justify-content: flex-start; }
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
      .search-home-hero { min-height: 0; padding: var(--sp-6) var(--sp-4) var(--sp-5); border-radius: 0 0 var(--r-lg) var(--r-lg); }
      .search-home-copy h1 { font-size: 24px; }
      .search-home-copy .search-home-sub { display: none; }
      .search-home-hero .search-box { margin-top: var(--sp-3); }
      .search-home-hero .viewer-recents { margin-top: var(--sp-2); }
    }
`;
}
