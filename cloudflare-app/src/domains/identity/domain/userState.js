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
