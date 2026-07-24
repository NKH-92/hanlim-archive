export async function servePublicAsset(request, assets) {
  const response = await assets.fetch(request);
  if (request.method === "HEAD") return headResponse(response);
  if (request.method !== "GET" || response.status !== 200) return response;

  const requestTag = request.headers.get("If-None-Match");
  const responseTag = response.headers.get("ETag");
  if (!requestTag || !responseTag || !etagMatches(requestTag, responseTag)) return response;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(null, {
    status: 304,
    headers
  });
}

export function headResponse(response) {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function etagMatches(requestTag, responseTag) {
  if (requestTag.trim() === "*") return true;
  const normalizedResponse = weakEtag(responseTag);
  return requestTag.split(",").some((candidate) => weakEtag(candidate) === normalizedResponse);
}

function weakEtag(value) {
  return String(value || "").trim().replace(/^W\//, "");
}
