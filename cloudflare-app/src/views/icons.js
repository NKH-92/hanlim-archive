// 외부 아이콘 폰트 없이 기존 fa-* 마크업을 표시하는 로컬 SVG 마스크.

const ICONS = Object.freeze({
  search: `<path d="M11 4a7 7 0 1 0 4.9 12l4 4 1.4-1.4-4-4A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>`,
  filter: `<path d="M3 5h18v2H3V5Zm11-2h3v6h-3V3ZM3 11h18v2H3v-2Zm3-2h3v6H6V9Zm-3 8h18v2H3v-2Zm12-2h3v6h-3v-6Z"/>`,
  gauge: `<path d="M12 4a9 9 0 0 0-7.2 14.4l1.6-1.2A7 7 0 1 1 19 13a7 7 0 0 1-1.4 4.2l1.6 1.2A9 9 0 0 0 12 4Zm4.6 4.8-5.4 4.1a1.6 1.6 0 1 0 1.9 1.9l3.5-6Z"/>`,
  disposedFile: `<path d="M6 2h8l5 5v6h-2V8h-4V4H8v16h6v2H6V2Zm10.6 13.2 1.9 1.9 1.9-1.9 1.4 1.4-1.9 1.9 1.9 1.9-1.4 1.4-1.9-1.9-1.9 1.9-1.4-1.4 1.9-1.9-1.9-1.9 1.4-1.4Z"/>`,
  stack: `<path d="M8 3h12v12h-2V5H8V3ZM4 7h12v14H4V7Zm2 2v10h8V9H6Z"/>`,
  crosshairs: `<path d="M11 2h2v3.1a7 7 0 0 1 5.9 5.9H22v2h-3.1a7 7 0 0 1-5.9 5.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1V2Zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>`,
  archive: `<path d="M4 4h16v4H4V4Zm1 6h14v10H5V10Zm4 3v2h6v-2H9Z"/>`,
  document: `<path d="M6 3h8l4 4v14H6V3Zm8 2v4h4M9 13h6M9 17h6" fill="none" stroke="black" stroke-width="2"/>`,
  settings: `<path d="M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1 1-3Zm2 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>`,
  info: `<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v2h-2V7Zm0 4h2v6h-2v-6Z"/>`,
  copy: `<path d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8V3ZM3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm2 0v11h10V8H5Z"/>`,
  location: `<path d="M12 2a8 8 0 0 0-8 8c0 5.5 8 12 8 12s8-6.5 8-12a8 8 0 0 0-8-8Zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/>`,
  download: `<path d="M11 3h2v10l3.5-3.5 1.4 1.4L12 16.8 6.1 10.9l1.4-1.4L11 13V3ZM4 19h16v2H4v-2Z"/>`,
  spreadsheet: `<path d="M5 3h14v18H5V3Zm2 2v4h10V5H7Zm0 6v3h4v-3H7Zm6 0v3h4v-3h-4Zm-6 5v3h4v-3H7Zm6 0v3h4v-3h-4Z"/>`,
  add: `<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/>`,
  user: `<path d="M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM3 22a9 9 0 0 1 18 0H3Z"/>`,
  lock: `<path d="M7 10V7a5 5 0 0 1 10 0v3h2v11H5V10h2Zm2 0h6V7a3 3 0 0 0-6 0v3Zm2 4v3h2v-3h-2Z"/>`,
  database: `<path d="M12 2c4.4 0 8 1.3 8 3v14c0 1.7-3.6 3-8 3s-8-1.3-8-3V5c0-1.7 3.6-3 8-3Zm0 2c-3.6 0-6 1-6 1s2.4 1 6 1 6-1 6-1-2.4-1-6-1ZM6 8.6V12c0 .3 2.2 1.4 6 1.4s6-1.1 6-1.4V8.6c-1.6.7-3.8 1-6 1s-4.4-.3-6-1Zm0 6V19c0 .3 2.2 1.4 6 1.4s6-1.1 6-1.4v-4.4c-1.6.7-3.8 1-6 1s-4.4-.3-6-1Z"/>`,
  tree: `<path d="M3 3h7v5H3V3Zm2 2v1h3V5H5Zm1 4h2v4h6v-2h7v6h-7v-2H8v6h6v-2h7v6h-7v-2H6V9Zm10 6v2h3v-2h-3Zm0 8v2h3v-2h-3Z"/>`,
  columns: `<path d="M3 4h18v16H3V4Zm2 2v12h4V6H5Zm6 0v12h2V6h-2Zm4 0v12h4V6h-4Z"/>`,
  more: `<path d="M6 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>`,
  history: `<path d="M12 3a9 9 0 1 0 8.5 12h-2.2A6.8 6.8 0 1 1 12 5.2c1.8 0 3.4.7 4.6 1.9L14 9.7h6V3.7l-2 2A9 9 0 0 0 12 3Zm-1 4h2v5.4l3.7 2.2-1 1.7L11 13.6V7Z"/>`,
  close: `<path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z"/>`,
  bullets: `<path d="M4 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm4 .5h12v2H8V6ZM4 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm4 .5h12v2H8v-2ZM4 15.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm4 .5h12v2H8v-2Z"/>`,
  external: `<path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h5v2H6v11h11v-4h2v6H4V5h1Z"/>`,
  play: `<path d="M8 5v14l11-7L8 5Z"/>`,
  replay: `<path d="M6.1 16A8 8 0 1 0 7.3 6.3L4 10M4 4v6h6" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  alert: `<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v7h-2V7Zm0 9h2v2h-2v-2Z"/>`,
  check: `<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 13.6-4.2-4.2L8 10l2.8 2.8L16 7.6 17.4 9l-6.6 6.6Z"/>`,
  chevronRight: `<path d="m9.3 5.3-1.4 1.4 5.3 5.3-5.3 5.3 1.4 1.4 6.7-6.7-6.7-6.7Z"/>`,
  chevronDown: `<path d="m5.3 9.3 1.4-1.4 5.3 5.3 5.3-5.3 1.4 1.4-6.7 6.7-6.7-6.7Z"/>`,
  arrowLeft: `<path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2Z"/>`,
  key: `<path d="M8 7a5 5 0 1 0 4.6 7H15v3h2.5v-3H19v2h2.5v-2H23v-4H12.6A5 5 0 0 0 8 7Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>`,
  tag: `<path d="M3 3h8.6l9.4 9.4-8.6 8.6L3 11.6V3Zm4.5 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>`,
  layers: `<path d="M12 3 2 8l10 5 10-5-10-5Zm-7.8 8.6L2 12.7l10 5 10-5-2.2-1.1L12 15.4l-7.8-3.8Zm0 4L2 16.7l10 5 10-5-2.2-1.1L12 19.4l-7.8-3.8Z"/>`,
  grid: `<path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z"/>`,
  checklist: `<path d="M3.5 5.5 5 7l3-3 1.4 1.4L5 9.8 2.1 6.9l1.4-1.4ZM11 6h10v2H11V6Zm-7.5 7.5L5 15l3-3 1.4 1.4L5 17.8l-2.9-2.9 1.4-1.4ZM11 14h10v2H11v-2Z"/>`,
  chart: `<path d="M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z"/>`,
  users: `<path d="M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-8 16a8 8 0 0 1 16 0H1Zm16-16a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm2.5 16a9.9 9.9 0 0 0-2.6-6.3A6 6 0 0 1 23 20h-3.5Z"/>`,
  signOut: `<path d="M4 3h9v2H6v14h7v2H4V3Zm12.3 4.3L21 12l-4.7 4.7-1.4-1.4 2.3-2.3H9v-2h8.2l-2.3-2.3 1.4-1.4Z"/>`
});

// ::before·::after 장식 아이콘이 클래스 없이 같은 마스크를 쓰도록 변수로도 노출한다.
const ICON_VARIABLES = Object.freeze({
  "--icon-info": "info",
  "--icon-alert": "alert",
  "--icon-check": "check",
  "--icon-chevron-right": "chevronRight",
  "--icon-chevron-down": "chevronDown",
  "--icon-arrow-left": "arrowLeft"
});

function dataUrl(body) {
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`)}")`;
}

export function iconStyles() {
  const groups = {
    search: ["magnifying-glass"],
    filter: ["sliders"],
    archive: ["box-archive", "building-columns", "folder-open"],
    document: ["file-lines", "file-csv"],
    spreadsheet: ["file-excel"],
    download: ["download"],
    add: ["plus", "file-circle-plus"],
    user: ["user"],
    lock: ["lock"],
    settings: ["gear"],
    users: ["users-gear"],
    key: ["key"],
    signOut: ["right-from-bracket"],
    info: ["circle-info"],
    chart: ["chart-simple"],
    tag: ["tags"],
    layers: ["layer-group"],
    grid: ["table-cells-large"],
    checklist: ["list-check"],
    copy: ["copy", "print"],
    location: ["location-dot"],
    crosshairs: ["location-crosshairs"],
    gauge: ["gauge"],
    disposedFile: ["file-circle-xmark"],
    stack: ["clone"],
    database: ["database"],
    tree: ["folder-tree"],
    columns: ["table-columns"],
    more: ["ellipsis"],
    history: ["clock-rotate-left"],
    close: ["xmark"],
    bullets: ["list"],
    external: ["arrow-up-right-from-square"],
    play: ["play"],
    replay: ["rotate-left"],
    alert: ["circle-exclamation"],
    check: ["circle-check"],
    chevronRight: ["chevron-right"],
    chevronDown: ["chevron-down"],
    arrowLeft: ["arrow-left"]
  };
  const rules = Object.entries(groups).map(([icon, names]) =>
    names.map((name) => `.fa-${name}`).join(",") + `{--icon-mask:${dataUrl(ICONS[icon])}}`
  ).join("");
  const variables = Object.entries(ICON_VARIABLES).map(([name, icon]) => `${name}:${dataUrl(ICONS[icon])}`).join(";");
  return `:root{${variables}}.fa-solid,.fa-regular{display:inline-block;width:1em;height:1em;flex:0 0 auto;background:currentColor;-webkit-mask:var(--icon-mask) center/contain no-repeat;mask:var(--icon-mask) center/contain no-repeat;vertical-align:-.125em}${rules}`;
}
