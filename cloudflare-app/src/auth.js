// 인증 공개 파사드. 호출부는 이 파일만 사용하고 세부 구현은 auth/*에 둔다.
export {
  cleanupLoginThrottle,
  clearLoginFailures,
  isLoginLocked,
  loginThrottleContext,
  recordLoginFailure
} from "./auth/throttle.js";

export {
  changeUserPassword,
  createPasswordRecord
} from "./auth/passwords.js";

export { cleanupExpiredReleaseSmokePrincipals, validateUser } from "./auth/users.js";

export {
  createSessionCookie,
  expiredSessionCookie,
  getMissingSetup,
  readSession,
  revokeUserSessions,
  SESSION_COOKIE
} from "./auth/session.js";

export { sessionToActor } from "./domains/identity/index.js";
