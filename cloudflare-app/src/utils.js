export function clean(value) {
  return String(value ?? "").trim();
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
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
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

export function equalsIgnoreCase(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export function locationLabel(doc) {
  const zone = doc.zone_number ? `${doc.zone_number}구역` : doc.rack_code;
  const rack = doc.rack_number ? `${doc.rack_number}번 랙` : doc.rack_code;
  const column = doc.column_number ? `${doc.column_number}열` : "";
  const shelf = doc.shelf_number ? `${doc.shelf_number}선반` : doc.slot_code ? `칸 ${doc.slot_code}` : "";
  const face = doc.rack_face ? `${doc.rack_face}면` : "";

  return [zone, rack, column, shelf, face].filter(Boolean).join(" / ");
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
