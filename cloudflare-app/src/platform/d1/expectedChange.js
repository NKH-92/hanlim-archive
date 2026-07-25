// D1/SQLite batch 안에서 기대 변경 실패를 트랜잭션 abort로 전환한다.
// RAISE()는 trigger 밖에서 쓸 수 없고, 1/0은 SQLite에서 NULL이라 abort되지 않는다.
// 유효하지 않은 JSON path는 sentinel을 오류에 보존한 채 statement와 batch를 rollback한다.

export const STALE_VERSION_ABORT = "STALE_VERSION";

/** SQLite/D1에서 오류 본문에 STALE_VERSION을 남기는 결정적 failure 식. */
const ABORT_EXPR = `json_extract('{}', '${STALE_VERSION_ABORT}')`;

export function expectedChangeAssertionSql() {
  // changes()=0이면 malformed JSON path 오류 → batch 전체 rollback.
  return `SELECT CASE WHEN changes() = 0 THEN (SELECT ${ABORT_EXPR} FROM (SELECT '${STALE_VERSION_ABORT}' AS abort_reason)) ELSE changes() END AS changed`;
}

export function exactChangeCountAssertionSql(expectedCountExpression) {
  return `SELECT CASE WHEN changes() = (${expectedCountExpression}) THEN changes() ELSE (SELECT ${ABORT_EXPR} FROM (SELECT '${STALE_VERSION_ABORT}' AS abort_reason)) END AS changed`;
}

export function isExpectedChangeAbort(error) {
  let current = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (current?.code === STALE_VERSION_ABORT || current?.name === "D1ExpectedChangeError") {
      return true;
    }
    const message = String(current?.message || current || "");
    if (/STALE_VERSION/i.test(message)) return true;
    current = current?.cause;
  }
  return false;
}
