import {
  clearLoginFailures,
  createSessionCookie,
  expiredSessionCookie,
  getMissingSetup,
  isLoginLocked,
  recordLoginFailure,
  validateUser
} from "../auth.js";
import { createSignupRequest } from "../db.js";
import { loginPage, signupPage } from "../html.js";
import { clean, redirect, sanitizeReturnUrl } from "../utils.js";

export function renderLogin(url, env) {
  return loginPage({
    returnUrl: url.searchParams.get("returnUrl") || "/app",
    error: clean(url.searchParams.get("error")),
    signupSubmitted: url.searchParams.has("signup"),
    setupWarning: getMissingSetup(env)
  });
}

export async function handleLogin(request, env) {
  const form = await request.formData();
  const username = clean(form.get("username"));
  const password = String(form.get("password") ?? "");
  const returnUrl = sanitizeReturnUrl(clean(form.get("returnUrl")) || "/app");

  if (await isLoginLocked(env, username)) {
    return redirect(`/login?error=locked&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  const user = await validateUser(env, username, password);

  if (!user) {
    await recordLoginFailure(env, username);
    return redirect(`/login?error=1&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  await clearLoginFailures(env, username);

  const secureCookie = new URL(request.url).protocol === "https:";
  const destination = returnUrl === "/" ? "/app" : returnUrl;
  return redirect(destination, { "Set-Cookie": await createSessionCookie(user, env, secureCookie) });
}

export function handleLogout(url) {
  return redirect("/login", { "Set-Cookie": expiredSessionCookie(url.protocol === "https:") });
}

export function renderSignup() {
  return signupPage({});
}

export async function handleSignup(request, env) {
  const form = await request.formData();
  const values = {
    username: clean(form.get("username")),
    displayName: clean(form.get("displayName")),
    password: String(form.get("password") ?? "")
  };
  const result = await createSignupRequest(env, values);

  if (!result.ok) {
    return signupPage({ values, error: result.message });
  }

  return redirect("/login?signup=1");
}
