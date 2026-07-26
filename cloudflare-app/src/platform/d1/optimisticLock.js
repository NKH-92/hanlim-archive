import { clean } from "../../shared/text/normalize.js";

// 낙관적 잠금 절: 화면을 연 시점의 updated_at/row_version과 현재가 다르면 no-op이 된다.
export function optimisticLockClause(expectedUpdatedAt, expectedRowVersion) {
  const expected = clean(expectedUpdatedAt);
  const version = Number(expectedRowVersion);
  if (!expected && !(Number.isInteger(version) && version > 0)) {
    return { sql: "", binds: [] };
  }
  return {
    sql: `${expected ? " AND updated_at = ?" : ""}${Number.isInteger(version) && version > 0 ? " AND row_version = ?" : ""}`,
    binds: [...(expected ? [expected] : []), ...(Number.isInteger(version) && version > 0 ? [version] : [])]
  };
}
