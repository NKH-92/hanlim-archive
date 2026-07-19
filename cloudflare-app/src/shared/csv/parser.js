import { clean } from "../text/normalize.js";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; index += 1; }
      else if (char === '"') inQuotes = false;
      else field += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (inQuotes) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  row.push(field);
  rows.push(row);
  const nonEmptyRows = rows.filter((items) => items.some((item) => clean(item)));
  if (!nonEmptyRows.length) return [];
  const headers = nonEmptyRows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
  return nonEmptyRows.slice(1).map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])));
}
