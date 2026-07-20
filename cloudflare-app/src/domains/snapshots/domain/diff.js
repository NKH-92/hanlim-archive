import { clean } from "../../../shared/text/normalize.js";

export const CHANGE_FLAGS = Object.freeze({
  CREATE: "CREATE",
  METADATA: "METADATA",
  MOVE: "MOVE",
  DISPOSE: "DISPOSE",
  RESTORE: "RESTORE",
  TAG_CHANGE: "TAG_CHANGE",
  REINCLUDE: "REINCLUDE",
  UNCHANGED: "UNCHANGED"
});

const METADATA_FIELDS = Object.freeze([
  "documentNumber",
  "revisionNumber",
  "revisionDate",
  "disposalDueYear",
  "documentName",
  "categoryId",
  "note"
]);

function sameSortedNumbers(left = [], right = []) {
  const a = [...new Set(left.map(Number))].sort((x, y) => x - y);
  const b = [...new Set(right.map(Number))].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildCanonicalValues({
  documentNumber,
  revisionNumber,
  revisionDate,
  disposalDueYear,
  documentName,
  categoryId,
  categoryName = "",
  rackSlotId,
  rackCode = "",
  rackColumn = null,
  shelfNumber = null,
  rackFace,
  tagIds = [],
  tagNames = [],
  note = "",
  status,
  syncState = "current"
}) {
  return {
    documentNumber: clean(documentNumber),
    revisionNumber: clean(revisionNumber),
    revisionDate: clean(revisionDate),
    disposalDueYear: nullableNumber(disposalDueYear),
    documentName: clean(documentName),
    categoryId: Number(categoryId) || 0,
    categoryName: clean(categoryName),
    rackSlotId: Number(rackSlotId) || 0,
    rackCode: clean(rackCode),
    rackColumn: nullableNumber(rackColumn),
    shelfNumber: nullableNumber(shelfNumber),
    rackFace: clean(rackFace),
    tagIds: [...new Set(tagIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b),
    tagNames: [...new Set(tagNames.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    note: clean(note),
    status: clean(status),
    syncState: clean(syncState) || "current"
  };
}

export function buildDiffPayload({ schemaVersion = 1, rowKey, values }) {
  return {
    schemaVersion,
    rowKey: clean(rowKey),
    values: buildCanonicalValues(values)
  };
}

export function computeChangedFields(beforeValues, afterValues) {
  const before = buildCanonicalValues(beforeValues || {});
  const after = buildCanonicalValues(afterValues || {});
  const changed = [];
  for (const field of [
    ...METADATA_FIELDS,
    "rackSlotId",
    "rackFace",
    "tagIds",
    "status",
    "syncState"
  ]) {
    if (field === "tagIds") {
      if (!sameSortedNumbers(before.tagIds, after.tagIds)) changed.push(field);
      continue;
    }
    if (field === "disposalDueYear") {
      if (nullableNumber(before.disposalDueYear) !== nullableNumber(after.disposalDueYear)) changed.push(field);
      continue;
    }
    if (clean(String(before[field] ?? "")) !== clean(String(after[field] ?? ""))) changed.push(field);
  }
  return changed;
}

export function computeChangeFlags({ action, beforeValues, afterValues, changedFields = [] }) {
  if (action === "create") return [CHANGE_FLAGS.CREATE];
  const fields = changedFields.length ? changedFields : computeChangedFields(beforeValues, afterValues);
  const flags = [];
  if (beforeValues?.syncState === "excluded" && afterValues?.syncState === "current") {
    flags.push(CHANGE_FLAGS.REINCLUDE);
  }
  if (fields.some((field) => METADATA_FIELDS.includes(field))) flags.push(CHANGE_FLAGS.METADATA);
  if (fields.includes("rackSlotId") || fields.includes("rackFace")) flags.push(CHANGE_FLAGS.MOVE);
  if (fields.includes("status") && beforeValues?.status === "active" && afterValues?.status === "disposed") {
    flags.push(CHANGE_FLAGS.DISPOSE);
  }
  if (fields.includes("status") && beforeValues?.status === "disposed" && afterValues?.status === "active") {
    flags.push(CHANGE_FLAGS.RESTORE);
  }
  if (fields.includes("tagIds")) flags.push(CHANGE_FLAGS.TAG_CHANGE);
  if (!flags.length) flags.push(CHANGE_FLAGS.UNCHANGED);
  return flags;
}

export function summarizeChangeFlags(rows = [], excludeCount = 0) {
  const summary = {
    createCount: 0,
    metadataCount: 0,
    moveCount: 0,
    disposeCount: 0,
    restoreCount: 0,
    tagChangeCount: 0,
    reincludeCount: 0,
    unchangedCount: 0,
    updateCount: 0,
    excludeCount: Number(excludeCount) || 0
  };
  for (const row of rows) {
    const flags = row.changeFlags || [];
    if (flags.includes(CHANGE_FLAGS.CREATE)) summary.createCount += 1;
    else if (flags.includes(CHANGE_FLAGS.UNCHANGED) && flags.length === 1) summary.unchangedCount += 1;
    else summary.updateCount += 1;
    if (flags.includes(CHANGE_FLAGS.METADATA)) summary.metadataCount += 1;
    if (flags.includes(CHANGE_FLAGS.MOVE)) summary.moveCount += 1;
    if (flags.includes(CHANGE_FLAGS.DISPOSE)) summary.disposeCount += 1;
    if (flags.includes(CHANGE_FLAGS.RESTORE)) summary.restoreCount += 1;
    if (flags.includes(CHANGE_FLAGS.TAG_CHANGE)) summary.tagChangeCount += 1;
    if (flags.includes(CHANGE_FLAGS.REINCLUDE)) summary.reincludeCount += 1;
  }
  return summary;
}

export const RISK_THRESHOLDS = Object.freeze({
  changeRatio: 0.1,
  excludeRatio: 0.05
});

export function computeRiskWarnings({
  summary,
  currentDocumentCount,
  missingPermissions = [],
  identityChangeCount = 0,
  blankKeyCreateCount = 0,
  baseVersionAge = 0
}) {
  const warnings = [];
  const total = Math.max(Number(currentDocumentCount) || 0, 1);
  if (summary.excludeCount > 0) {
    warnings.push({ code: "EXCLUSION", level: "danger", message: `업로드 파일에 없는 문서 ${summary.excludeCount}건이 대장에서 제외됩니다.` });
  }
  if (summary.restoreCount > 0) {
    warnings.push({ code: "RESTORE", level: "danger", message: `폐기 해제 ${summary.restoreCount}건이 포함되어 Admin 권한이 필요합니다.` });
  }
  if ((summary.updateCount + summary.createCount) / total >= RISK_THRESHOLDS.changeRatio) {
    warnings.push({ code: "LARGE_CHANGE", level: "warning", message: "현재 대장의 10% 이상이 변경됩니다." });
  }
  if (summary.excludeCount / total >= RISK_THRESHOLDS.excludeRatio) {
    warnings.push({ code: "LARGE_EXCLUSION", level: "warning", message: "현재 대장의 5% 이상이 제외됩니다." });
  }
  if (identityChangeCount > 0) {
    warnings.push({ code: "IDENTITY_CHANGE", level: "warning", message: `문서번호·개정번호 변경 ${identityChangeCount}건이 포함되어 있습니다.` });
  }
  if (blankKeyCreateCount > 0) {
    warnings.push({ code: "BLANK_KEY_CREATE", level: "info", message: `관리 ID 없는 신규 행 ${blankKeyCreateCount}건은 서버가 관리 ID를 생성합니다.` });
  }
  if (baseVersionAge > 0) {
    warnings.push({ code: "STALE_BASE", level: "warning", message: "기준 버전이 현재보다 오래되었습니다. 최신 추출 파일을 사용하세요." });
  }
  if (missingPermissions.length) {
    warnings.push({ code: "MISSING_PERMISSION", level: "danger", message: `부족한 권한: ${missingPermissions.join(", ")}` });
  }
  return warnings;
}
