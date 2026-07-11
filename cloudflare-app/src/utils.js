import { sharedSearchCore } from "./searchCore.js";

export function clean(value) {
  return String(value ?? "").trim();
}

// 구조화 에러 로그. Cloudflare Workers Logs/Tail에서 JSON으로 파싱·필터링할 수 있게 한 줄로 남긴다.
// 폴백으로 조용히 넘어가던 실패(특히 위치·도면 조회)를 운영에서 관측 가능하게 만든다.
export function logError(context, error, extra = {}) {
  try {
    console.error(JSON.stringify({
      level: "error",
      at: context,
      message: error && error.message ? error.message : String(error),
      ...extra
    }));
  } catch {
    console.error(context, error);
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function normalizePath(path) {
  return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}

export function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      ...headers
    }
  });
}

export function sanitizeReturnUrl(value) {
  const candidate = String(value ?? "");
  // 앱 내부 경로만 허용한다. 백슬래시(브라우저가 "/"로 정규화 → //evil.com 오픈 리다이렉트),
  // 프로토콜 상대(//), 스킴 포함(http:), 제어문자는 모두 거부한다.
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/";
  }
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return "/";
    }
  }
  return candidate;
}
export function isTrustedPostOrigin(request) {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "cross-site") {
    return false;
  }

  const origin = request.headers.get("Origin");
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function isValidCsrfToken(request, session) {
  if (request.method !== "POST") {
    return true;
  }

  try {
    const form = await request.clone().formData();
    const token = String(form.get("csrf_token") ?? "");
    return token.length > 0 && token === session.csrfToken;
  } catch {
    return false;
  }
}

export function parseCookies(header) {
  return Object.fromEntries(header.split(";").map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, rest.join("=")];
  }).filter(([key]) => key));
}

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }

  return diff === 0;
}

// 면 입력 정규화: 사용자 표기(1/2)와 저장값(A/B)을 모두 받아 저장값으로 통일한다.
// 매핑되지 않는 값은 그대로 대문자로 돌려보내 검증 단계에서 걸리게 한다.
export function normalizeRackFace(value) {
  const raw = clean(value).toUpperCase();
  if (raw === "1" || raw === "1면") return "A";
  if (raw === "2" || raw === "2면") return "B";
  return raw;
}

// 랙 면 표기: 실물 라벨 규칙(단면 "13", 양면 "13-1"/"13-2")의 단일 출처는 searchCore다.
// 서버·브라우저가 같은 규칙을 쓰도록 여기서는 위임만 한다.
export function rackFaceLabel(doc) {
  return sharedSearchCore.rackFaceLabel(doc);
}

export function locationLabel(doc) {
  const zone = doc.zone_number ? `${doc.zone_number}구역` : doc.rack_code;
  const rack = rackFaceLabel(doc) ? `${rackFaceLabel(doc)}번 랙` : doc.rack_code;
  const column = doc.column_number ? `${doc.column_number}열` : "";
  const shelf = doc.shelf_number ? `${doc.shelf_number}선반` : doc.slot_code ? `칸 ${doc.slot_code}` : "";

  return [zone, rack, column, shelf].filter(Boolean).join(" / ");
}

export function readBoolean(value) {
  return value === 1 || value === true || value === "1";
}

export function csvEscape(value) {
  const text = neutralizeCsvFormula(String(value ?? ""));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  }

  row.push(field);
  rows.push(row);

  const nonEmptyRows = rows.filter((items) => items.some((item) => clean(item)));
  if (!nonEmptyRows.length) {
    return [];
  }

  const headers = nonEmptyRows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
  return nonEmptyRows.slice(1).map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])));
}

function neutralizeCsvFormula(text) {
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}
