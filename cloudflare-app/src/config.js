export const RACK_ZONES = Object.freeze([1, 2, 3]);
export const MAX_RACKS_PER_ZONE = 15;
export const MAX_RACK_COLUMNS = 20;
export const MAX_RACK_SHELVES = 20;
export const DEFAULT_RACK_COLUMNS = 1;
export const DEFAULT_RACK_SHELVES = 3;

export const DEFAULT_CSV_IMPORT_LIMITS = Object.freeze({
  maxBytes: 128 * 1024,
  maxRows: 5
});

export function getAppConfig(env = {}) {
  return {
    csvImport: {
      maxBytes: readPositiveInteger(env.CSV_IMPORT_MAX_BYTES, DEFAULT_CSV_IMPORT_LIMITS.maxBytes),
      maxRows: readPositiveInteger(env.CSV_IMPORT_MAX_ROWS, DEFAULT_CSV_IMPORT_LIMITS.maxRows)
    },
    racks: {
      zones: RACK_ZONES,
      maxPerZone: MAX_RACKS_PER_ZONE,
      maxColumns: MAX_RACK_COLUMNS,
      maxShelves: MAX_RACK_SHELVES,
      defaultColumns: DEFAULT_RACK_COLUMNS,
      defaultShelves: DEFAULT_RACK_SHELVES
    }
  };
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
