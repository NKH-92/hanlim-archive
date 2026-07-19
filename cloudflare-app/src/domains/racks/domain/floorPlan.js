import { readBoolean } from "../../../shared/coercion.js";
import { clean } from "../../../shared/text/normalize.js";

export const DEFAULT_FLOOR_PLAN_REGIONS = Object.freeze([
  Object.freeze({ region_key: "zone-1", label: "1구역", description: "좌상단 문서 보관 구역", top_pct: 3.2, left_pct: 4.7, width_pct: 47.5, height_pct: 38.2, default_rack_count: 13, is_active: 1 }),
  Object.freeze({ region_key: "zone-2", label: "2구역", description: "좌하단 문서 보관 구역", top_pct: 55.8, left_pct: 2.5, width_pct: 43.9, height_pct: 38.9, default_rack_count: 10, is_active: 1 }),
  Object.freeze({ region_key: "zone-3", label: "3구역", description: "우하단 문서 보관 구역", top_pct: 55.8, left_pct: 52.2, width_pct: 39.1, height_pct: 38.9, default_rack_count: 10, is_active: 1 })
]);

export function buildFloorPlanLayout(racks, regions = DEFAULT_FLOOR_PLAN_REGIONS) {
  return regions.map((region) => {
    const zoneNumber = zoneFromRegion(region);
    const zoneRacks = racks.filter((rack) => Number(rack.zone_number) === zoneNumber).sort((left, right) => Number(left.rack_number || 0) - Number(right.rack_number || 0));
    const count = Math.max(zoneRacks.length, Number(region.default_rack_count || 0), 1);
    const slotWidth = 100 / count;
    const barWidthPct = Math.round(slotWidth * 62) / 100;
    return {
      key: clean(region.region_key) || `zone-${zoneNumber}`,
      label: clean(region.label) || `${zoneNumber}구역`,
      description: clean(region.description),
      zoneNumber,
      topPct: clampPercent(region.top_pct, 0),
      leftPct: clampPercent(region.left_pct, 0),
      widthPct: clampPercent(region.width_pct, 30),
      heightPct: clampPercent(region.height_pct, 30),
      racks: zoneRacks.map((rack, index) => ({
        id: Number(rack.id), code: clean(rack.code), rackNumber: Number(rack.rack_number || 0),
        documentCount: Number(rack.active_document_count || rack.document_count || 0),
        isSingleSided: readBoolean(rack.is_single_sided), leftPct: clampPercent(slotWidth * (index + 0.5), 50), topPct: 50, widthPct: barWidthPct
      }))
    };
  }).filter((region) => region.racks.length > 0);
}

function zoneFromRegion(region) {
  const matched = clean(region.region_key).match(/(\d+)/);
  return matched ? Number(matched[1]) : Number(region.zone_number || 0);
}
function clampPercent(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, 100)) : fallback;
}
