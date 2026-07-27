export const USER_STATUS_TRANSITIONS = Object.freeze({
  approve: Object.freeze({ from: Object.freeze(["pending", "rejected"]), to: "approved" }),
  reject: Object.freeze({ from: Object.freeze(["pending"]), to: "rejected" }),
  disable: Object.freeze({ from: Object.freeze(["approved"]), to: "disabled" }),
  enable: Object.freeze({ from: Object.freeze(["disabled"]), to: "approved" })
});

export function canTransitionUser(user, action) {
  const transition = USER_STATUS_TRANSITIONS[action];
  return Boolean(
    transition
    && user?.role === "User"
    && Number(user.security_review_required || 0) !== 1
    && transition.from.includes(user.status)
  );
}

export function transitionFor(action) {
  const transition = USER_STATUS_TRANSITIONS[action];
  if (!transition) throw new TypeError(`지원하지 않는 사용자 상태 전이: ${action}`);
  return transition;
}

// 완전삭제는 상태 전이가 아니라 계정 행 제거다. 상태 전이 가드와 달리 보안 검토 대상과
// Admin 계정도 정리 대상이 될 수 있으므로, 자기 계정과 마지막 Admin만 막는다.
/**
 * @param {Record<string, any> | null | undefined} user
 * @param {Record<string, any> | null | undefined} actor
 * @param {{ remainingAdminCount?: number }} [options]
 * @returns {string} 거부 사유. 빈 문자열이면 삭제 가능하다.
 */
export function userDeletionRefusal(user, actor, options = {}) {
  const remainingAdminCount = Number(options.remainingAdminCount || 0);
  if (!user) return "삭제할 사용자를 찾을 수 없습니다.";
  if (actor?.role !== "Admin") return "계정 완전삭제는 시스템 관리자만 수행할 수 있습니다.";
  if (Number(user.id) === Number(actor?.userId) || user.username === actor?.username) {
    return "현재 로그인한 계정은 삭제할 수 없습니다.";
  }
  if (user.role === "Admin" && remainingAdminCount < 1) {
    return "마지막 시스템 관리자 계정은 삭제할 수 없습니다.";
  }
  return "";
}
