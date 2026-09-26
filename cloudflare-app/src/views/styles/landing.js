// 공개 랜딩에만 적용하는 토큰과 구성. 업무 화면의 밀도와 색상 계약은 유지한다.
export function landingStyles() {
  return `    html:has(.landing-page), body:has(.landing-page) { overflow-x: clip; }
    .landing-main { min-height: 100vh; background: var(--surface); }
    .landing-page {
      --landing-width: 1200px;
      --landing-hero-width: 1600px;
      --landing-hero-min: 600px;
      --landing-gutter: 32px;
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
      --landing-login-width: 480px;
      --landing-reel-width: 1040px;
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
    .landing-page .landing-secondary-cta { gap: var(--sp-3); color: var(--gray-700); background: var(--gray-100); }
    .landing-page .landing-secondary-cta:hover { background: var(--gray-200); }
    .landing-page :is(.landing-primary-cta, .landing-secondary-cta):active { transform: translateY(1px); }

    .landing-reel { width: min(var(--landing-hero-width), calc(100% - var(--sp-4) * 2)); margin: var(--sp-4) auto; padding: var(--landing-gap) 0; border-radius: var(--landing-radius); background: var(--primary-deep); color: var(--surface); }
    .landing-reel-inner { width: min(var(--landing-reel-width), calc(100% - var(--landing-gutter) * 2)); margin-inline: auto; }
    .landing-reel-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--sp-2) var(--sp-6); margin-bottom: var(--sp-6); }
    .landing-reel-head h2 { margin: 0; font-size: 1.5rem; font-weight: 750; line-height: 1.35; }
    .landing-reel-head p { margin: 0; color: rgba(255, 255, 255, .6); font-size: var(--landing-small); }
    .landing-reel-stage { position: relative; }
    .landing-reel-frame { position: relative; overflow: hidden; aspect-ratio: 16 / 9; border: 1px solid rgba(255, 255, 255, .12); border-radius: var(--landing-control-radius); background: var(--gray-900); }
    .landing-reel-video { display: block; width: 100%; height: 100%; background: var(--gray-900); }
    .landing-page .landing-reel-play { position: absolute; left: 8%; top: 64%; gap: var(--sp-3); min-height: var(--landing-control-height); padding: var(--sp-1) var(--sp-5) var(--sp-1) var(--sp-1); border: 0; border-radius: 999px; background: var(--surface); color: var(--gray-900); font-size: 1rem; font-weight: 700; }
    .landing-page .landing-reel-play:hover { background: var(--gray-100); }
    .landing-reel-play-icon { display: grid; place-items: center; width: var(--touch-height); height: var(--touch-height); border-radius: 999px; background: var(--action); color: var(--action-ink); }
    .landing-reel-play small { color: var(--gray-500); font-size: var(--landing-small); font-weight: 600; }
    .landing-reel-end { position: absolute; top: 67%; left: 0; right: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-3); padding-inline: var(--sp-4); }
    .landing-page .landing-reel-replay { min-height: var(--landing-control-height); padding: var(--sp-3) var(--sp-6); border-radius: var(--landing-control-radius); font-size: 1rem; font-weight: 650; }
    .landing-reel-chapters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-5); margin: var(--sp-6) 0 0; padding: 0; list-style: none; }
    .landing-page .landing-reel-chapter { display: grid; grid-template-columns: minmax(0, 1fr); justify-content: stretch; justify-items: start; align-content: start; gap: var(--sp-2); width: 100%; min-height: var(--touch-height); padding: 0 0 var(--sp-2); border: 0; border-radius: 0; background: transparent; color: rgba(255, 255, 255, .82); font-weight: 600; text-align: left; white-space: normal; }
    .landing-page .landing-reel-chapter:hover { background: transparent; color: var(--surface); }
    .landing-reel-bar { justify-self: stretch; height: 4px; margin-bottom: var(--sp-2); border-radius: 999px; background: rgba(255, 255, 255, .18); transition: background var(--landing-motion); }
    .landing-reel-chapter:hover .landing-reel-bar { background: rgba(255, 255, 255, .4); }
    .landing-reel-chapter.is-played .landing-reel-bar { background: rgba(255, 255, 255, .6); }
    .landing-reel-chapter[aria-current="true"] { color: var(--surface); }
    .landing-reel-chapter[aria-current="true"] .landing-reel-bar { background: var(--action); }
    .landing-reel-chapter-meta { color: rgba(255, 255, 255, .6); font-size: var(--landing-caption); font-weight: 500; }
    .landing-reel-chapter-meta b { font-weight: 700; }
    .landing-reel-chapter[aria-current="true"] .landing-reel-chapter-meta b { color: var(--action); }
    .landing-reel-chapter-line { font-size: 1rem; font-weight: 650; line-height: 1.5; }
    .landing-page :is(.landing-reel-play, .landing-reel-chapter):focus-visible { outline-color: var(--action); }

    .landing-login-section { padding: var(--landing-gap) 0; background: var(--gray-50); }
    .landing-login-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, var(--landing-login-width)); align-items: center; gap: var(--landing-gap); }
    .landing-login-copy h2 { margin: 0; font-size: var(--landing-title); font-weight: 750; line-height: 1.35; letter-spacing: -.025em; text-wrap: balance; }
    .landing-source-note { margin: var(--sp-6) 0 0; color: var(--gray-500); font-size: var(--landing-small); line-height: 1.8; }
    .landing-source-note strong { display: block; margin-bottom: var(--sp-1); color: var(--gray-800); font-size: 1rem; font-weight: 650; }
    .landing-login-signature { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--landing-gap); color: var(--gray-500); font-size: var(--landing-small); }
    .landing-login-signature > span + span { padding-left: var(--sp-3); border-left: 1px solid var(--gray-300); }
    .landing-login-card.login-panel { width: 100%; padding: var(--sp-8); border: 1px solid var(--line); border-radius: var(--landing-radius); background: var(--surface); color: var(--gray-900); }

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
      .landing-page { --landing-gap: 48px; --landing-display: 3rem; }
      .landing-hero-grid { padding-inline: var(--sp-8); }
    }
    @media (max-width: 900px) {
      .landing-hero-grid { width: 100%; min-height: 0; aspect-ratio: auto; grid-template-columns: minmax(0, 1fr); gap: var(--sp-6); padding: var(--sp-6) 0 var(--sp-8); border-radius: 0; }
      .landing-hero-heading, .landing-hero-details { width: min(560px, calc(100% - var(--landing-gutter) * 2)); margin-inline: auto; }
      .landing-hero-art { position: relative; inset: auto; width: min(560px, calc(100% - var(--sp-4) * 2)); margin-inline: auto; aspect-ratio: 1122 / 1402; overflow: hidden; border-radius: var(--landing-control-radius); }
      .landing-hero-details .landing-lead { margin-top: 0; }
      .landing-reel { width: 100%; margin: 0; border-radius: 0; }
      .landing-page .landing-reel-end :is(.landing-primary-cta, .landing-reel-replay) { min-height: var(--touch-height); padding-block: var(--sp-2); }

      .landing-login-grid { grid-template-columns: minmax(0, 1fr); gap: var(--sp-6); }
      .landing-login-card.login-panel { max-width: var(--landing-login-width); margin-inline: auto; }
      .landing-login-copy { order: 2; width: 100%; max-width: var(--landing-login-width); margin-inline: auto; }
      .landing-login-copy > h2, .landing-login-signature { display: none; }
      .landing-source-note { margin-top: 0; }
    }
    @media (max-width: 600px) {
      .landing-page { --landing-gutter: 20px; --landing-gap: 32px; --landing-display: 2.25rem; --landing-title: 1.875rem; --landing-header-height: 64px; }
      .landing-header-inner { gap: var(--sp-3); }
      .landing-brand-logo { width: 36px; height: 28px; }
      .landing-brand small { display: none; }
      .landing-page .landing-header-login { padding-inline: var(--sp-4); }
      .landing-hero h1 { font-size: var(--landing-display); }
      .landing-hero { padding: 0; }
      .landing-kicker { margin-bottom: var(--sp-4); }
      .landing-lead { margin-top: var(--sp-5); }
      .landing-hero-actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-1); margin-top: var(--sp-6); }
      .landing-page .landing-secondary-cta { background: transparent; min-height: 44px; }
      .landing-reel-head { margin-bottom: var(--sp-5); }
      .landing-reel-head h2 { font-size: 1.25rem; }
      .landing-page .landing-reel-play { top: auto; bottom: var(--sp-3); left: var(--sp-3); gap: var(--sp-2); min-height: var(--touch-height); padding-right: var(--sp-4); font-size: var(--landing-small); }
      .landing-reel-play-icon { width: var(--sp-8); height: var(--sp-8); }
      .landing-reel-play small { display: none; }
      .landing-reel-end { position: static; justify-content: flex-start; margin-top: var(--sp-4); padding: 0; }
      .landing-reel-chapters { grid-template-columns: minmax(0, 1fr); gap: 0; margin-top: var(--sp-5); }
      .landing-page .landing-reel-chapter { grid-template-columns: 4px minmax(0, 1fr); column-gap: var(--sp-4); row-gap: var(--sp-1); padding: var(--sp-3) 0; }
      .landing-reel-bar { grid-row: 1 / span 2; align-self: stretch; height: auto; margin: 0; }
      .landing-reel-chapter-meta, .landing-reel-chapter-line { grid-column: 2; }
      .landing-login-card.login-panel { padding: var(--sp-6); }
      .landing-footer .landing-container { align-items: flex-start; flex-direction: column; gap: var(--sp-2); }
    }
    @media (prefers-reduced-motion: reduce) {
      .landing-page *, .landing-page *::before, .landing-page *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
    }`;
}
