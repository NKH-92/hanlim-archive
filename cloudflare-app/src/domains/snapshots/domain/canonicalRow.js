import { validateDocumentRecordFields, validateDocumentTextFields } from "../../documents/index.js";
import { normalizeRackFace } from "../../racks/index.js";
import { clean } from "../../../shared/text/normalize.js";
import { isValidDateOnly } from "./dateOnly.js";
import { SNAPSHOT_ERROR_CODES } from "./errorCodes.js";
import { isStableRowKey } from "./identity.js";

const STATUS_MAP = Object.freeze({
  보관중: "active",
  폐기: "disposed",
  active: "active",
  disposed: "disposed"
});

function fieldError(rowNumber, field, code, message) {
  return { rowNumber, field, code, message };
}

function normalizeImportRackCode(value) {
  const raw = clean(value);
  if (/^\d+$/.test(raw)) return `1-${String(Number(raw)).padStart(2, "0")}`;
  const match = raw.match(/^(\d+)\s*[-/]\s*(\d+)$/);
  if (match) return `${Number(match[1])}-${String(Number(match[2])).padStart(2, "0")}`;
  return raw;
}

function parseStrictInteger(raw, { allowLeadingZero = true } = {}) {
  const text = clean(raw);
  if (!text) return { ok: false };
  if (!/^\d+$/.test(text)) return { ok: false };
  if (!allowLeadingZero && text.length > 1 && text.startsWith("0")) return { ok: false };
  const number = Number(text);
  if (!Number.isInteger(number)) return { ok: false };
  return { ok: true, value: number };
}

function normalizeStrictStatus(raw) {
  const text = clean(raw);
  if (!text) return { ok: false };
  const mapped = STATUS_MAP[text] || STATUS_MAP[text.toLowerCase()];
  if (!mapped) return { ok: false };
  return { ok: true, value: mapped };
}

function normalizeStrictFace(raw) {
  const text = clean(raw);
  if (!text) return { ok: false };
  const face = normalizeRackFace(text);
  if (face !== "A" && face !== "B") return { ok: false };
  return { ok: true, value: face };
}

function parseTagNames(raw) {
  const text = clean(raw);
  if (!text) return [];
  const names = text.split(/[;,|]/).map((name) => clean(name)).filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

/**
 * 전체 대장 전용 엄격 parser. CSV 가져오기와 달리 공란·오타를 기본값으로 보정하지 않는다.
 */
export function prepareCanonicalSnapshotRows(rows, { categories, tags, slots }) {
  const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));
  const tagByName = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag]));
  const slotByPosition = new Map(slots.map((slot) => [`${slot.code}|${slot.column_number}|${slot.shelf_number}`, slot]));
  const errors = [];
  const items = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const rowNumber = Number(row.rowNumber) || index + 2;
    const sourceRowKey = clean(row.sourceRowKey ?? row.rowKey);
    const categoryName = clean(row.category);
    const rackCode = normalizeImportRackCode(row.rackCode || row.rackNumber);
    const columnParsed = parseStrictInteger(row.rackColumn ?? row.columnNumber ?? row.column);
    const shelfParsed = parseStrictInteger(row.shelfNumber ?? row.shelf);
    const disposalParsed = parseStrictInteger(row.disposalDueYear);
    const statusParsed = normalizeStrictStatus(row.status);
    const faceParsed = normalizeStrictFace(row.rackFace);
    const category = categoryByName.get(categoryName.toLowerCase());
    const slot = columnParsed.ok && shelfParsed.ok
      ? slotByPosition.get(`${rackCode}|${columnParsed.value}|${shelfParsed.value}`)
      : null;
    const tagNames = parseTagNames(row.tags);
    const tagIds = [];
    const tagLabels = [];

    if (!clean(row.documentNumber)) {
      errors.push(fieldError(rowNumber, "documentNumber", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "문서번호는 필수입니다."));
    }
    if (!clean(row.revisionNumber)) {
      errors.push(fieldError(rowNumber, "revisionNumber", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "개정번호는 필수입니다. 공란을 Rev.0으로 바꾸지 않습니다."));
    }
    if (!clean(row.revisionDate)) {
      errors.push(fieldError(rowNumber, "revisionDate", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "제·개정일은 필수입니다."));
    } else if (!isValidDateOnly(row.revisionDate)) {
      errors.push(fieldError(rowNumber, "revisionDate", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "제·개정일은 YYYY-MM-DD 형식이어야 합니다."));
    }
    if (!disposalParsed.ok) {
      errors.push(fieldError(rowNumber, "disposalDueYear", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "폐기 예정 년도는 정수로 필수입니다."));
    }
    if (!clean(row.documentName)) {
      errors.push(fieldError(rowNumber, "documentName", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "문서명은 필수입니다."));
    }
    if (!categoryName || !category) {
      errors.push(fieldError(rowNumber, "category", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `존재하지 않는 문서종류(${categoryName || "-"})입니다.`));
    }
    if (!clean(row.rackNumber || row.rackCode) || !columnParsed.ok || !shelfParsed.ok || !slot) {
      errors.push(fieldError(rowNumber, "location", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `존재하지 않거나 공란인 위치(${rackCode || "-"} / ${clean(row.rackColumn) || "-"}열 / ${clean(row.shelfNumber) || "-"}선반)입니다.`));
    }
    if (!faceParsed.ok) {
      errors.push(fieldError(rowNumber, "rackFace", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "랙 면은 단면/1면/2면(또는 A/B)만 허용하며 공란은 오류입니다."));
    } else if (slot && Number(slot.is_single_sided) === 1 && faceParsed.value === "B") {
      errors.push(fieldError(rowNumber, "rackFace", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "단면 랙에는 2면(B)을 입력할 수 없습니다."));
    }
    if (!statusParsed.ok) {
      errors.push(fieldError(rowNumber, "status", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "상태는 보관중 또는 폐기만 입력할 수 있습니다."));
    }

    for (const tagName of tagNames) {
      const tag = tagByName.get(tagName.toLowerCase());
      if (!tag) {
        errors.push(fieldError(rowNumber, "tags", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, `존재하지 않는 태그(${tagName})입니다.`));
      } else {
        tagIds.push(Number(tag.id));
        tagLabels.push(tag.name);
      }
    }

    if (sourceRowKey && !isStableRowKey(sourceRowKey)) {
      errors.push(fieldError(rowNumber, "sourceRowKey", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, "숨김 관리 ID 형식이 올바르지 않습니다."));
    }

    const values = {
      documentNumber: clean(row.documentNumber),
      revisionNumber: clean(row.revisionNumber),
      revisionDate: clean(row.revisionDate),
      disposalDueYear: disposalParsed.ok ? disposalParsed.value : null,
      documentName: clean(row.documentName),
      categoryId: category?.id ?? 0,
      categoryName: category?.name || categoryName,
      rackSlotId: slot?.id ?? 0,
      rackCode: slot?.code || rackCode,
      rackColumn: columnParsed.ok ? columnParsed.value : null,
      shelfNumber: shelfParsed.ok ? shelfParsed.value : null,
      rackFace: faceParsed.ok ? faceParsed.value : "",
      note: clean(row.note),
      tagIds: [...new Set(tagIds)].sort((a, b) => a - b),
      tagNames: [...new Set(tagLabels)].sort((a, b) => a.localeCompare(b, "ko"))
    };

    const textError = validateDocumentTextFields(values);
    if (textError) {
      errors.push(fieldError(rowNumber, "text", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, textError));
    }
    const recordError = validateDocumentRecordFields(values, { required: true });
    if (recordError) {
      errors.push(fieldError(rowNumber, "record", SNAPSHOT_ERROR_CODES.SNAPSHOT_INVALID_FIELD, recordError));
    }

    items.push({
      rowNumber,
      sourceRowKey: sourceRowKey || null,
      rowKey: sourceRowKey || null,
      values,
      status: statusParsed.ok ? statusParsed.value : "active"
    });
  }

  return {
    ok: errors.length === 0,
    items,
    errors
  };
}

export function formatCanonicalErrors(errors, { limit = 20 } = {}) {
  const list = Array.isArray(errors) ? errors : [];
  const lines = list.slice(0, limit).map((error) => {
    if (typeof error === "string") return error;
    return `${error.rowNumber}행: ${error.message}`;
  });
  if (list.length > limit) lines.push(`외 ${list.length - limit}건`);
  return lines.join(" / ");
}
