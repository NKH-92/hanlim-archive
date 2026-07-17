// 외부 아이콘 폰트 없이 기존 fa-* 마크업을 표시하는 로컬 SVG 마스크.

const ICONS = Object.freeze({
  search: `<path d="M11 4a7 7 0 1 0 4.9 12l4 4 1.4-1.4-4-4A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>`,
  archive: `<path d="M4 4h16v4H4V4Zm1 6h14v10H5V10Zm4 3v2h6v-2H9Z"/>`,
  document: `<path d="M6 3h8l4 4v14H6V3Zm8 2v4h4M9 13h6M9 17h6" fill="none" stroke="black" stroke-width="2"/>`,
  settings: `<path d="M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1 1-3Zm2 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>`,
  info: `<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v2h-2V7Zm0 4h2v6h-2v-6Z"/>`,
  copy: `<path d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8V3ZM3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm2 0v11h10V8H5Z"/>`,
  location: `<path d="M12 2a8 8 0 0 0-8 8c0 5.5 8 12 8 12s8-6.5 8-12a8 8 0 0 0-8-8Zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/>`,
  list: `<path d="M4 5h3v3H4V5Zm5 0h11v3H9V5ZM4 11h3v3H4v-3Zm5 0h11v3H9v-3ZM4 17h3v3H4v-3Zm5 0h11v3H9v-3Z"/>`,
  user: `<path d="M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM3 22a9 9 0 0 1 18 0H3Z"/>`
});

function dataUrl(body) {
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`)}")`;
}

export function iconStyles() {
  const groups = {
    search: ["magnifying-glass", "sliders"],
    archive: ["box-archive", "building-columns", "folder-open"],
    document: ["file-lines", "file-csv"],
    settings: ["gear", "key", "right-from-bracket", "users-gear"],
    info: ["circle-info", "chart-simple"],
    copy: ["copy", "print"],
    location: ["location-dot", "location-crosshairs"],
    list: ["list-check", "table-cells-large", "layer-group", "tags"]
  };
  const rules = Object.entries(groups).map(([icon, names]) =>
    names.map((name) => `.fa-${name}`).join(",") + `{--icon-mask:${dataUrl(ICONS[icon])}}`
  ).join("");
  return `.fa-solid,.fa-regular{display:inline-block;width:1em;height:1em;flex:0 0 auto;background:currentColor;-webkit-mask:var(--icon-mask) center/contain no-repeat;mask:var(--icon-mask) center/contain no-repeat;vertical-align:-.125em}${rules}`;
}
