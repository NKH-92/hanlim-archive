import { FREE_TIER_BUDGET } from "../../freeTierBudget.js";

export class D1LikePatternTooLongError extends RangeError {
  constructor(byteLength) {
    super("검색어가 너무 깁니다. 한글은 16자, 영문·숫자는 48자 이내로 줄여 주세요.");
    this.name = "D1LikePatternTooLongError";
    this.code = "D1_LIKE_PATTERN_TOO_LONG";
    this.status = 400;
    this.byteLength = byteLength;
  }
}

/**
 * D1의 LIKE/GLOB pattern 50-byte 상한을 적용한 literal contains pattern.
 * SQL은 반드시 `LIKE ? ESCAPE '\'` 형태로 사용한다.
 */
export function d1ContainsPattern(value) {
  const escaped = String(value ?? "").replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const byteLength = new TextEncoder().encode(pattern).byteLength;
  if (byteLength > FREE_TIER_BUDGET.maxD1LikePatternBytes) {
    throw new D1LikePatternTooLongError(byteLength);
  }
  return pattern;
}
