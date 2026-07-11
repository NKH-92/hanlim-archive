export const RACK_ZONES = Object.freeze([1, 2, 3]);
export const MAX_RACKS_PER_ZONE = 15;
export const MAX_RACK_COLUMNS = 20;
export const MAX_RACK_SHELVES = 20;
// 문서고 실물 규격: 랙 한 면은 좌우 7열 × 상하 6선반 = 42칸이다(단면·양면 공통).
// 랙 구조는 이 값으로 고정 운영하며, UI에서 열/선반 수를 바꾸지 않는다 (migration 0017).
export const DEFAULT_RACK_COLUMNS = 7;
export const DEFAULT_RACK_SHELVES = 6;

// maxRows는 한 요청 안에서 문서를 순차 등록할 때의 상한이다. 각 행이 D1 배치(subrequest)를
// 소비하므로 Workers 무료티어의 요청당 subrequest 한도를 넘지 않게 보수적으로 잡는다.
// 더 큰 일괄 이관은 파일을 나눠 가져오거나 CSV_IMPORT_MAX_ROWS 환경변수로 조정한다.
export const DEFAULT_CSV_IMPORT_LIMITS = Object.freeze({
  maxBytes: 128 * 1024,
  maxRows: 50
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
