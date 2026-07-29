import { clean } from "../../../shared/text/normalize.js";

export const APPROVED_USER_LIMITS = Object.freeze({
  username: 254,
  displayName: 60,
  team: 40
});

export const PROTECTED_APPROVED_USERNAMES = Object.freeze(new Set([
  "nkh92@hanlim.com",
  "release-smoke@hanlim.internal"
]));

export function normalizeApprovedUser(values = {}) {
  return Object.freeze({
    username: clean(values.username).toLowerCase(),
    displayName: clean(values.displayName),
    team: clean(values.team)
  });
}

export function validateApprovedUser(values = {}) {
  const normalized = normalizeApprovedUser(values);
  if (
    !normalized.username
    || normalized.username.length > APPROVED_USER_LIMITS.username
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.username)
  ) {
    return { ok: false, values: normalized, message: "이메일 형식의 사용자 아이디를 입력하세요." };
  }
  if (PROTECTED_APPROVED_USERNAMES.has(normalized.username)) {
    return { ok: false, values: normalized, message: "보호된 운영 계정은 이 화면에서 추가할 수 없습니다." };
  }
  if (!normalized.displayName || normalized.displayName.length > APPROVED_USER_LIMITS.displayName) {
    return {
      ok: false,
      values: normalized,
      message: `이름은 1~${APPROVED_USER_LIMITS.displayName}자로 입력하세요.`
    };
  }
  if (normalized.team.length > APPROVED_USER_LIMITS.team) {
    return {
      ok: false,
      values: normalized,
      message: `부서는 ${APPROVED_USER_LIMITS.team}자 이하로 입력하세요.`
    };
  }
  return { ok: true, values: normalized };
}
