// 공개 랜딩에만 적용하는 토큰과 구성. 업무 화면의 밀도와 색상 계약은 유지한다.
export function landingStyles() {
  return `    html:has(.landing-page), body:has(.landing-page) { overflow-x: clip; }
    .landing-main { min-height: 100vh; background: var(--surface); }
    .landing-page {
      --landing-width: 1200px;
      --landing-hero-width: 1600px;
      --landing-hero-min: 600px;
      --landing-gutter: 32px;
      --landing-section-space: 96px;
      --landing-gap: 64px;
      --landing-display: 3.5rem;
      --landing-title: 2.5rem;
      --landing-body: 1.0625rem;
      --landing-small: .875rem;
      --landing-caption: .75rem;
      --landing-radius: 24px;
      --landing-control-radius: 12px;
      --landing-header-height: 80px;
      --landing-control-height: 52px;
      --landing-document-title: 1.5rem;
      --landing-rack-axis-width: 40px;
      --landing-login-width: 480px;
      --landing-motion: 160ms ease;
      color: var(--gray-900); background: var(--surface); font-size: 1rem;
    }
    .landing-page a { text-decoration: none; }
    .landing-page :is(a, button, summary):focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
    .landing-page :is(h1, h2, h3, p) { word-break: keep-all; overflow-wrap: break-word; }
    .landing-container { width: min(var(--landing-width), calc(100% - var(--landing-gutter) * 2)); margin-inline: auto; }
    .landing-page section, .landing-page #top, .landing-page #login { scroll-margin-top: calc(var(--landing-header-height) + var(--sp-6)); }

    .landing-header { position: sticky; top: 0; z-index: 80; background: var(--surface); border-bottom: 1px solid var(--line); }
    .landing-header-inner { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-8); min-height: var(--landing-header-height); }
    .landing-brand { display: inline-flex; align-items: center; gap: var(--sp-3); min-height: var(--touch-height); flex-shrink: 0; }
    .landing-brand-logo { width: 44px; height: 32px; object-fit: contain; }
    .landing-brand strong, .landing-brand small { display: block; }
    .landing-brand strong { font-size: 1rem; font-weight: 750; }
    .landing-brand small { color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-nav { display: flex; gap: var(--sp-6); margin-left: auto; }
    .landing-nav a { display: inline-flex; align-items: center; min-height: var(--touch-height); padding-inline: var(--sp-2); border-radius: var(--r-md); color: var(--gray-600); font-size: var(--landing-small); font-weight: 600; transition: color var(--landing-motion), background var(--landing-motion); }
    .landing-nav a:hover { color: var(--primary); background: var(--gray-50); }
    .landing-page .landing-header-login { min-height: var(--touch-height); padding: var(--sp-2) var(--sp-5); border: 0; border-radius: var(--landing-control-radius); color: var(--primary); background: var(--primary-soft); font-size: var(--landing-small); }
    .landing-page .landing-header-login:hover { background: var(--gray-100); color: var(--primary-strong); }

    .landing-hero { padding: var(--sp-4) 0 0; background: var(--surface); }
    .landing-hero-grid { position: relative; isolation: isolate; overflow: hidden; width: min(var(--landing-hero-width), calc(100% - var(--sp-4) * 2)); display: grid; grid-template-columns: minmax(0, .4fr) minmax(0, .6fr); align-content: center; min-height: var(--landing-hero-min); aspect-ratio: 1672 / 941; padding: var(--landing-gap); border-radius: var(--landing-radius); }
    .landing-hero-heading, .landing-hero-details { position: relative; z-index: 1; grid-column: 1; min-width: 0; }
    .landing-hero-art { position: absolute; inset: 0; z-index: 0; }
    .landing-hero-rack { display: block; width: 100%; height: 100%; object-fit: cover; }
    .landing-kicker { margin: 0 0 var(--sp-6); color: var(--gray-600); font-size: var(--landing-small); font-weight: 600; }
    .landing-hero h1 { margin: 0; font-size: var(--landing-display); font-weight: 800; line-height: 1.18; letter-spacing: -.055em; }
    .landing-hero h1 > span { color: inherit; }
    .landing-lead { margin: var(--sp-6) 0 0; color: var(--gray-500); font-size: var(--landing-body); line-height: 1.8; }
    .landing-hero-actions { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--sp-8); }
    .landing-page .landing-primary-cta, .landing-page .landing-secondary-cta { display: inline-flex; justify-content: center; align-items: center; gap: var(--sp-5); min-height: var(--landing-control-height); padding: var(--sp-3) var(--sp-6); border: 0; border-radius: var(--landing-control-radius); font-size: 1rem; font-weight: 650; transition: background var(--landing-motion), transform var(--landing-motion); }
    .landing-page .landing-primary-cta { color: var(--surface); background: var(--primary); }
    .landing-page .landing-primary-cta:hover { background: var(--primary-strong); }
    .landing-page .landing-secondary-cta { color: var(--gray-700); background: var(--gray-100); }
    .landing-page .landing-secondary-cta:hover { background: var(--gray-200); }
    .landing-page :is(.landing-primary-cta, .landing-secondary-cta):active { transform: translateY(1px); }
    .landing-account-note { margin: var(--sp-4) 0 0; color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-feature-visual { min-width: 0; border: 1px solid var(--line); border-radius: var(--landing-control-radius); background: var(--surface); }

    .landing-section { padding: var(--landing-section-space) 0; }
    .landing-section-soft { background: var(--gray-50); }
    .landing-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); gap: var(--landing-gap); align-items: center; }
    .landing-search-layout { grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); }
    .landing-search-demo { min-width: 0; }
    .landing-example-link { display: flex; align-items: center; justify-content: flex-end; gap: var(--sp-3); min-height: var(--landing-control-height); margin-top: var(--sp-3); color: var(--primary); font-size: var(--landing-small); font-weight: 600; }
    .landing-split-reverse { grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); }
    .landing-copy-block h2, .landing-section-heading h2, .landing-login-copy h2 { margin: 0; font-size: var(--landing-title); font-weight: 750; line-height: 1.35; letter-spacing: -.025em; text-wrap: balance; }
    .landing-copy-block > p, .landing-section-heading > p { margin: var(--sp-6) 0 0; color: var(--gray-500); font-size: var(--landing-body); line-height: 1.8; }
    .landing-feature-visual { padding: var(--sp-8); }
    .landing-visual-label { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-6); }
    .landing-visual-label > span { font-size: 1rem; font-weight: 700; }
    .landing-visual-label > small { font-size: var(--landing-caption); color: var(--gray-500); }
    .landing-search-query { display: flex; align-items: center; gap: var(--sp-3); min-height: var(--landing-control-height); padding: var(--sp-3) var(--sp-4); border-radius: var(--landing-control-radius); background: var(--primary-soft); color: var(--primary); font-size: 1.25rem; }
    .landing-search-query strong { color: var(--gray-800); font-weight: 650; }
    .landing-filter-line { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: var(--sp-4) 0 var(--sp-5); }
    .landing-filter-line b { padding: var(--sp-1) var(--sp-3); border-radius: 999px; background: var(--gray-100); color: var(--gray-600); font-size: var(--landing-caption); font-weight: 500; }
    .landing-result-list { display: grid; }
    .landing-result-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--sp-4); padding: var(--sp-5) 0; border-bottom: 1px solid var(--line); }
    .landing-result-item.is-selected { padding: var(--sp-4); border: 0; border-left: 3px solid var(--primary); border-radius: 0; background: var(--primary-soft); }
    .landing-result-item.is-selected strong { font-size: var(--landing-document-title); }
    .landing-result-item .landing-selection-label { color: var(--primary); }
    .landing-result-item .landing-slot-label { justify-self: end; padding: var(--sp-1) var(--sp-2); background: var(--action-soft); color: var(--action-ink); font-weight: 600; }
    .landing-result-location { text-align: right; }
    .landing-result-location b { color: var(--gray-700); font-size: var(--landing-caption); font-weight: 600; }
    .landing-result-item.is-selected .landing-result-location b { color: var(--primary); }
    .landing-result-item:last-child { border-bottom: 0; padding-bottom: 0; }
    .landing-result-item > span { display: grid; gap: var(--sp-2); }
    .landing-result-item strong { font-size: var(--landing-small); font-weight: 650; }
    .landing-result-item small, .landing-result-item > b { font-size: var(--landing-caption); color: var(--gray-500); font-weight: 500; }
    .landing-result-item mark { background: transparent; color: var(--primary-strong); }

    .landing-location-visual { background: transparent; border: 0; border-radius: 0; padding-inline: 0; }
    .landing-location-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--sp-4); margin-bottom: var(--sp-8); }
    .landing-location-head > span { display: grid; gap: var(--sp-2); }
    .landing-location-head small { color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-location-head strong { font-size: 1.25rem; }
    .landing-location-head > b { padding: var(--sp-2) var(--sp-3); border-radius: var(--r-md); background: var(--action-soft); color: var(--action-ink); font-size: 1.125rem; }
    .landing-rack-diagram { display: grid; gap: 0; }
    .landing-rack-columns, .landing-rack-row { display: grid; grid-template-columns: var(--landing-rack-axis-width) repeat(7, minmax(0, 1fr)); gap: 0; align-items: center; }
    .landing-rack-columns { margin-bottom: var(--sp-3); }
    .landing-rack-columns span { color: var(--gray-500); font-size: var(--landing-caption); text-align: center; }
    .landing-rack-columns span:nth-child(5) { color: var(--gray-900); font-weight: 700; }
    .landing-rack-row { position: relative; }
    .landing-rack-row::after { content: ''; position: absolute; top: 0; bottom: 0; left: var(--landing-rack-axis-width); right: 0; border-inline: 3px solid var(--gray-300); pointer-events: none; }
    .landing-rack-row small { color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-rack-row:has(.is-hit) small { color: var(--gray-900); font-weight: 700; }
    .landing-rack-row > span { display: grid; place-items: center; min-height: 44px; border-right: 1px solid var(--line); border-bottom: 3px solid var(--gray-300); background: var(--surface); font-size: var(--landing-caption); font-weight: 700; }
    .landing-rack-columns + .landing-rack-row > span { border-top: 3px solid var(--gray-300); }
    .landing-rack-row > .is-hit { border-bottom-color: var(--action-strong); background: var(--action); color: var(--action-ink); }
    .landing-rack-axis { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--sp-2); margin-top: var(--sp-5); color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-inline-note { display: flex; align-items: flex-start; gap: var(--sp-4); margin-top: var(--sp-8); color: var(--gray-500); font-size: var(--landing-small); line-height: 1.7; }
    .landing-inline-note i { padding-top: var(--sp-1); color: var(--primary); }
    .landing-inline-note strong { display: block; margin-bottom: var(--sp-1); color: var(--gray-800); font-weight: 650; }

    .landing-workflow-layout { display: grid; gap: var(--sp-8); }
    .landing-workflow-layout .landing-section-heading { margin-bottom: 0; }
    .landing-control-section { padding-block: 72px; background: var(--gray-50); }
    .landing-control-section .landing-section-heading { margin-bottom: var(--sp-8); }
    .landing-control-section .landing-section-heading h2 { font-size: 1.875rem; }
    .landing-section-heading { max-width: 720px; margin-bottom: var(--landing-gap); }
    .landing-history { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: var(--landing-gap); border-top: 1px solid var(--line); padding-top: var(--sp-8); }
    .landing-history-current { padding: var(--sp-6); background: var(--gray-50); align-self: start; }
    .landing-history-current h3 { margin: 0; font-size: var(--landing-document-title); }
    .landing-history-current > p { margin: var(--sp-2) 0 var(--sp-6); color: var(--gray-500); font-size: var(--landing-small); }
    .landing-current-facts { margin: 0; }
    .landing-current-facts > div { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--sp-5); padding-block: var(--sp-4); border-top: 1px solid var(--line); font-size: var(--landing-small); }
    .landing-current-facts dt { color: var(--gray-500); }
    .landing-current-facts dd { margin: 0; text-align: right; font-weight: 600; }
    .landing-current-facts dd span { display: inline-block; margin-top: var(--sp-2); color: var(--gray-600); }
    .landing-history-records { min-width: 0; }
    .landing-history-records .landing-visual-label { margin-bottom: 0; }
    .landing-record-list { list-style: none; padding: 0; margin: 0; }
    .landing-record-list li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--sp-5); padding-block: var(--sp-6); border-bottom: 1px solid var(--line); }
    .landing-record-kind { padding-top: var(--sp-1); color: var(--primary); font-size: var(--landing-small); font-weight: 700; }
    .landing-record-change { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-4); margin: 0; color: var(--gray-700); font-size: 1.125rem; }
    .landing-record-change > span:not(.landing-record-arrow) { display: grid; gap: var(--sp-2); }
    .landing-record-change small { color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-record-change strong { color: var(--gray-900); }
    .landing-record-arrow { color: var(--gray-500); }
    .landing-record-note, .landing-history-retention { color: var(--gray-500); font-size: var(--landing-caption); line-height: 1.8; }
    .landing-record-note { margin: var(--sp-3) 0 0; }
    .landing-history-retention { margin: var(--sp-5) 0 0; }
    .landing-control-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--landing-gap); }
    .landing-control-grid article { padding-top: var(--sp-5); border-top: 1px solid var(--line); }
    .landing-control-grid h3 { font-size: 1.125rem; font-weight: 700; }
    .landing-control-grid p { margin: var(--sp-3) 0 0; color: var(--gray-500); font-size: var(--landing-small); line-height: 1.8; }
    .landing-source-principle { margin-top: var(--sp-8); padding: var(--sp-5) var(--sp-6); border-radius: var(--r-lg); background: var(--gray-50); }
    .landing-source-principle strong { display: block; color: var(--gray-700); font-size: var(--landing-small); font-weight: 650; }
    .landing-source-principle p { margin: var(--sp-2) 0 0; color: var(--gray-500); font-size: var(--landing-small); line-height: 1.7; }

    .landing-login-section { padding: var(--landing-gap) 0; background: var(--primary-deep); color: var(--surface); }
    .landing-login-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, var(--landing-login-width)); align-items: center; gap: var(--landing-gap); }
    .landing-login-copy > p { margin: var(--sp-6) 0 0; color: var(--gray-200); font-size: var(--landing-body); line-height: 1.8; }
    .landing-login-signature { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--landing-gap); color: var(--gray-200); font-size: var(--landing-small); }
    .landing-login-signature > span + span { padding-left: var(--sp-3); border-left: 1px solid var(--gray-500); }
    .landing-login-card.login-panel { width: 100%; padding: var(--sp-8); border-radius: var(--landing-radius); background: var(--surface); color: var(--gray-900); }

    .landing-login-brand { display: flex; align-items: center; gap: var(--sp-3); }
    .landing-login-brand .login-logo { width: 40px; height: 32px; margin: 0; object-fit: contain; }
    .landing-login-card .landing-login-title h2 { margin: 0; font-size: 1.5rem; font-weight: 700; }
    .landing-login-title p { margin: var(--sp-2) 0 var(--sp-6); color: var(--gray-500); font-size: var(--landing-small); }
    .landing-login-form { gap: var(--sp-5); }
    .landing-login-form label { display: block; color: var(--gray-700); font-size: var(--landing-small); font-weight: 600; }
    .landing-login-form input { width: 100%; min-height: var(--landing-control-height); margin-top: var(--sp-2); padding: var(--sp-3) var(--sp-4); border: 1px solid var(--line); border-radius: var(--landing-control-radius); background: var(--gray-50); color: var(--gray-900); font-size: 1rem; }
    .landing-login-form input:focus { border-color: var(--primary); outline: 2px solid var(--primary); outline-offset: 2px; background: var(--surface); }
    .landing-login-form button { width: 100%; min-height: var(--landing-control-height); margin-top: var(--sp-1); border-radius: var(--landing-control-radius); background: var(--primary); border-color: var(--primary); font-size: 1rem; transition: background var(--landing-motion); }
    .landing-login-form button:hover { background: var(--primary-strong); border-color: var(--primary-strong); }
    .landing-login-card .login-help { display: block; margin-top: var(--sp-6); padding-top: var(--sp-3); border-top: 1px solid var(--line); color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-login-card .login-help summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); min-height: var(--touch-height); cursor: pointer; list-style: none; color: var(--gray-600); font-size: var(--landing-small); font-weight: 500; }
    .landing-login-card .login-help summary::-webkit-details-marker { display: none; }
    .landing-login-card .login-help summary::after { content: '+'; flex-shrink: 0; font-size: 1.25rem; }
    .landing-login-card .login-help[open] summary::after { content: '−'; }
    .landing-login-card .login-help p { margin: var(--sp-3) 0 0; line-height: 1.8; }
    .landing-login-card .login-help .muted { color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-login-card .login-help a { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }
    .landing-login-card .alert { margin-bottom: var(--sp-4); font-size: var(--landing-small); }
    .landing-footer { padding: var(--sp-6) 0; color: var(--gray-500); background: var(--surface); }
    .landing-footer .landing-container { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); font-size: var(--landing-caption); }
    .landing-footer strong { color: var(--gray-700); }
    .landing-footer a { display: inline-flex; align-items: center; gap: var(--sp-3); min-height: var(--touch-height); }

    @media (max-width: 1100px) {
      .landing-page { --landing-gap: 48px; --landing-display: 3rem; --landing-section-space: 80px; }
      .landing-nav { gap: var(--sp-2); }
      .landing-split, .landing-split-reverse { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .landing-hero-grid { padding-inline: var(--sp-8); }
      .landing-feature-visual { padding: var(--sp-6); }
    }
    @media (max-width: 900px) {
      .landing-nav { display: none; }
      .landing-split, .landing-split-reverse, .landing-login-grid, .landing-history { grid-template-columns: minmax(0, 1fr); }
      .landing-copy-block { max-width: 640px; }
      .landing-hero-grid { width: 100%; min-height: 0; aspect-ratio: auto; grid-template-columns: minmax(0, 1fr); gap: var(--sp-6); padding: var(--sp-6) 0 var(--sp-8); border-radius: 0; }
      .landing-hero-heading, .landing-hero-details { width: min(560px, calc(100% - var(--landing-gutter) * 2)); margin-inline: auto; }
      .landing-hero-art { position: relative; inset: auto; width: min(560px, calc(100% - var(--sp-4) * 2)); margin-inline: auto; aspect-ratio: 1122 / 1402; overflow: hidden; border-radius: var(--landing-control-radius); }
      .landing-hero-rack { height: auto; }
      .landing-hero-details .landing-lead { margin-top: 0; }
      .landing-feature-visual { width: 100%; max-width: 640px; }
      .landing-split-reverse .landing-copy-block { order: -1; }

      .landing-control-grid { gap: var(--sp-8); }
      .landing-login-card.login-panel { max-width: var(--landing-login-width); margin-inline: auto; }
      .landing-login-copy { display: none; }
      .landing-login-signature { display: none; }
    }
    @media (max-width: 600px) {
      .landing-page { --landing-gutter: 20px; --landing-section-space: 64px; --landing-gap: 32px; --landing-display: 2.25rem; --landing-title: 1.875rem; --landing-header-height: 64px; }
      .landing-header-inner { gap: var(--sp-3); }
      .landing-brand-logo { width: 36px; height: 28px; }
      .landing-brand small { display: none; }
      .landing-page .landing-header-login { padding-inline: var(--sp-4); }
      .landing-hero h1 { font-size: var(--landing-display); }
      .landing-hero { padding: 0; }
      .landing-kicker { margin-bottom: var(--sp-4); }
      .landing-lead { margin-top: var(--sp-5); }
      .landing-hero-actions { margin-top: var(--sp-6); }
      .landing-feature-visual { padding: var(--sp-5); }
      .landing-result-item:not(.is-selected) { display: none; }
      .landing-result-item.is-selected { border-bottom: 0; padding-bottom: var(--sp-4); }
      .landing-hero-actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-1); }
      .landing-page .landing-secondary-cta { background: transparent; min-height: 44px; }
      .landing-result-item { grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); }
      .landing-result-item .landing-result-location { display: flex; flex-wrap: wrap; gap: var(--sp-2); text-align: left; }
      .landing-rack-diagram { --landing-rack-axis-width: 36px; }
      .landing-rack-row > span { min-height: 36px; }
      .landing-rack-row > .is-hit { font-size: 0; }
      .landing-rack-row > .is-hit::after { content: '●'; font-size: var(--landing-caption); }
      .landing-rack-axis { flex-direction: column; }
      .landing-history { gap: var(--sp-8); }
      .landing-history-current { padding: var(--sp-5); }
      .landing-record-list li { gap: var(--sp-3); }
      .landing-record-change { gap: var(--sp-3); font-size: 1rem; }
      .landing-example-link { justify-content: flex-start; }
      .landing-control-section { padding-block: 48px; }
      .landing-control-section .landing-section-heading h2 { font-size: 1.5rem; }
      .landing-control-grid { grid-template-columns: minmax(0, 1fr); gap: var(--sp-5); }
      .landing-source-principle { padding: var(--sp-5); }
      .landing-login-card.login-panel { padding: var(--sp-6); }
      .landing-footer .landing-container { align-items: flex-start; flex-direction: column; gap: var(--sp-2); }
    }
    @media (prefers-reduced-motion: reduce) {
      .landing-page *, .landing-page *::before, .landing-page *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
    }`;
}
