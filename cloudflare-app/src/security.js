// 응답 보안 헤더 + CSP 단일 출처.
// HTML 응답은 page()가 nonce 기반 CSP를 직접 설정하고, 그 밖의 응답(JSON/리다이렉트/CSV/정적자산)은
// withSecurityHeaders가 제한적 폴백 CSP를 붙인다. 공통 헤더는 모든 응답에 일괄 주입한다.

// 폰트/아이콘을 아직 CDN에서 받으므로 style-src/font-src에 두 호스트만 명시적으로 허용한다.
// self-host로 전환하면 이 목록을 지우고 default-src 'self'만으로 충분하다.
export const CDN_HOSTS = Object.freeze([
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com"
]);

// 인라인 <style> 블록과 동적 위치용 style="--var" 속성 때문에 style-src는 'unsafe-inline'이 필요하다.
// script-src는 인라인 이벤트 핸들러가 전혀 없어 nonce로 엄격하게 잠근다(XSS 방어심층의 핵심).
export function htmlContentSecurityPolicy(nonce) {
  const cdn = CDN_HOSTS.join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline' ${cdn}`,
    `font-src 'self' data: ${cdn}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'"
  ].join("; ");
}

// HTML이 아닌 응답(JSON API, 302, CSV, 정적자산)에 붙이는 최소 CSP.
const RESTRICTIVE_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

function baseSecurityHeaders(secure) {
  const headers = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    // 내부 규제 도구 — 검색엔진 색인 대상이 아니다.
    "X-Robots-Tag": "noindex, nofollow"
  };
  if (secure) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

// 모든 응답에 공통 보안 헤더를 주입한다. 이미 CSP가 있으면(HTML의 nonce CSP) 유지하고,
// 없으면 제한적 폴백 CSP를 붙인다. 원본 Response의 body/status를 보존한 새 Response를 만든다.
export function withSecurityHeaders(response, request) {
  const secure = new URL(request.url).protocol === "https:";
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(baseSecurityHeaders(secure))) {
    headers.set(key, value);
  }
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", RESTRICTIVE_CSP);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
