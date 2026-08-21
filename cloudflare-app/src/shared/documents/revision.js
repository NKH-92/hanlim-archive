import { clean } from "../text/normalize.js";

export const NOT_APPLICABLE = "N/A";

export function normalizeImportedRevision(value) {
  const text = clean(value);
  if (!text || text.toUpperCase() === NOT_APPLICABLE) return null;
  const numeric = text.match(/^\d+$/);
  if (numeric) return `Rev.${numeric[0]}`;
  const prefixed = text.match(/^rev\.\s*(\d+)$/i);
  if (prefixed) return `Rev.${prefixed[1]}`;
  return text;
}

export function formatRevisionLabel(value) {
  const text = clean(value);
  if (!text || text.toUpperCase() === NOT_APPLICABLE) return NOT_APPLICABLE;
  if (/^rev\./i.test(text)) return `Rev.${text.slice(text.indexOf(".") + 1).trim()}`;
  return /^\d+$/.test(text) ? `Rev.${text}` : text;
}

export function revisionForExcel(value) {
  const text = clean(value);
  if (!text || text.toUpperCase() === NOT_APPLICABLE) return NOT_APPLICABLE;
  const prefixed = text.match(/^rev\.\s*(\d+)$/i);
  return prefixed ? prefixed[1] : text;
}

export function isCompleteDocumentIdentity(documentNumber, revisionNumber) {
  const number = clean(documentNumber);
  return Boolean(number && number.toUpperCase() !== NOT_APPLICABLE && clean(revisionNumber));
}
