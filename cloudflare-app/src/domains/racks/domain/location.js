import { sharedSearchCore } from "../../../searchCore.js";
import { clean } from "../../../shared/text/normalize.js";

export function normalizeRackFace(value) {
  const raw = clean(value).toUpperCase();
  if (raw === "1" || raw === "1면" || raw === "단면") return "A";
  if (raw === "2" || raw === "2면") return "B";
  return raw;
}

export function rackFaceLabel(document) {
  return sharedSearchCore.rackFaceLabel(document);
}

export function locationLabel(document) {
  const zone = document.zone_number ? `${document.zone_number}구역` : "";
  const face = rackFaceLabel(document);
  const rack = face ? `${face}번 랙` : document.rack_code;
  const column = document.column_number ? `${document.column_number}열` : "";
  const shelf = document.shelf_number ? `${document.shelf_number}선반` : document.slot_code ? `칸 ${document.slot_code}` : "";
  return [zone, rack, column, shelf].filter(Boolean).join(" / ");
}
