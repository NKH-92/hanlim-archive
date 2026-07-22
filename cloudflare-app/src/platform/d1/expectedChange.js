// D1/SQLite batch 안에서 기대 변경 실패를 트랜잭션 abort로 전환한다.
// RAISE()는 trigger 밖에서 쓸 수 없고, 1/0은 SQLite에서 NULL이라 abort되지 않는다.
// integer overflow는 statement failure를 내므로 batch 전체가 rollback된다.

export const STALE_VERSION_ABORT = "STALE_VERSION";

/** SQLite/D1에서 실제로 statement failure를 내는 overflow 식. */
const ABORT_EXPR = `abs(-9223372036854775808)`;

export function expectedChangeAssertionSql() {
  // changes()=0이면 overflow로 statement 실패 → batch 전체 rollback.
  // STALE_VERSION 문자열은 SQL 본문에 포함되어 게이트가 AssertionError 메시지가 아닌 실제 abort SQL을 검사한다.
  return `SELECT CASE WHEN changes() = 0 THEN (SELECT ${ABORT_EXPR} FROM (SELECT '${STALE_VERSION_ABORT}' AS abort_reason)) ELSE changes() END AS changed`;
}

export function exactChangeCountAssertionSql(expectedCountExpression) {
  return `SELECT CASE WHEN changes() = (${expectedCountExpression}) THEN changes() ELSE (SELECT ${ABORT_EXPR} FROM (SELECT '${STALE_VERSION_ABORT}' AS abort_reason)) END AS changed`;
}

export function isExpectedChangeAbort(error) {
  if (error?.code === STALE_VERSION_ABORT || error?.name === "D1ExpectedChangeError") return true;
  const message = String(error?.message || error || "");
  return /STALE_VERSION|integer overflow/i.test(message);
}
