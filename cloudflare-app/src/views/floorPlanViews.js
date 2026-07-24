// 문서고 도면(플로어 플랜)과 랙 지도 렌더링.

import { readBoolean } from "../shared/coercion.js";
import { escapeHtml } from "../ui/html/escape.js";
import { page } from "./layout.js";

// 도면 위 랙 실루엣 한 개. 양면 랙은 좌(N-1면)·우(N-2면) 두 칸을 세로 점선으로 나눈다.
// hit: 랙 전체 강조(검색 일치), hitFace('A'|'B'): 양면 랙에서 해당 면(반쪽)만 강조(문서 상세).
// interactive=false는 특정 문서의 위치만 읽어야 하는 상세·찾기 화면에서 주변 랙 오탭을 막는다.
function floorRackMarkup(rack, { hit = false, hitFace = "", zoneNumber = 0, interactive = true } = {}) {
  const classes = ["floor-rack", rack.isSingleSided ? "is-single" : "is-double"];
  const isZoneOneRightSingle = rack.isSingleSided && Number(zoneNumber) === 1 && Number(rack.rackNumber) === 1;
  if (isZoneOneRightSingle) classes.push("column-origin-right");
  if (hit) classes.push("is-hit");
  const faceAttr = !rack.isSingleSided && hitFace ? ` data-face-hit="${escapeHtml(hitFace)}"` : "";
  const faces = rack.isSingleSided
    ? ""
    : `<span class="rack-face rack-face-a"></span><span class="rack-face rack-face-b"></span>`;
  const badgeLabel = !rack.isSingleSided && hitFace
    ? `${rack.rackNumber}-${hitFace === "B" ? 2 : 1}`
    : String(rack.rackNumber);
  const title = rack.isSingleSided
    ? `${rack.code} · 단면${isZoneOneRightSingle ? " · 우측 랙 방향 · 1열 오른쪽 시작" : ""}`
    : `${rack.code} · 양면 (좌 ${rack.rackNumber}-1: 1열 왼쪽 시작 / 우 ${rack.rackNumber}-2: 1열 오른쪽 시작)`;
  const active = hit || Boolean(hitFace);
  const content = `${faces}${active ? `<span class="rack-hit-pin" aria-hidden="true">현재</span>` : ""}<span class="rack-num">${escapeHtml(badgeLabel)}</span>`;
  const common = `class="${classes.join(" ")}"${faceAttr} style="--rack-left:${rack.leftPct}%;--rack-width:${rack.widthPct}%;" data-rack-code="${escapeHtml(rack.code)}" data-zone="${escapeHtml(String(zoneNumber))}" title="${escapeHtml(title)}"`;
  if (!interactive) return `<span ${common} aria-hidden="true">${content}</span>`;
  return `<a ${common} href="/app?rack=${Number(rack.id)}&amp;status=active&amp;sort=location" aria-label="${escapeHtml(title)}">${content}</a>`;
}

export function floorPlanView(regions, hits = new Set()) {
  const activeRackCount = regions.reduce((sum, region) => sum + region.racks.filter((rack) => hits.has(rack.code)).length, 0);
  return `
    <div class="floor-plan-shell">
      <div class="floor-plan-tools"><span>전체 배치를 먼저 보고, 필요한 경우 확대해 좌우로 이동하세요.</span><button type="button" class="button secondary sm" data-floor-plan-zoom aria-pressed="false">도면 확대</button></div>
      <div class="floor-plan-scroll" data-floor-plan-scroll tabindex="0" aria-label="문서고 랙 도면. 확대 보기에서는 좌우로 스크롤하여 모든 랙을 확인할 수 있습니다.">
        <div class="floor-plan-media">
          <img src="/images/Archive.png" alt="한림 문서고 도면">
          ${regions.map((region) => `
            <section class="floor-region" aria-label="${escapeHtml(region.label)}" style="--top:${region.topPct}%;--left:${region.leftPct}%;--width:${region.widthPct}%;--height:${region.heightPct}%;">
              <span class="floor-region-label">${escapeHtml(region.label)}</span>
              ${region.zoneNumber === 1 ? `<span class="floor-wall-marker">벽면 ↑</span>` : ""}
              ${region.racks.map((rack) => floorRackMarkup(rack, { hit: hits.has(rack.code), zoneNumber: region.zoneNumber })).join("")}
            </section>
          `).join("")}
        </div>
      </div>

      <div class="floor-plan-summary">
        ${activeRackCount ? `<span>일치 랙 ${activeRackCount}개</span>` : ""}
        <span><i class="legend-box"></i>양면 랙</span>
        <span><i class="legend-box single"></i>단면 랙</span>
        ${regions.some((region) => region.zoneNumber === 1) ? `<span>1구역 위쪽 = 벽면</span><span>각 면의 1열 = 통로 안쪽</span>` : ""}
        ${activeRackCount ? `<span><i class="legend-box hit"></i>검색 위치</span>` : ""}
      </div>
      <div class="zone-list">
        ${regions.map((region) => `<a href="/app?zone=${region.zoneNumber}&amp;sort=location"><strong>${escapeHtml(region.label)}</strong><span>${region.racks.length}개 랙</span></a>`).join("")}
      </div>
    </div>
  `;
}

// 한 구역만 확대한 도면. 전체 도면 이미지를 스케일·이동해 해당 구역이 뷰포트를 꽉 채운다.
// 구역의 픽셀 비율(1024*W : 797*H)을 뷰포트 aspect-ratio로 두면 CSS 스케일이 왜곡 없이 맞아떨어진다.
export function zoneFloorPlanView(region, { hitCode = "", hitFace = "", interactive = true, spotlight = false } = {}) {
  const aspectW = Math.max(1, Math.round(1024 * region.widthPct));
  const aspectH = Math.max(1, Math.round(797 * region.heightPct));
  return `
    <div class="floor-zoom${spotlight ? " is-spotlight" : ""}" style="--z-aw:${aspectW};--z-ah:${aspectH};">
      <div class="floor-zoom-canvas" style="--zw:${region.widthPct};--zh:${region.heightPct};--zl:${region.leftPct};--zt:${region.topPct};">
        <img class="floor-zoom-img" src="/images/Archive.png" alt="${escapeHtml(region.label)} 도면">
        <section class="floor-region" aria-label="${escapeHtml(region.label)}" style="--top:${region.topPct}%;--left:${region.leftPct}%;--width:${region.widthPct}%;--height:${region.heightPct}%;">
          <span class="floor-region-label">${escapeHtml(region.label)}</span>
          ${region.zoneNumber === 1 ? `<span class="floor-wall-marker">벽면 ↑</span>` : ""}
          ${region.racks.map((rack) => {
            const isHitRack = rack.code === hitCode;
            return floorRackMarkup(rack, {
              hit: isHitRack && (rack.isSingleSided || !hitFace),
              hitFace: isHitRack && !rack.isSingleSided ? hitFace : "",
              zoneNumber: region.zoneNumber,
              interactive
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
            return `<a class="rack-tile ${isHit ? "is-hit" : ""}" href="/app?rack=${Number(rack.id)}&amp;status=active&amp;sort=location" title="${escapeHtml(rack.code)} ${rack.document_count || 0}건">
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

export function floorPlanPage({ session, floorPlan = [] }) {
  const rackCount = floorPlan.reduce((sum, region) => sum + region.racks.length, 0);
  const zoneRows = floorPlan.map((region) => ({
    zoneNumber: Number(region.zoneNumber),
    label: region.label,
    rackCount: region.racks.length,
    documentCount: region.racks.reduce((sum, rack) => sum + Number(rack.documentCount || 0), 0)
  }));
  return page("문서고 도면", `
    <section class="page-head floor-plan-page-head">
      <div>
        <nav class="breadcrumb" aria-label="경로"><a href="/app">문서검색</a><span>/</span><span>문서고 도면</span></nav>
        <h1>문서고 도면</h1>
        <p>구역과 랙의 실제 배치를 확인하고, 랙을 선택해 해당 위치의 문서를 검색합니다.</p>
      </div>
      <div class="button-group"><button type="button" class="button secondary" data-print><i class="fa-solid fa-print" aria-hidden="true"></i>도면 인쇄</button><a class="button action-button" href="/app"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>위치 검색</a></div>
    </section>
    <section class="operation-hero floor-plan-hero" aria-label="문서고 운영 요약">
      <div><p class="hero-kicker">Archive floor control</p><h2>현재 ${floorPlan.length}개 구역 · ${rackCount}개 랙을 운영 중입니다.</h2><p>선택한 랙에서 보관중 문서 목록으로 바로 이동할 수 있습니다.</p></div>
      <div class="hero-stat"><strong>${rackCount}</strong><span>운영 랙</span></div>
    </section>
    <div class="floor-plan-layout">
      <section class="panel archive-floor-plan-page" aria-label="문서고 전체 도면">
        ${floorPlan.length
          ? floorPlanView(floorPlan)
          : `<div class="empty-state"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><p>표시할 랙 도면이 없습니다.</p></div>`}
      </section>
      ${zoneRows.length ? `<aside class="panel" aria-labelledby="zone-overview-title"><div class="section-title"><h2 id="zone-overview-title">구역·랙 목록</h2><span class="count-badge">${rackCount}개 랙</span></div><div class="zone-overview">${floorPlan.map((region) => `<details><summary><span><strong>${escapeHtml(region.label)}</strong><small>${region.racks.reduce((sum, rack) => sum + Number(rack.documentCount || 0), 0).toLocaleString("ko-KR")}건</small></span><span>${region.racks.length}개 랙</span></summary><div class="zone-rack-links">${region.racks.map((rack) => `<a href="/app?rack=${Number(rack.id)}&amp;status=active&amp;sort=location"><span class="mono">${escapeHtml(rack.code)}</span><span>${Number(rack.documentCount || 0).toLocaleString("ko-KR")}건</span></a>`).join("")}</div></details>`).join("")}</div></aside>` : ""}
    </div>
    <script>
      (function () {
        var button = document.querySelector('[data-floor-plan-zoom]');
        var scroll = document.querySelector('[data-floor-plan-scroll]');
        button?.addEventListener('click', function () {
          var expanded = scroll?.classList.toggle('is-zoomed') || false;
          button.setAttribute('aria-pressed', expanded ? 'true' : 'false');
          button.textContent = expanded ? '전체 보기' : '도면 확대';
          if (!expanded && scroll) scroll.scrollLeft = 0;
        });
      })();
    </script>
  `, session);
}
