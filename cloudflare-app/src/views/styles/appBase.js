// 로그인 후 업무 화면의 기본 요소 보정. 앱인토스 UI/UX 가이드와 TDS의 글자·버튼·입력·목록 원칙을 따른다.
// 요소 기본값 바로 뒤에 두어 뒤따르는 컴포넌트 규칙이 같은 구체성에서 계속 이긴다.
// :where(.app-body)는 구체성을 더하지 않고 공개 랜딩(세션 없음)에는 적용되지 않는다.

export function appBaseStyles() {
  return `    :where(.app-body) { line-height: 1.55; }
    /* 한글은 단어 중간에서 줄을 바꾸지 않는다. 한 단어가 줄보다 길 때만 요소별 overflow-wrap이 끊는다. */
    :where(.app-body) { word-break: keep-all; }
    :where(.app-body) :is(h1, h2, h3) { color: var(--gray-900); letter-spacing: 0; }
    :where(.app-body) h1 { font-weight: 700; line-height: 1.4; }
    :where(.app-body) h2 { font-weight: 700; line-height: 1.45; }
    :where(.app-body) h3 { font-size: var(--text-lead); line-height: 1.5; }
    :where(.app-body) p { line-height: 1.6; }
    :where(.app-body) .muted { color: var(--gray-500); font-size: 14px; line-height: 1.6; }
    :where(.app-body) .page-sub { margin: var(--sp-2) 0 0; color: var(--gray-600); font-size: var(--text-body); font-weight: 400; }
    :where(.app-body) :where(p, td, dd, li, .alert) a:not([class]) { color: var(--primary); text-underline-offset: 2px; }

    :where(.app-body) :is(input, select, textarea):where(:not([type="checkbox"], [type="radio"], [type="file"], [type="hidden"], [type="range"])) { min-height: var(--control-height); padding: var(--sp-2) var(--sp-3); border: 1px solid var(--gray-200); border-radius: var(--r-md); background: var(--gray-50); color: var(--gray-900); font-size: var(--text-body); }
    :where(.app-body) textarea { min-height: 96px; padding: var(--sp-3); line-height: 1.6; }
    :where(.app-body) :is(input, select, textarea):hover { border-color: var(--gray-300); }
    :where(.app-body) :is(input, select, textarea):focus { background: var(--surface); border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
    :where(.app-body) :is(input, select, textarea):disabled { background: var(--gray-100); color: var(--gray-500); cursor: not-allowed; }
    :where(.app-body) input[type="file"] { width: 100%; padding: var(--sp-2); border: 1px dashed var(--gray-300); border-radius: var(--r-md); background: var(--gray-50); color: var(--gray-700); font: inherit; font-size: 14px; }
    :where(.app-body) input[type="file"]::file-selector-button { min-height: 32px; margin-right: var(--sp-3); padding: 0 var(--sp-3); border: 0; border-radius: var(--r-sm); background: var(--gray-100); color: var(--gray-800); font: inherit; font-weight: 600; cursor: pointer; }
    :where(.app-body) :is(input[type="checkbox"], input[type="radio"]) { accent-color: var(--primary); }
    :where(.app-body) label { color: var(--gray-700); font-size: 13.5px; font-weight: 600; }
    :where(.app-body) em { font-weight: 700; }

    :where(.app-body) :is(button, .button) { gap: var(--sp-2); border-radius: var(--r-md); font-size: var(--text-body); font-weight: 600; line-height: 1.25; transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease; }
    :where(.app-body) :is(.button.secondary, button.secondary, .secondary) { background: var(--gray-100); border-color: transparent; color: var(--gray-800); }
    :where(.app-body) :is(.button.secondary, button.secondary, .secondary):hover { background: var(--gray-200); border-color: transparent; color: var(--gray-900); }
    :where(.app-body) :is(.danger-button, .button.danger-button) { background: var(--danger-soft); border-color: transparent; color: var(--danger); }
    :where(.app-body) :is(.danger-button, .button.danger-button):hover { background: var(--danger); color: var(--surface); }
    :where(.app-body) .sm { padding: var(--sp-1) var(--sp-3); border-radius: var(--r-sm); font-size: 14px; }
    :where(.app-body) .icon-button { border-radius: var(--r-md); color: var(--gray-600); font-size: 18px; }

    :where(.app-body) table { font-size: 14px; }
    :where(.app-body) :is(th, td) { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--gray-100); }
    :where(.app-body) th { background: transparent; color: var(--gray-500); font-size: var(--text-meta); font-weight: 600; border-bottom-color: var(--line); }

    :where(.app-body) .panel { border-color: transparent; padding: var(--sp-6); }
    :where(.app-body) .section-title { margin-bottom: var(--sp-4); }
    :where(.app-body) .count-badge { line-height: 24px; padding: 0 var(--sp-2); background: var(--gray-100); color: var(--gray-600); font-size: var(--text-meta); }
    :where(.app-body) .status { line-height: 24px; padding: 0 var(--sp-2); border-radius: var(--r-sm); font-size: var(--text-caption); font-weight: 700; }
    :where(.app-body) .chip { min-height: 32px; padding: 0 var(--sp-3); font-size: 13.5px; }
    :where(.app-body) .alert.neutral { background: var(--gray-50); color: var(--gray-700); }
`;
}
