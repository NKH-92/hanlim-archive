export function isTrustedPostOrigin(request) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return false;
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
