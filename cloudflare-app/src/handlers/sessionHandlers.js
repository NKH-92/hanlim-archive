import {
  clearLoginFailures,
  createSessionCookie,
  expiredSessionCookie,
  getMissingSetup,
  isLoginLocked,
  recordLoginFailure,
  revokeUserSessions,
  validateUser
} from "../auth.js";
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
  const form = await request.formData();
  const username = clean(form.get("username"));
  const password = String(form.get("password") ?? "");
  const returnUrl = sanitizeReturnUrl(clean(form.get("returnUrl")) || "/app");
  const throttleIdentity = loginThrottleIdentity(request, username);

  if (await isLoginLocked(env, throttleIdentity)) {
    return redirect(`/login?error=locked&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  const user = await validateUser(env, username, password);

  if (!user) {
    await recordLoginFailure(env, throttleIdentity);
    return redirect(`/login?error=1&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  await clearLoginFailures(env, throttleIdentity);

  const secureCookie = new URL(request.url).protocol === "https:";
  // 최초 비밀번호 변경 대상은 전달된 returnUrl보다 변경 화면을 우선한다.
  const destination = user.mustChangePassword
    ? "/account/password?required=1"
    : returnUrl === "/" ? "/app" : returnUrl;
  return redirect(destination, { "Set-Cookie": await createSessionCookie(user, env, secureCookie) });
}

export async function handleLogout(url, env, session) {
  await revokeUserSessions(env, session.username, session.sessionEpoch);
  return redirect("/login", { "Set-Cookie": expiredSessionCookie(url.protocol === "https:") });
}

// 계정명만으로 잠그면 이메일을 아는 제3자가 관리자의 로그인을 방해할 수 있다.
// Cloudflare가 설정하는 접속 IP와 조합해 실패 제한을 접속 출처별로 격리한다.
function loginThrottleIdentity(request, username) {
  const normalizedUsername = String(username ?? "").trim().toLowerCase();
  if (!normalizedUsername) return "";

  const clientAddress = String(request.headers.get("CF-Connecting-IP") || "unknown")
    .trim()
    .toLowerCase()
    .slice(0, 128) || "unknown";
  return `${normalizedUsername}|${clientAddress}`;
}
