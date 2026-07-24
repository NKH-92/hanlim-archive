import {
  clearLoginFailures,
  createSessionCookie,
  expiredSessionCookie,
  getMissingSetup,
  isLoginLocked,
  loginThrottleContext,
  recordLoginFailure,
  revokeUserSessions,
  validateUser
} from "../auth.js";
import { createMfaChallengeCookie } from "../auth/mfaChallenge.js";
import { isPasswordInputBounded } from "../auth/passwords.js";
import { getAppConfig } from "../config.js";
import { loginPage } from "../views/authViews.js";
import { redirect } from "../platform/http/responses.js";
import { sanitizeReturnUrl } from "../platform/security/returnUrl.js";
import { clean } from "../shared/text/normalize.js";

export function renderLogin(url, env) {
  return loginPage({
    returnUrl: url.searchParams.get("returnUrl") || "/app",
    error: clean(url.searchParams.get("error")),
    signupSubmitted: url.searchParams.has("signup"),
    setupWarning: getMissingSetup(env),
    support: getAppConfig(env).support
  });
}

export async function handleLogin(request, env) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 8192) {
    const throttle = loginThrottleContext(request, "");
    await recordLoginFailure(env, throttle);
    return redirect("/login?error=1&returnUrl=%2Fapp");
  }
  const form = await request.formData();
  const username = clean(form.get("username"));
  const password = String(form.get("password") ?? "");
  const returnUrl = sanitizeReturnUrl(clean(form.get("returnUrl")) || "/app");
  const throttleIdentity = loginThrottleContext(request, username);

  if (await isLoginLocked(env, throttleIdentity)) {
    return redirect(`/login?error=locked&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  const inputIsBounded = username.length <= 320 && isPasswordInputBounded(password);
  const user = inputIsBounded ? await validateUser(env, username, password) : null;

  if (!user) {
    await recordLoginFailure(env, throttleIdentity);
    return redirect(`/login?error=1&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  const secureCookie = new URL(request.url).protocol === "https:";
  // 최초 비밀번호 변경 대상은 전달된 returnUrl보다 변경 화면을 우선한다.
  const destination = user.mustChangePassword
    ? "/account/password?required=1"
    : returnUrl === "/" ? "/app" : returnUrl;
  if (user.mfaEnabled && !user.mustChangePassword) {
    const challengeCookie = await createMfaChallengeCookie({
      userId: user.userId,
      username: user.username,
      sessionEpoch: user.sessionEpoch,
      returnUrl: destination
    }, env, secureCookie);
    return redirect("/login/mfa", { "Set-Cookie": challengeCookie });
  }
  await clearLoginFailures(env, throttleIdentity);
  return redirect(destination, { "Set-Cookie": await createSessionCookie(user, env, secureCookie) });
}

export async function handleLogout(url, env, session) {
  await revokeUserSessions(env, session.username, session.sessionEpoch);
  return redirect("/login", { "Set-Cookie": expiredSessionCookie(url.protocol === "https:") });
}
