const LEGACY_TLS_VERSIONS = new Set(["TLSv1", "TLSv1.0", "TLSv1.1"]);

export function enforceTransportSecurity(request) {
  const url = new URL(request.url);

  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    const secureUrl = new URL(url);
    secureUrl.protocol = "https:";
    return new Response(null, {
      status: 308,
      headers: { Location: secureUrl.toString() }
    });
  }

  const tlsVersion = String(request.cf?.tlsVersion || "");
  if (url.protocol === "https:" && LEGACY_TLS_VERSIONS.has(tlsVersion)) {
    return new Response("TLS 1.2 이상을 사용하세요.", {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  return null;
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}
