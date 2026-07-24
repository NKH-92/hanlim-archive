import {
  clearLoginFailures,
  createSessionCookie,
  isLoginLocked,
  loginThrottleContext,
  recordLoginFailure
} from "../auth.js";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  getMfaStatus,
  verifyMfaLogin
} from "../auth/mfa.js";
import {
  createMfaChallengeCookie,
  expiredMfaChallengeCookie,
  readMfaChallenge
} from "../auth/mfaChallenge.js";
import { isPasswordInputBounded } from "../auth/passwords.js";
import { redirect } from "../platform/http/responses.js";
import { sanitizeReturnUrl } from "../platform/security/returnUrl.js";
import { mfaLoginPage, mfaSettingsPage } from "../views/mfaViews.js";

export async function renderMfaLogin(request, env) {
  const challenge = await readMfaChallenge(request, env);
  return challenge ? mfaLoginPage() : redirect("/login");
}

export async function handleMfaLogin(request, env) {
  const challenge = await readMfaChallenge(request, env);
  if (!challenge) return redirect("/login");
  const throttle = loginThrottleContext(request, challenge.username);
  if (await isLoginLocked(env, throttle)) {
    return mfaLoginPage({ error: "로그인 실패가 반복되어 잠시 제한되었습니다." });
  }
  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim().slice(0, 20);
  const user = await verifyMfaLogin(env, challenge, code);
  const secure = new URL(request.url).protocol === "https:";
  if (!user) {
    await recordLoginFailure(env, throttle);
    const retryCookie = await createMfaChallengeCookie({
      ...challenge,
      attempts: Number(challenge.attempts || 0) + 1
    }, env, secure);
    return withCookies(mfaLoginPage({ error: "인증 코드가 올바르지 않거나 이미 사용되었습니다." }), [retryCookie]);
  }
  await clearLoginFailures(env, throttle);
  const destination = sanitizeReturnUrl(challenge.returnUrl || "/app");
  return redirectWithCookies(destination, [
    await createSessionCookie(user, env, secure),
    expiredMfaChallengeCookie(secure)
  ]);
}

export async function renderMfaSettings(env, session, options = {}) {
  return mfaSettingsPage({
    session,
    status: await getMfaStatus(env, session.userId),
    ...options
  });
}

export async function handleBeginMfaEnrollment(request, env, session) {
  const throttle = loginThrottleContext(request, session.username);
  if (await isLoginLocked(env, throttle)) {
    return renderMfaSettings(env, session, { error: "인증 실패가 반복되어 잠시 제한되었습니다." });
  }
  const form = await request.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  if (!isPasswordInputBounded(currentPassword)) {
    await recordLoginFailure(env, throttle);
    return renderMfaSettings(env, session, { error: "입력값이 올바르지 않습니다." });
  }
  try {
    const result = await beginMfaEnrollment(env, session, { currentPassword });
    if (!result.ok) {
      if (result.authFailed) await recordLoginFailure(env, throttle);
      return renderMfaSettings(env, session, { error: result.message });
    }
    await clearLoginFailures(env, throttle);
    return renderMfaSettings(env, session, { enrollment: result });
  } catch {
    return renderMfaSettings(env, session, {
      error: "2단계 인증 암호화 설정을 확인할 수 없습니다. 운영 관리자에게 문의하세요."
    });
  }
}

export async function handleConfirmMfaEnrollment(request, env, session) {
  const throttle = loginThrottleContext(request, session.username);
  if (await isLoginLocked(env, throttle)) {
    return renderMfaSettings(env, session, { error: "인증 실패가 반복되어 잠시 제한되었습니다." });
  }
  const form = await request.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const code = String(form.get("code") ?? "").trim().slice(0, 20);
  if (!isPasswordInputBounded(currentPassword)) {
    await recordLoginFailure(env, throttle);
    return renderMfaSettings(env, session, { error: "입력값이 올바르지 않습니다." });
  }
  try {
    const result = await confirmMfaEnrollment(env, session, { currentPassword, code });
    if (!result.ok) {
      await recordLoginFailure(env, throttle);
      return renderMfaSettings(env, session, { error: result.message });
    }
    await clearLoginFailures(env, throttle);
    const refreshed = { ...session, sessionEpoch: result.sessionEpoch };
    const response = await renderMfaSettings(env, refreshed, {
      recoveryCodes: result.recoveryCodes,
      success: "2단계 인증이 활성화되었습니다."
    });
    return withCookies(response, [
      await createSessionCookie(refreshed, env, new URL(request.url).protocol === "https:")
    ]);
  } catch {
    return renderMfaSettings(env, session, { error: "2단계 인증을 활성화하지 못했습니다." });
  }
}

export async function handleDisableMfa(request, env, session) {
  const throttle = loginThrottleContext(request, session.username);
  if (await isLoginLocked(env, throttle)) {
    return renderMfaSettings(env, session, { error: "인증 실패가 반복되어 잠시 제한되었습니다." });
  }
  const form = await request.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const code = String(form.get("code") ?? "").trim().slice(0, 20);
  if (!isPasswordInputBounded(currentPassword)) {
    await recordLoginFailure(env, throttle);
    return renderMfaSettings(env, session, { error: "입력값이 올바르지 않습니다." });
  }
  try {
    const result = await disableMfa(env, session, { currentPassword, code });
    if (!result.ok) {
      await recordLoginFailure(env, throttle);
      return renderMfaSettings(env, session, { error: result.message });
    }
    await clearLoginFailures(env, throttle);
    const refreshed = { ...session, sessionEpoch: result.sessionEpoch };
    const response = await renderMfaSettings(env, refreshed, {
      success: "2단계 인증이 비활성화되었습니다."
    });
    return withCookies(response, [
      await createSessionCookie(refreshed, env, new URL(request.url).protocol === "https:")
    ]);
  } catch {
    return renderMfaSettings(env, session, { error: "2단계 인증을 비활성화하지 못했습니다." });
  }
}

function redirectWithCookies(location, cookies) {
  return withCookies(redirect(location), cookies);
}

function withCookies(response, cookies) {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
