export function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, ...headers }
  });
}

export function jsonResponse(body, { status = 200, cacheControl = "no-store", headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      ...headers
    }
  });
}
