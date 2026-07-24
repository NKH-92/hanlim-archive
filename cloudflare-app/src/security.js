// 응답 보안 헤더 + CSP 단일 출처.
// HTML 응답은 page()가 nonce 기반 CSP를 직접 설정하고, 그 밖의 응답(JSON/리다이렉트/CSV/정적자산)은
// withSecurityHeaders가 제한적 폴백 CSP를 붙인다. 공통 헤더는 모든 응답에 일괄 주입한다.

// 인라인 <script>/<style> 블록은 요청별 nonce로 허용하고, style 속성과 인라인 이벤트 핸들러는
// 모두 금지한다. 동적 도면 값도 nonce가 붙는 <style> 규칙으로만 렌더링한다.
export function htmlContentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'none'",
    "font-src 'self' data:",
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
