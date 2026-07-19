import { pathToFileURL } from "node:url";
import path from "node:path";

const HEALTH_ATTEMPTS = 15;
const HEALTH_RETRY_MS = 1_000;

export async function runReleaseSmoke({ baseUrl, username, password, fetchImpl = fetch, waitImpl = wait }) {
  const origin = String(baseUrl || "").replace(/\/$/, "");
  if (!origin || !username || !password) throw new Error("SMOKE_BASE_URL, SMOKE_USERNAME, SMOKE_PASSWORD가 필요합니다.");

  let health;
  let healthOk = false;
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    health = await fetchImpl(`${origin}/healthz`, { redirect: "manual" });
    if (health.status === 200) {
      const body = await health.clone().json().catch(() => null);
      if (body?.ok) {
        healthOk = true;
        break;
      }
    }
    if (attempt < HEALTH_ATTEMPTS) await waitImpl(HEALTH_RETRY_MS);
  }
  if (!healthOk) throw new Error(`/healthz smoke 실패(status=${health?.status ?? "none"})`);

  const login = await fetchImpl(`${origin}/login`, { redirect: "manual" });
  if (login.status !== 200 || !(await login.text()).includes('name="username"')) throw new Error("/login smoke 실패");

  const signup = await fetchImpl(`${origin}/signup`, { redirect: "manual" });
  if (signup.status !== 404) throw new Error("/signup 404 계약 실패");

  const form = new FormData();
  form.set("username", username);
  form.set("password", password);
  form.set("returnUrl", "/app?q=release-smoke");
  const authenticated = await fetchImpl(`${origin}/login`, {
    method: "POST",
    headers: { Origin: origin },
    body: form,
    redirect: "manual"
  });
  if (![302, 303].includes(authenticated.status)) {
    const ray = authenticated.headers.get("cf-ray") || "none";
    throw new Error(`smoke 계정 로그인 실패(status=${authenticated.status}, cf-ray=${ray})`);
  }
  const location = authenticated.headers.get("location") || "";
  if (location.startsWith("/account/password")) throw new Error("smoke 계정은 최초 비밀번호 변경이 완료되어야 합니다.");
  const cookie = (authenticated.headers.get("set-cookie") || "").split(";", 1)[0];
  if (!cookie) throw new Error("smoke session cookie가 없습니다.");

  const search = await fetchImpl(`${origin}/app?q=release-smoke`, {
    headers: { Cookie: cookie },
    redirect: "manual"
  });
  const html = await search.text();
  if (search.status !== 200 || !html.includes("data-viewer-app")) throw new Error("인증 read-only 검색 smoke 실패");

  return Object.freeze({ health: health.status, login: login.status, signup: signup.status, search: search.status });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runReleaseSmoke({
    baseUrl: process.env.SMOKE_BASE_URL,
    username: process.env.SMOKE_USERNAME,
    password: process.env.SMOKE_PASSWORD
  });
  console.log(`✓ release smoke 통과: ${JSON.stringify(result)}`);
}
