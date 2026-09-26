// 정적 asset binding은 Range 요청에도 전체 200을 돌려준다. iOS Safari는 206 응답이 없으면
// <video>를 재생하지 않으므로, Worker를 거치는 asset(/media/*)은 단일 byte range를 여기서 잘라 준다.
export async function servePublicAsset(request, assets) {
  const response = await assets.fetch(request);
  if (request.method === "HEAD") return headResponse(response);
  if (request.method !== "GET" || response.status !== 200) return response;

  const requestTag = request.headers.get("If-None-Match");
  const responseTag = response.headers.get("ETag");
  if (!requestTag || !responseTag || !etagMatches(requestTag, responseTag)) return byteRangeResponse(request, response);

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

async function byteRangeResponse(request, response) {
  const rangeHeader = request.headers.get("Range");
  // 압축 전송 본문은 byte 위치가 달라지므로 자르지 않는다.
  if (!rangeHeader || response.headers.has("Content-Encoding") || !ifRangeMatches(request, response)) return response;

  const body = await response.arrayBuffer();
  const range = parseByteRange(rangeHeader, body.byteLength);
  const headers = new Headers(response.headers);
  headers.set("Accept-Ranges", "bytes");
  // 여러 구간·해석할 수 없는 Range는 무시하고 전체를 준다(RFC 9110 허용).
  if (!range) return new Response(body, { status: 200, headers });
  if (range.unsatisfiable) {
    headers.delete("Content-Length");
    headers.set("Content-Range", `bytes */${body.byteLength}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Length", String(range.end - range.start + 1));
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${body.byteLength}`);
  return new Response(body.slice(range.start, range.end + 1), { status: 206, headers });
}

// If-Range는 강한 ETag가 같을 때만 부분 응답을 허용한다. 날짜 형식은 비교하지 않고 전체를 준다.
function ifRangeMatches(request, response) {
  const condition = request.headers.get("If-Range")?.trim();
  if (!condition) return true;
  const responseTag = response.headers.get("ETag")?.trim();
  return Boolean(responseTag) && !condition.startsWith("W/") && condition === responseTag;
}

function parseByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!suffixLength || !size) return { unsatisfiable: true };
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  if (match[2] && Number(match[2]) < start) return null;
  if (start >= size) return { unsatisfiable: true };
  return { start, end: match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 };
}

function etagMatches(requestTag, responseTag) {
  if (requestTag.trim() === "*") return true;
  const normalizedResponse = weakEtag(responseTag);
  return requestTag.split(",").some((candidate) => weakEtag(candidate) === normalizedResponse);
}

function weakEtag(value) {
  return String(value || "").trim().replace(/^W\//, "");
}
