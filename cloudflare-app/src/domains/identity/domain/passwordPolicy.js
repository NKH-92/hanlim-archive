export const PASSWORD_POLICY = Object.freeze({ minLength: 8 });

export function validateNewPassword(password, { label = "새 비밀번호" } = {}) {
  const value = String(password ?? "");
  return value.length >= PASSWORD_POLICY.minLength
    ? Object.freeze({ ok: true })
    : Object.freeze({ ok: false, message: `${label}는 ${PASSWORD_POLICY.minLength}자 이상이어야 합니다.` });
}
