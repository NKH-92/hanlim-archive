// 공개 랜딩에만 적용하는 토큰과 구성. 업무 화면의 밀도와 색상 계약은 유지한다.
export function landingStyles() {
  return `    html:has(.landing-page), body:has(.landing-page) { overflow-x: clip; }
    .landing-main { min-height: 100vh; background: var(--surface); }
    .landing-page {
      --landing-width: 1200px;
      --landing-gutter: 32px;
      --landing-section-space: 112px;
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
      --landing-motion: 160ms ease;
      color: var(--gray-900); background: var(--surface); font-size: 1rem;
    }
    .landing-page a { text-decoration: none; }
    .landing-page :is(a, button, summary):focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
    .landing-page :is(h1, h2, h3, p) { word-break: keep-all; overflow-wrap: break-word; }
    .landing-container { width: min(var(--landing-width), calc(100% - var(--landing-gutter) * 2)); margin-inline: auto; }
    .landing-page section, .landing-page #top { scroll-margin-top: calc(var(--landing-header-height) + var(--sp-6)); }

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

    .landing-hero { position: relative; isolation: isolate; overflow: hidden; padding: 72px 0 56px; background: radial-gradient(circle at 80% 34%, var(--primary-soft), transparent 40%), linear-gradient(110deg, var(--surface) 30%, var(--gray-50)); }
    .landing-hero-grid { display: grid; grid-template-columns: minmax(0, .86fr) minmax(0, 1.24fr); align-items: center; gap: 40px; min-height: 580px; }
    .landing-hero-copy { position: relative; z-index: 2; min-width: 0; }
    .landing-kicker { margin: 0 0 var(--sp-6); color: var(--gray-600); font-size: var(--landing-small); font-weight: 600; }
    .landing-hero h1 { margin: 0; font-size: clamp(3rem, 4.4vw, 4rem); font-weight: 800; line-height: 1.18; letter-spacing: -.055em; }
    .landing-hero h1 > span { color: var(--primary); }
    .landing-lead { margin: var(--sp-6) 0 0; color: var(--gray-500); font-size: var(--landing-body); line-height: 1.8; }
    .landing-hero-actions { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--sp-8); }
    .landing-page .landing-primary-cta, .landing-page .landing-secondary-cta { display: inline-flex; justify-content: center; align-items: center; gap: var(--sp-5); min-height: var(--landing-control-height); padding: var(--sp-3) var(--sp-6); border: 0; border-radius: var(--landing-control-radius); font-size: 1rem; font-weight: 650; transition: background var(--landing-motion), transform var(--landing-motion); }
    .landing-page .landing-primary-cta { color: var(--surface); background: var(--primary); }
    .landing-page .landing-primary-cta:hover { background: var(--primary-strong); }
    .landing-page .landing-secondary-cta { color: var(--gray-700); background: var(--gray-100); }
    .landing-page .landing-secondary-cta:hover { background: var(--gray-200); }
    .landing-page :is(.landing-primary-cta, .landing-secondary-cta):active { transform: translateY(1px); }
    .landing-account-note { margin: var(--sp-4) 0 0; color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-hero-stage { position: relative; min-width: 0; height: 580px; }
    .landing-hero-rack { position: absolute; top: 0; right: -56px; width: 720px; max-width: none; height: auto; mix-blend-mode: multiply; filter: saturate(.84); mask-image: linear-gradient(90deg, transparent, rgba(255, 255, 255, .92) 9%, rgba(255, 255, 255, .92) 92%, transparent), linear-gradient(180deg, transparent, rgba(255, 255, 255, .92) 8%, rgba(255, 255, 255, .92) 88%, transparent); mask-composite: intersect; }
    .landing-hero-stage::after { content: ''; position: absolute; right: 76px; top: 316px; width: 88px; height: 76px; border-right: 1px dashed var(--primary); border-bottom: 1px dashed var(--primary); opacity: .5; pointer-events: none; }
    .landing-hero-preview { position: absolute; z-index: 1; left: 0; bottom: 0; width: min(432px, 100%); box-shadow: var(--shadow-2); }
    .landing-hero-preview .landing-window-bar { min-height: 48px; padding-block: var(--sp-3); background: var(--surface); color: var(--gray-800); border-bottom: 1px solid var(--line); }
    .landing-hero-preview .landing-window-brand i { color: var(--primary); }
    .landing-hero-preview .landing-window-user { color: var(--gray-500); }
    .landing-hero-preview .landing-window-body { padding: var(--sp-4); }
    .landing-hero-preview .landing-demo-list-title { margin-block: var(--sp-4) var(--sp-2); }
    .landing-hero-preview .landing-demo-row { padding: var(--sp-3); }
    .landing-hero-preview .landing-window-foot { margin-top: var(--sp-3); padding-top: var(--sp-3); }
    .landing-hero-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-8); margin: 0; padding: var(--sp-8) 0; border-top: 0; }
    .landing-hero-facts div { min-width: 0; }
    .landing-hero-facts div + div { padding-left: var(--sp-8); border-left: 1px solid var(--line); }
    .landing-hero-facts dt { font-size: 1rem; font-weight: 700; }
    .landing-hero-facts dd { margin: var(--sp-2) 0 0; color: var(--gray-500); font-size: var(--landing-small); word-break: keep-all; }

    .landing-product-window, .landing-feature-visual { min-width: 0; border: 1px solid var(--line); border-radius: var(--landing-radius); background: var(--surface); }
    .landing-product-window { box-shadow: var(--shadow-1); }
    .landing-window-bar { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); min-height: 64px; padding: var(--sp-4) var(--sp-6); border-radius: calc(var(--landing-radius) - 1px) calc(var(--landing-radius) - 1px) 0 0; background: var(--primary-deep); color: var(--surface); }
    .landing-window-brand { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--landing-small); font-weight: 700; }
    .landing-window-user { font-size: var(--landing-caption); color: var(--gray-200); }
    .landing-window-body { padding: var(--sp-6); }
    .landing-demo-search, .landing-search-query { display: flex; align-items: center; gap: var(--sp-3); min-height: var(--landing-control-height); padding: var(--sp-3) var(--sp-4); border-radius: var(--landing-control-radius); background: var(--gray-50); color: var(--gray-500); font-size: var(--landing-small); }
    .landing-demo-list-title { display: flex; justify-content: space-between; gap: var(--sp-4); margin: var(--sp-6) 0 var(--sp-3); color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-demo-list-title strong { font-weight: 600; }
    .landing-demo-table { display: grid; }
    .landing-demo-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--sp-4); align-items: center; padding: var(--sp-4) var(--sp-3); border-bottom: 1px solid var(--line); }
    .landing-demo-row:last-child { border-bottom: 0; }
    .landing-demo-row > span { display: grid; gap: var(--sp-1); min-width: 0; }
    .landing-demo-row strong { font-size: var(--landing-small); font-weight: 650; }
    .landing-demo-row small { font-size: var(--landing-caption); color: var(--gray-500); }
    .landing-demo-row.is-selected { border-radius: var(--r-lg); border-bottom-color: transparent; background: var(--primary-soft); }
    .landing-demo-location { text-align: right; font-variant-numeric: tabular-nums; }
    .landing-demo-location b { color: var(--gray-700); font-size: var(--landing-caption); font-weight: 650; }
    .landing-demo-row.is-selected .landing-demo-location b { color: var(--primary); }
    .landing-window-foot { display: flex; align-items: center; justify-content: center; gap: var(--sp-2); margin-top: var(--sp-5); padding-top: var(--sp-4); border-top: 1px solid var(--line); color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-window-foot i { color: var(--primary); }

    .landing-section { padding: var(--landing-section-space) 0; }
    .landing-section-soft { background: var(--gray-50); }
    .landing-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); gap: var(--landing-gap); align-items: center; }
    .landing-split-reverse { grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); }
    .landing-copy-block h2, .landing-section-heading h2, .landing-login-copy h2 { margin: 0; font-size: var(--landing-title); font-weight: 750; line-height: 1.35; letter-spacing: -.025em; text-wrap: balance; }
    .landing-copy-block > p, .landing-section-heading > p { margin: var(--sp-6) 0 0; color: var(--gray-500); font-size: var(--landing-body); line-height: 1.8; }
    .landing-check-list { display: grid; gap: var(--sp-6); margin: var(--sp-8) 0 0; padding: 0; list-style: none; }
    .landing-check-list li { display: flex; align-items: flex-start; gap: var(--sp-4); color: var(--gray-500); font-size: var(--landing-small); }
    .landing-check-list i { flex: 0 0 20px; height: 20px; margin-top: var(--sp-1); color: var(--primary); }
    .landing-check-list strong { display: block; margin-bottom: var(--sp-1); color: var(--gray-800); font-weight: 650; }
    .landing-feature-visual { padding: var(--sp-8); }
    .landing-visual-label { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-6); }
    .landing-visual-label > span { font-size: 1rem; font-weight: 700; }
    .landing-visual-label > small { font-size: var(--landing-caption); color: var(--gray-500); }
    .landing-search-query { background: var(--primary-soft); color: var(--primary); }
    .landing-search-query strong { color: var(--gray-800); font-weight: 650; }
    .landing-filter-line { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: var(--sp-4) 0 var(--sp-5); }
    .landing-filter-line b { padding: var(--sp-1) var(--sp-3); border-radius: 999px; background: var(--gray-100); color: var(--gray-600); font-size: var(--landing-caption); font-weight: 500; }
    .landing-result-list { display: grid; }
    .landing-result-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--sp-4); padding: var(--sp-5) 0; border-bottom: 1px solid var(--line); }
    .landing-result-item:last-child { border-bottom: 0; padding-bottom: 0; }
    .landing-result-item > span { display: grid; gap: var(--sp-2); }
    .landing-result-item strong { font-size: var(--landing-small); font-weight: 650; }
    .landing-result-item small, .landing-result-item > b { font-size: var(--landing-caption); color: var(--gray-500); font-weight: 500; }
    .landing-result-item mark { background: var(--primary-soft); color: var(--primary-strong); }

    .landing-location-visual { background: var(--gray-50); border-color: transparent; }
    .landing-location-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--sp-4); margin-bottom: var(--sp-8); }
    .landing-location-head > span { display: grid; gap: var(--sp-2); }
    .landing-location-head small { color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-location-head strong { font-size: 1.25rem; }
    .landing-location-head > b { padding: var(--sp-2) var(--sp-3); border-radius: var(--r-md); background: var(--action-soft); color: var(--action-ink); font-size: var(--landing-small); }
    .landing-rack-diagram { display: grid; gap: var(--sp-2); }
    .landing-rack-columns, .landing-rack-row { display: grid; grid-template-columns: 40px repeat(7, minmax(0, 1fr)); gap: var(--sp-2); align-items: center; }
    .landing-rack-columns span { color: var(--gray-500); font-size: var(--landing-caption); text-align: center; }
    .landing-rack-row small { color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-rack-row > span { display: grid; place-items: center; min-height: 36px; border: 1px solid var(--line); border-bottom: 3px solid var(--gray-300); border-radius: var(--r-sm); background: var(--surface); font-size: var(--landing-caption); font-weight: 700; }
    .landing-rack-row > .is-hit { border-color: var(--action-strong); background: var(--action); color: var(--action-ink); }
    .landing-rack-axis { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--sp-2); margin-top: var(--sp-5); color: var(--gray-500); font-size: var(--landing-caption); }
    .landing-inline-note { display: flex; align-items: flex-start; gap: var(--sp-4); margin-top: var(--sp-8); color: var(--gray-500); font-size: var(--landing-small); line-height: 1.7; }
    .landing-inline-note i { padding-top: var(--sp-1); color: var(--primary); }
    .landing-inline-note strong { display: block; margin-bottom: var(--sp-1); color: var(--gray-800); font-weight: 650; }

    .landing-section-heading { max-width: 720px; margin-bottom: var(--landing-gap); }
    .landing-workflow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-8); margin: 0; padding: 0; list-style: none; }
    .landing-workflow li { position: relative; padding-top: var(--sp-6); border-top: 2px solid var(--line); }
    .landing-workflow li::before { content: ''; position: absolute; top: -2px; left: 0; width: 24px; border-top: 2px solid var(--primary); }
    .landing-workflow li > span { display: block; margin-bottom: var(--sp-6); color: var(--primary); font-size: var(--landing-small); font-weight: 650; font-variant-numeric: tabular-nums; }
    .landing-workflow li > strong { font-size: 1.25rem; font-weight: 700; }
    .landing-workflow li > p { max-width: 260px; margin: var(--sp-3) 0 0; color: var(--gray-500); font-size: var(--landing-small); line-height: 1.8; }
    .landing-control-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--landing-gap); }
    .landing-control-icon { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: var(--sp-6); border-radius: var(--landing-control-radius); background: var(--gray-100); color: var(--gray-700); font-size: 1.125rem; }
    .landing-control-grid h3 { font-size: 1.125rem; font-weight: 700; }
    .landing-control-grid p { margin: var(--sp-3) 0 0; color: var(--gray-500); font-size: var(--landing-small); line-height: 1.8; }
    .landing-source-principle { margin-top: var(--landing-gap); padding: var(--sp-6) var(--sp-8); border-radius: var(--r-lg); background: var(--gray-50); }
    .landing-source-principle strong { display: block; color: var(--gray-700); font-size: var(--landing-small); font-weight: 650; }
    .landing-source-principle p { margin: var(--sp-2) 0 0; color: var(--gray-500); font-size: var(--landing-small); line-height: 1.7; }

    .landing-login-section { padding: var(--landing-section-space) 0; background: var(--primary-deep); color: var(--surface); }
    .landing-login-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px); align-items: center; gap: var(--landing-gap); }
    .landing-login-copy > p { margin: var(--sp-6) 0 0; color: var(--gray-200); font-size: var(--landing-body); line-height: 1.8; }
    .landing-login-signature { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--landing-gap); color: var(--gray-200); font-size: var(--landing-small); }
    .landing-login-signature > span + span { padding-left: var(--sp-3); border-left: 1px solid var(--gray-500); }
    .landing-login-card.login-panel { width: 100%; padding: var(--sp-8); border-radius: var(--landing-radius); background: var(--surface); color: var(--gray-900); }
    .landing-login-card .login-logo { width: 48px; height: 36px; object-fit: contain; margin: 0 0 var(--sp-6); filter: none; }
    .landing-login-card .landing-login-title h2 { margin: 0; font-size: 1.5rem; font-weight: 700; }
    .landing-login-title p { margin: var(--sp-2) 0 var(--sp-8); color: var(--gray-500); font-size: var(--landing-small); }
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
      .landing-hero-grid, .landing-split, .landing-split-reverse { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .landing-hero-rack { width: 620px; right: -52px; top: 24px; }
      .landing-hero-preview { width: min(390px, 100%); }
      .landing-feature-visual { padding: var(--sp-6); }
      .landing-demo-row { grid-template-columns: minmax(0, 1fr); gap: var(--sp-2); }
      .landing-demo-row .landing-demo-location { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2); text-align: left; }
      .landing-demo-list-title > span { display: none; }
    }
    @media (max-width: 900px) {
      .landing-nav { display: none; }
      .landing-hero-grid, .landing-split, .landing-split-reverse, .landing-login-grid { grid-template-columns: minmax(0, 1fr); }
      .landing-hero-copy, .landing-copy-block { max-width: 640px; }
      .landing-hero-stage { height: 580px; width: 100%; max-width: 700px; margin-inline: auto; }
      .landing-hero-rack { width: 100%; right: 0; top: 0; }
      .landing-product-window, .landing-feature-visual { width: 100%; max-width: 640px; }
      .landing-split-reverse .landing-copy-block { order: -1; }
      .landing-demo-row { grid-template-columns: minmax(0, 1fr) auto; }
      .landing-demo-row .landing-demo-location { display: grid; text-align: right; gap: var(--sp-1); }
      .landing-demo-list-title > span { display: block; }
      .landing-workflow { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: var(--landing-gap); }
      .landing-control-grid { gap: var(--sp-8); }
      .landing-login-card.login-panel { max-width: 560px; }
      .landing-login-signature { display: none; }
    }
    @media (max-width: 600px) {
      .landing-page { --landing-gutter: 20px; --landing-section-space: 64px; --landing-gap: 32px; --landing-display: 2.25rem; --landing-title: 1.875rem; --landing-header-height: 64px; }
      .landing-header-inner { gap: var(--sp-3); }
      .landing-brand-logo { width: 36px; height: 28px; }
      .landing-brand small { display: none; }
      .landing-page .landing-header-login { padding-inline: var(--sp-4); }
      .landing-hero h1 { font-size: clamp(2.2rem, 9.5vw, 3rem); }
      .landing-hero-stage { height: auto; display: flex; flex-direction: column; gap: var(--sp-3); }
      .landing-hero-rack { position: relative; top: auto; right: auto; width: 100%; max-width: 100%; }
      .landing-hero-preview { position: relative; left: auto; bottom: auto; width: 100%; }
      .landing-hero-stage::after { display: none; }
      .landing-hero-preview .landing-demo-row { grid-template-columns: minmax(0, 1fr); gap: var(--sp-2); }
      .landing-hero-preview .landing-demo-location { display: flex; flex-wrap: wrap; gap: var(--sp-2); text-align: left; }
      .landing-hero-actions { display: grid; grid-template-columns: minmax(0, 1fr); }
      .landing-hero-facts { grid-template-columns: minmax(0, 1fr); gap: var(--sp-5); padding-block: var(--sp-8); }
      .landing-hero-facts div { display: grid; gap: var(--sp-1); }
      .landing-hero-facts div + div { border-left: 0; padding-left: 0; }
      .landing-hero-facts dt, .landing-hero-facts dd { font-size: var(--landing-small); }
      .landing-hero-facts dd { margin: 0; }
      .landing-window-body, .landing-feature-visual { padding: var(--sp-5); }
      .landing-window-bar { padding-inline: var(--sp-5); }
      .landing-demo-row { grid-template-columns: minmax(0, 1fr); padding-inline: var(--sp-3); }
      .landing-demo-row .landing-demo-location { display: flex; flex-wrap: wrap; gap: var(--sp-2); text-align: left; }
      .landing-demo-list-title > span { display: none; }
      .landing-result-item { grid-template-columns: minmax(0, 1fr); gap: var(--sp-2); }
      .landing-rack-columns, .landing-rack-row { grid-template-columns: 36px repeat(7, minmax(0, 1fr)); gap: var(--sp-1); }
      .landing-rack-row > span { min-height: 32px; }
      .landing-rack-row > .is-hit { font-size: 0; }
      .landing-rack-row > .is-hit::after { content: '●'; font-size: var(--landing-caption); }
      .landing-rack-axis { flex-direction: column; }
      .landing-workflow { grid-template-columns: minmax(0, 1fr); gap: var(--sp-6); }
      .landing-workflow li { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: var(--sp-2) var(--sp-4); padding-top: var(--sp-5); }
      .landing-workflow li > span { margin: 0; padding-top: var(--sp-1); }
      .landing-workflow li > p { grid-column: 2; max-width: none; margin: 0; }
      .landing-control-grid { grid-template-columns: minmax(0, 1fr); }
      .landing-control-grid article { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: var(--sp-2) var(--sp-4); }
      .landing-control-icon { grid-row: span 2; margin: 0; }
      .landing-control-grid p { grid-column: 2; margin: 0; }
      .landing-source-principle { padding: var(--sp-5); }
      .landing-login-card.login-panel { padding: var(--sp-6); }
      .landing-footer .landing-container { align-items: flex-start; flex-direction: column; gap: var(--sp-2); }
    }
    @media (prefers-reduced-motion: reduce) {
      .landing-page *, .landing-page *::before, .landing-page *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
    }`;
}
