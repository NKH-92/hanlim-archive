import { readBoolean } from "../../../shared/coercion.js";

export function rackColumnOrigin(rack, face = rack?.rack_face || "A") {
  const zoneOneRightSingle = Number(rack?.zone_number) === 1 && readBoolean(rack?.is_single_sided) && Number(rack?.rack_number) === 1;
  return face === "B" || zoneOneRightSingle ? "right" : "left";
}

export function rackViewOrientation(rack, face = rack?.rack_face || "A") {
  const single = readBoolean(rack?.is_single_sided);
  const zoneOneRightSingle = Number(rack?.zone_number) === 1 && single && Number(rack?.rack_number) === 1;
  const origin = rackColumnOrigin(rack, face);
  const originLabel = origin === "right" ? "오른쪽" : "왼쪽";
  const description = zoneOneRightSingle
    ? "1구역 1번 단면랙은 우측 랙과 같은 방향이므로 오른쪽이 1열입니다."
    : single
      ? `단면랙을 정면에서 본 모습이며 ${originLabel}이 1열입니다.`
      : `${face === "B" ? "우측 면" : "좌측 면"}을 정면에서 본 모습이며 ${originLabel}이 1열입니다.`;
  return Object.freeze({ origin, originLabel, description });
}

export function displayedColumns(rack, face = "A", count = DEFAULT_COLUMNS) {
  const columns = Array.from({ length: count }, (_, index) => index + 1);
  return rackColumnOrigin(rack, face) === "right" ? columns.reverse() : columns;
}

const DEFAULT_COLUMNS = 7;
