import { clean } from "../../../shared/text/normalize.js";

export function documentIdentity(number, revision) {
  return `${clean(number).toUpperCase()}\u0000${clean(revision).toUpperCase()}`;
}

export function parseDocumentIdentity(identity) {
  const [documentNumber = "", revisionNumber = ""] = String(identity || "").split("\u0000");
  return { documentNumber, revisionNumber };
}

export function isStableRowKey(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(clean(value));
}

export function temporaryStagingRowKey(snapshotId, rowNumber) {
  return `TMP-${Number(snapshotId)}-${Number(rowNumber)}-${crypto.randomUUID()}`;
}

export function serverGeneratedRowKey() {
  return `HLM-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
