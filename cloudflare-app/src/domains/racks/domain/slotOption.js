import { readBoolean } from "../../../shared/coercion.js";

export function presentSlotOption(slot) {
  return {
    ...slot,
    label: `${slot.zone_number}구역 / ${slot.rack_number}번랙 / ${slot.column_number}열 / ${slot.shelf_number}선반${readBoolean(slot.is_single_sided) ? " / 단면" : ""}`
  };
}
