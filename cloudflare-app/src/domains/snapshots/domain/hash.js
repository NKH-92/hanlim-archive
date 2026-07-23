import { buildCanonicalValues } from "./diff.js";

export const SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = Object.freeze(new Set([1, 2]));

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalizeSnapshotRows(rows = []) {
  const ordered = [...rows].sort((left, right) => Number(left.rowNumber) - Number(right.rowNumber));
  return ordered.map((row) => ({
    rowNumber: Number(row.rowNumber),
    rowKey: row.rowKey || null,
    status: row.status,
    values: buildCanonicalValues(row.values || row)
  }));
}

export async function computeCanonicalRowsHash(rows = []) {
  const canonical = canonicalizeSnapshotRows(rows);
  return sha256Hex(stableStringify(canonical));
}

export async function computeExportManifestHash(documents = []) {
  const canonical = [...documents]
    .map((document) => ({ ...document }))
    .sort((left, right) => String(left.rowKey || "").localeCompare(String(right.rowKey || "")));
  return sha256Hex(stableStringify(canonical));
}

export async function computeExportPageChainHash(pages = []) {
  const canonical = [...pages]
    .map((page) => ({
      pageNumber: Number(page.page_number ?? page.pageNumber),
      rowOffset: Number(page.row_offset ?? page.rowOffset),
      rowCount: Number(page.row_count ?? page.rowCount),
      pageHash: String((page.page_hash ?? page.pageHash) || "")
    }))
    .sort((left, right) => left.pageNumber - right.pageNumber);
  return sha256Hex(stableStringify(canonical));
}
