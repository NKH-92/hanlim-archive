// 인증 전 랜딩 페이지 전용 스타일. 업무 화면의 고밀도 UI와 분리해 제품 소개 흐름을 만든다.

export function landingStyles() {
  return `    .landing-main { min-height: 100vh; background: var(--surface); }
    .landing-page { --landing-blue: var(--primary); --landing-ink: var(--gray-900); --landing-muted: var(--gray-500); --landing-line: var(--line); --landing-soft: var(--gray-50); min-height: 100vh; background: var(--surface); color: var(--landing-ink); font-size: 16px; }
    .landing-page a { text-decoration: none; }
    .landing-container { width: min(1180px, calc(100% - 48px)); margin: 0 auto; }
    .landing-section, .landing-login-section { scroll-margin-top: 82px; }

    .landing-header { position: sticky; top: 0; z-index: 80; min-height: 76px; border-bottom: 1px solid var(--line); background: var(--surface); }
    .landing-header-inner { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 32px; min-height: 76px; }
    .landing-brand { display: inline-flex; align-items: center; gap: 10px; width: max-content; color: var(--landing-ink); }
    .landing-brand-logo { display: block; width: 50px; height: 38px; object-fit: contain; }
    .landing-brand span, .landing-brand strong, .landing-brand small { display: block; }
    .landing-brand strong { font-size: 15px; line-height: 1.25; letter-spacing: -.01em; }
    .landing-brand small { margin-top: 2px; color: var(--gray-400); font-size: 9px; font-weight: 800; letter-spacing: .12em; }
    .landing-nav { display: flex; align-items: center; justify-content: center; gap: 30px; }
    .landing-nav a { color: var(--gray-500); font-size: 13.5px; font-weight: 700; transition: color .16s ease; }
    .landing-nav a:hover { color: var(--landing-ink); }
    .landing-page .landing-header-login { min-height: 42px; padding: 0 18px; border-radius: 12px; background: var(--gray-900); border-color: var(--gray-900); color: var(--surface); font-size: 13.5px; }
    .landing-page .landing-header-login:hover { background: var(--gray-800); border-color: var(--gray-800); }

    .landing-hero { display: flex; min-height: min(820px, calc(100vh - 76px)); align-items: center; padding: 100px 0 110px; background: var(--surface); }
    .landing-hero-grid { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, .88fr) minmax(520px, 1.12fr); gap: clamp(48px, 6vw, 86px); align-items: center; }
    .landing-hero-copy { max-width: 590px; }
    .landing-kicker { margin: 0 0 18px; color: var(--landing-blue); font-size: 14px; font-weight: 800; letter-spacing: -.01em; }
    .landing-hero h1 { margin: 0; color: var(--gray-900); font-size: clamp(44px, 5vw, 68px); font-weight: 820; line-height: 1.12; letter-spacing: -.048em; word-break: keep-all; }
    .landing-lead { max-width: 560px; margin: 28px 0 0; color: var(--landing-muted); font-size: 18px; line-height: 1.75; letter-spacing: -.015em; word-break: keep-all; }
    .landing-hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 34px; }
    .landing-page .landing-primary-cta, .landing-page .landing-secondary-cta { min-height: 52px; padding: 0 22px; border-radius: 14px; font-size: 15px; font-weight: 750; }
    .landing-page .landing-primary-cta { background: var(--landing-blue); border-color: var(--landing-blue); color: var(--surface); }
    .landing-page .landing-primary-cta:hover { background: var(--primary-strong); border-color: var(--primary-strong); }
    .landing-page .landing-secondary-cta { border-color: var(--line); background: var(--surface); color: var(--gray-700); }
    .landing-page .landing-secondary-cta:hover { background: var(--gray-50); border-color: var(--gray-300); }
    .landing-hero-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin: 44px 0 0; }
    .landing-hero-facts div { min-width: 0; padding-top: 16px; border-top: 1px solid var(--line); }
    .landing-hero-facts dt { color: var(--gray-700); font-size: 13px; font-weight: 800; }
    .landing-hero-facts dd { margin: 5px 0 0; color: var(--gray-400); font-size: 11.5px; line-height: 1.55; word-break: keep-all; }

    .landing-product-window, .landing-feature-visual { position: relative; border: 1px solid var(--landing-line); border-radius: 16px; background: var(--surface); box-shadow: var(--shadow-1); }
    .landing-hero-preview { transform: none; }
    .landing-window-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 58px; padding: 0 20px; border-radius: 15px 15px 0 0; background: var(--primary-deep); color: var(--surface); }
    .landing-window-brand { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; }
    .landing-window-user { padding: 5px 9px; border-radius: 999px; background: var(--primary-strong); color: var(--gray-200); font-size: 10.5px; font-weight: 700; }
    .landing-window-body { padding: 22px; }
    .landing-demo-search { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 48px; padding: 5px 6px 5px 14px; border: 1px solid var(--line); border-radius: 12px; color: var(--gray-400); font-size: 12px; }
    .landing-demo-search i { color: var(--gray-500); }
    .landing-demo-search b { padding: 8px 13px; border-radius: 9px; background: var(--action); color: var(--action-ink); font-size: 11px; }
    .landing-demo-filters { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
    .landing-demo-filters span { padding: 5px 9px; border-radius: 999px; background: var(--gray-100); color: var(--gray-500); font-size: 10px; font-weight: 700; }
    .landing-demo-table { overflow: hidden; margin-top: 18px; border: 1px solid var(--gray-100); border-radius: 12px; }
    .landing-demo-row { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(135px, .8fr) minmax(175px, 1fr); gap: 12px; align-items: center; min-height: 52px; padding: 0 14px; border-bottom: 1px solid var(--gray-100); color: var(--gray-500); font-size: 10.5px; }
    .landing-demo-row:last-child { border-bottom: 0; }
    .landing-demo-row strong { color: var(--gray-700); font-size: 11.5px; }
    .landing-demo-head { min-height: 38px; background: var(--gray-50); color: var(--gray-400); font-size: 9.5px; font-weight: 800; }
    .landing-demo-location { color: var(--landing-blue); font-weight: 750; }
    .landing-window-foot { display: flex; justify-content: space-between; gap: 12px; margin-top: 11px; color: var(--gray-400); font-size: 9.5px; font-weight: 700; }

    .landing-section { padding: clamp(100px, 10vw, 150px) 0; background: var(--surface); }
    .landing-section-soft { background: var(--landing-soft); }
    .landing-split { display: grid; grid-template-columns: minmax(0, .88fr) minmax(520px, 1.12fr); gap: clamp(54px, 8vw, 110px); align-items: center; }
    .landing-split-reverse { grid-template-columns: minmax(520px, 1.12fr) minmax(0, .88fr); }
    .landing-copy-block { max-width: 500px; }
    .landing-copy-block h2, .landing-section-heading h2, .landing-login-copy h2 { margin: 0; color: var(--gray-900); font-size: clamp(36px, 4vw, 50px); font-weight: 820; line-height: 1.18; letter-spacing: -.042em; word-break: keep-all; }
    .landing-copy-block > p, .landing-section-heading > p { margin: 24px 0 0; color: var(--landing-muted); font-size: 17px; line-height: 1.82; letter-spacing: -.015em; word-break: keep-all; }
    .landing-check-list { display: grid; gap: 16px; margin: 32px 0 0; padding: 0; list-style: none; }
    .landing-check-list li { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 12px; align-items: center; color: var(--gray-500); font-size: 14px; }
    .landing-check-list i { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--primary-soft); color: var(--landing-blue); font-size: 13px; }
    .landing-check-list strong { display: inline-block; margin-right: 5px; color: var(--gray-700); }

    .landing-feature-visual { padding: 28px; box-shadow: var(--shadow-1); }
    .landing-visual-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
    .landing-visual-label span { color: var(--gray-700); font-size: 14px; font-weight: 800; }
    .landing-visual-label small { color: var(--gray-400); font-size: 11px; font-weight: 700; }
    .landing-search-query { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 56px; padding: 5px 7px 5px 16px; border: 1px solid var(--line); border-radius: 14px; }
    .landing-search-query i { color: var(--gray-500); }
    .landing-search-query strong { color: var(--gray-700); font-size: 14px; }
    .landing-search-query span { padding: 9px 14px; border-radius: 10px; background: var(--action); color: var(--action-ink); font-size: 11px; font-weight: 800; }
    .landing-filter-line { display: flex; flex-wrap: wrap; gap: 8px; margin: 13px 0 18px; }
    .landing-filter-line b { padding: 6px 10px; border-radius: 999px; background: var(--gray-100); color: var(--gray-500); font-size: 10.5px; }
    .landing-result-list { display: grid; gap: 8px; }
    .landing-result-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; min-height: 72px; padding: 13px 15px; border: 1px solid var(--gray-100); border-radius: 13px; background: var(--surface); }
    .landing-result-item > span { display: grid; gap: 3px; min-width: 0; }
    .landing-result-item strong { color: var(--gray-700); font-size: 12.5px; }
    .landing-result-item small { color: var(--gray-400); font-size: 10px; }
    .landing-result-item > b { color: var(--gray-500); font-size: 10px; }
    .landing-result-item.is-selected { border-color: var(--primary-soft); background: var(--primary-soft); box-shadow: inset 3px 0 0 var(--landing-blue); }
    .landing-result-item.is-selected > b { color: var(--landing-blue); }

    .landing-location-visual { padding: 30px; background: var(--primary-deep); border-color: var(--primary-deep); color: var(--surface); box-shadow: var(--shadow-2); }
    .landing-location-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
    .landing-location-head > span { display: grid; gap: 4px; }
    .landing-location-head small { color: var(--gray-300); font-size: 10px; font-weight: 800; }
    .landing-location-head strong { color: var(--surface); font-size: 18px; }
    .landing-location-head > b { padding: 7px 10px; border-radius: 9px; background: var(--action); color: var(--action-ink); font-size: 11px; }
    .landing-rack-guide, .landing-rack-axis { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--gray-300); font-size: 9.5px; font-weight: 700; }
    .landing-rack-guide { margin: 24px 0 9px; }
    .landing-rack-guide strong { color: var(--gray-200); font-size: 10px; }
    .landing-rack-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
    .landing-rack-grid span { display: grid; place-items: center; min-width: 0; aspect-ratio: 1.35; border: 1px solid var(--primary); border-radius: 7px; background: var(--primary-strong); color: var(--surface); font-size: 8.5px; font-weight: 850; }
    .landing-rack-grid .is-hit { border-color: var(--action); background: var(--action); color: var(--action-ink); box-shadow: 0 0 0 3px var(--action-soft); }
    .landing-rack-axis { margin-top: 9px; }
    .landing-inline-note { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 13px; align-items: center; margin-top: 30px; padding: 16px; border-radius: 14px; background: var(--primary-soft); color: var(--gray-600); font-size: 13px; line-height: 1.65; }
    .landing-inline-note i { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: var(--surface); color: var(--landing-blue); box-shadow: var(--shadow-1); }
    .landing-inline-note strong { color: var(--gray-700); }

    .landing-section-heading { max-width: 720px; margin-bottom: 54px; }
    .landing-heading-centered { margin-inline: auto; text-align: center; }
    .landing-workflow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: 0; padding: 0; border-top: 1px solid var(--line); list-style: none; }
    .landing-workflow li { min-height: 0; padding: 26px 24px 0 0; }
    .landing-workflow li + li { padding-left: 24px; border-left: 1px solid var(--line); }
    .landing-workflow li > span { display: block; margin-bottom: 44px; color: var(--gray-400); font-size: 10px; font-weight: 850; letter-spacing: .1em; }
    .landing-workflow li > strong { display: block; color: var(--gray-900); font-size: 19px; }
    .landing-workflow li > p { margin: 9px 0 0; color: var(--gray-500); font-size: 12.5px; line-height: 1.65; word-break: keep-all; }

    .landing-control-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; border-top: 1px solid var(--line); }
    .landing-control-grid article { min-height: 0; padding: 26px 24px 0 0; }
    .landing-control-grid article + article { padding-left: 24px; border-left: 1px solid var(--line); }
    .landing-control-grid article > span { display: block; margin-bottom: 44px; color: var(--gray-400); font-size: 10px; font-weight: 850; letter-spacing: .1em; }
    .landing-control-grid h3 { color: var(--gray-900); font-size: 17px; font-weight: 800; }
    .landing-control-grid p { margin: 10px 0 0; color: var(--gray-500); font-size: 12.5px; line-height: 1.72; word-break: keep-all; }
    .landing-source-principle { display: grid; grid-template-columns: minmax(220px, .7fr) minmax(0, 1.3fr); gap: 32px; align-items: start; margin-top: 54px; padding-top: 22px; border-top: 1px solid var(--line); }
    .landing-source-principle strong { display: block; color: var(--gray-800); font-size: 14px; }
    .landing-source-principle p { margin: 0; color: var(--gray-500); font-size: 12.5px; line-height: 1.65; }

    .landing-login-section { padding: clamp(100px, 10vw, 140px) 0; background: var(--primary-deep); color: var(--surface); }
    .landing-login-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(390px, 470px); gap: clamp(60px, 9vw, 130px); align-items: center; }
    .landing-login-copy { max-width: 590px; }
    .landing-login-copy .landing-kicker { color: var(--gray-300); }
    .landing-login-copy h2 { color: var(--surface); font-size: clamp(40px, 4.5vw, 56px); }
    .landing-login-copy > p:not(.landing-kicker) { max-width: 530px; margin: 25px 0 0; color: var(--gray-300); font-size: 16px; line-height: 1.8; word-break: keep-all; }
    .landing-login-card.login-panel { align-self: auto; width: 100%; padding: 32px; border: 0; border-radius: 18px; background: var(--surface); color: var(--gray-900); box-shadow: var(--shadow-2); }
    .landing-login-card .login-logo { width: 112px; max-width: 44%; height: auto; margin-bottom: 24px; filter: none; }
    .landing-login-title { margin-bottom: 22px; }
    .landing-login-card .landing-login-title h2 { margin: 0; color: var(--gray-900); font-size: 24px; font-weight: 820; letter-spacing: -.025em; }
    .landing-login-title p { margin: 6px 0 0; color: var(--gray-400); font-size: 12.5px; }
    .landing-login-form { gap: 15px; }
    .landing-login-form label { color: var(--gray-600); font-size: 12px; font-weight: 800; }
    .landing-login-form input { min-height: 50px; margin-top: 6px; border-radius: 12px; font-size: 14px; }
    .landing-login-form button { width: 100%; min-height: 50px; margin-top: 2px; border-radius: 12px; background: var(--landing-blue); border-color: var(--landing-blue); font-size: 14px; }
    .landing-login-form button:hover { background: var(--primary-strong); border-color: var(--primary-strong); }
    .landing-login-card .login-help { gap: 6px; margin-top: 22px; padding-top: 20px; border-top-color: var(--gray-100); color: var(--gray-500); font-size: 11.5px; line-height: 1.6; }
    .landing-login-card .login-help strong { color: var(--gray-700); }
    .landing-login-card .login-help a { color: var(--landing-blue); font-weight: 800; }
    .landing-login-card .login-help .muted { color: var(--gray-400); font-size: 11px; }
    .landing-login-card .alert { margin-bottom: 16px; }

    .landing-footer { padding: 28px 0; border-top: 1px solid var(--line); background: var(--surface); color: var(--gray-400); }
    .landing-footer .landing-container { display: flex; align-items: center; justify-content: space-between; gap: 20px; font-size: 11px; }
    .landing-footer strong { color: var(--gray-500); }

    @media (max-width: 1000px) {
      .landing-nav { display: none; }
      .landing-header-inner { grid-template-columns: 1fr auto; }
      .landing-hero { min-height: 0; padding: 86px 0 100px; }
      .landing-hero-grid, .landing-split, .landing-split-reverse, .landing-login-grid { grid-template-columns: minmax(0, 1fr); }
      .landing-hero-copy { max-width: 680px; }
      .landing-hero-preview { width: min(760px, 100%); margin: 10px auto 0; transform: none; }
      .landing-copy-block { max-width: 650px; }
      .landing-split-reverse .landing-copy-block { order: -1; }
      .landing-feature-visual { width: min(760px, 100%); }
      .landing-workflow, .landing-control-grid { grid-template-columns: minmax(0, 1fr); }
      .landing-workflow li, .landing-control-grid article { padding: 22px 0 0; }
      .landing-workflow li + li, .landing-control-grid article + article { margin-top: 22px; padding-left: 0; border-left: 0; border-top: 1px solid var(--line); }
      .landing-workflow li > span, .landing-control-grid article > span { margin-bottom: 18px; }
      .landing-source-principle { grid-template-columns: minmax(0, 1fr); gap: 8px; }
      .landing-login-grid { gap: 54px; }
      .landing-login-card.login-panel { width: min(560px, 100%); }
    }
    @media (max-width: 640px) {
      .landing-container { width: min(100% - 32px, 1180px); }
      .landing-header, .landing-header-inner { min-height: 66px; }
      .landing-header-inner { gap: 12px; }
      .landing-brand-logo { width: 43px; height: 32px; }
      .landing-brand small { display: none; }
      .landing-brand strong { font-size: 13px; }
      .landing-page .landing-header-login { min-height: 40px; padding-inline: 14px; }
      .landing-hero { padding: 70px 0 78px; }
      .landing-hero h1 { font-size: clamp(38px, 11.4vw, 48px); line-height: 1.14; }
      .landing-lead { margin-top: 22px; font-size: 16px; line-height: 1.72; }
      .landing-hero-actions { display: grid; grid-template-columns: 1fr; margin-top: 28px; }
      .landing-page .landing-primary-cta, .landing-page .landing-secondary-cta { width: 100%; }
      .landing-hero-facts { grid-template-columns: 1fr; gap: 11px; margin-top: 34px; }
      .landing-hero-facts div { display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: baseline; gap: 10px; padding-top: 11px; }
      .landing-hero-facts dd { margin: 0; }
      .landing-product-window { border-radius: 14px; box-shadow: var(--shadow-1); }
      .landing-window-bar { min-height: 50px; padding-inline: 14px; border-radius: 13px 13px 0 0; }
      .landing-window-body { padding: 14px; }
      .landing-demo-filters span:nth-child(n+3) { display: none; }
      .landing-demo-row { grid-template-columns: minmax(0, 1fr) auto; min-height: 58px; padding: 8px 11px; }
      .landing-demo-row > :last-child { grid-column: 1 / -1; }
      .landing-demo-head { display: none; }
      .landing-section { padding: 82px 0; }
      .landing-copy-block h2, .landing-section-heading h2, .landing-login-copy h2 { font-size: 36px; }
      .landing-copy-block > p, .landing-section-heading > p { margin-top: 19px; font-size: 15.5px; line-height: 1.75; }
      .landing-check-list { gap: 13px; margin-top: 27px; }
      .landing-check-list li { align-items: start; }
      .landing-feature-visual { padding: 18px; border-radius: 18px; }
      .landing-result-item { grid-template-columns: minmax(0, 1fr); gap: 6px; min-height: 76px; }
      .landing-location-visual { padding: 20px; }
      .landing-location-head { align-items: start; flex-direction: column; }
      .landing-rack-grid { gap: 4px; }
      .landing-rack-grid span { min-height: 34px; aspect-ratio: auto; border-radius: 5px; }
      .landing-rack-grid .is-hit { font-size: 0; }
      .landing-rack-grid .is-hit::after { content: '●'; font-size: 10px; }
      .landing-inline-note { grid-template-columns: 34px minmax(0, 1fr); padding: 14px; }
      .landing-inline-note i { width: 34px; height: 34px; }
      .landing-section-heading { margin-bottom: 35px; }
      .landing-workflow li, .landing-control-grid article { padding-top: 20px; }
      .landing-source-principle { padding-top: 20px; }
      .landing-login-section { padding: 82px 0; }
      .landing-login-copy h2 { font-size: 38px; }
      .landing-login-card.login-panel { padding: 24px; border-radius: 20px; }
      .landing-login-card .login-logo { margin-bottom: 20px; }
      .landing-footer .landing-container { align-items: flex-start; flex-direction: column; gap: 5px; }
    }`;
}
