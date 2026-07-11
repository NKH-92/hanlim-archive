// 문서고 도면(플로어 플랜)과 랙 지도 렌더링.

import { escapeHtml, readBoolean } from "../utils.js";

// 도면 위 랙 실루엣 한 개. 양면 랙은 좌(N-1면)·우(N-2면) 두 칸을 세로 점선으로 나눈다.
// hit: 랙 전체 강조(검색 일치), hitFace('A'|'B'): 양면 랙에서 해당 면(반쪽)만 강조(문서 상세).
function floorRackMarkup(rack, { hit = false, hitFace = "" } = {}) {
  const classes = ["floor-rack", rack.isSingleSided ? "is-single" : "is-double"];
  if (hit) classes.push("is-hit");
  const faceAttr = !rack.isSingleSided && hitFace ? ` data-face-hit="${escapeHtml(hitFace)}"` : "";
  const faces = rack.isSingleSided
    ? ""
    : `<span class="rack-face rack-face-a"></span><span class="rack-face rack-face-b"></span>`;
  const title = rack.isSingleSided
    ? `${rack.code} · 단면 · ${rack.documentCount}건`
    : `${rack.code} · 양면 (좌 ${rack.rackNumber}-1 / 우 ${rack.rackNumber}-2) · ${rack.documentCount}건`;
  return `<a class="${classes.join(" ")}"${faceAttr} href="/documents?q=${encodeURIComponent(rack.code)}&sort=location" style="--rack-left:${rack.leftPct}%;--rack-width:${rack.widthPct}%;" data-rack-code="${escapeHtml(rack.code)}" title="${escapeHtml(title)}">${faces}<span class="rack-num">${escapeHtml(String(rack.rackNumber))}</span></a>`;
}

export function floorPlanView(regions, hits) {
  const activeRackCount = regions.reduce((sum, region) => sum + region.racks.filter((rack) => hits.has(rack.code)).length, 0);
  return `
    <div class="floor-plan-shell">
      <div class="floor-plan-media">
        <img src="/images/Archive.png" alt="한림 문서고 도면">
        ${regions.map((region) => `
          <section class="floor-region" aria-label="${escapeHtml(region.label)}" style="--top:${region.topPct}%;--left:${region.leftPct}%;--width:${region.widthPct}%;--height:${region.heightPct}%;">
            <span class="floor-region-label">${escapeHtml(region.label)}</span>
            ${region.racks.map((rack) => floorRackMarkup(rack, { hit: hits.has(rack.code) })).join("")}
          </section>
        `).join("")}
      </div>
      
      <div class="floor-plan-summary">
        ${activeRackCount ? `<span>일치 랙 ${activeRackCount}개</span>` : ""}
        <span><i class="legend-box"></i>양면 랙</span>
        <span><i class="legend-box single"></i>단면 랙</span>
        ${activeRackCount ? `<span><i class="legend-box hit"></i>검색 위치</span>` : ""}
      </div>
      <div class="zone-list">
        ${regions.map((region) => `<a href="/app?zone=${region.zoneNumber}&sort=location"><strong>${escapeHtml(region.label)}</strong><span>${region.racks.length}개 랙</span></a>`).join("")}
      </div>
    </div>
  `;
}

// 한 구역만 확대한 도면. 전체 도면 이미지를 스케일·이동해 해당 구역이 뷰포트를 꽉 채운다.
// 구역의 픽셀 비율(1024*W : 797*H)을 뷰포트 aspect-ratio로 두면 CSS 스케일이 왜곡 없이 맞아떨어진다.
export function zoneFloorPlanView(region, { hitCode = "", hitFace = "" } = {}) {
  const aspectW = Math.max(1, Math.round(1024 * region.widthPct));
  const aspectH = Math.max(1, Math.round(797 * region.heightPct));
  return `
    <div class="floor-zoom" style="--z-aw:${aspectW};--z-ah:${aspectH};">
      <div class="floor-zoom-canvas" style="--zw:${region.widthPct};--zh:${region.heightPct};--zl:${region.leftPct};--zt:${region.topPct};">
        <img class="floor-zoom-img" src="/images/Archive.png" alt="${escapeHtml(region.label)} 도면">
        <section class="floor-region" aria-label="${escapeHtml(region.label)}" style="--top:${region.topPct}%;--left:${region.leftPct}%;--width:${region.widthPct}%;--height:${region.heightPct}%;">
          <span class="floor-region-label">${escapeHtml(region.label)}</span>
          ${region.racks.map((rack) => {
            const isHitRack = rack.code === hitCode;
            return floorRackMarkup(rack, {
              hit: isHitRack && (rack.isSingleSided || !hitFace),
              hitFace: isHitRack && !rack.isSingleSided ? hitFace : ""
            });
          }).join("")}
        </section>
      </div>
    </div>
  `;
}

export function archiveMap(racks, hits) {
  // 랙이 있는 구역만 그린다 (현재는 1구역뿐, 증설 시 자동 확장).
  const zones = [...new Set(racks.map((rack) => Number(rack.zone_number)))].sort((a, b) => a - b);
  return `
    <div class="archive-map">
      ${zones.map((zone) => {
        const zoneRacks = racks.filter((rack) => Number(rack.zone_number) === zone);
        return `<section class="rack-zone" aria-label="${zone}구역"><h3>${zone}구역</h3><div class="rack-zone-grid">
          ${zoneRacks.map((rack) => {
            const hitA = hits.has(`${rack.code}:A`);
            const hitB = hits.has(`${rack.code}:B`);
            const isHit = hitA || hitB;
            const single = readBoolean(rack.is_single_sided);
            const faceSummary = single
              ? `단면${hitA ? " 일치" : ""}`
              : `${rack.rack_number}-1${hitA ? " 일치" : ""} · ${rack.rack_number}-2${hitB ? " 일치" : ""}`;
            return `<a class="rack-tile ${isHit ? "is-hit" : ""}" href="/documents?q=${encodeURIComponent(rack.code)}" title="${escapeHtml(rack.code)} ${rack.document_count || 0}건">
              <strong>${rack.rack_number}</strong>
              <span>${escapeHtml(rack.code)}</span>
              <small>${faceSummary}</small>
            </a>`;
          }).join("")}
        </div></section>`;
      }).join("")}
    </div>
  `;
}
