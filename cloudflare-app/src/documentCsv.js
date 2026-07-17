import { validateDocumentRecordFields, validateDocumentTextFields } from "./documentRules.js";
import { clean, csvEscape, locationLabel, normalizeRackFace, parseCsv } from "./utils.js";

const DOCUMENT_CSV_HEADER = Object.freeze([
  "문서명",
  "문서번호",
  "개정번호",
  "제/개정일",
  "폐기 예정 년도",
  "보관위치"
]);

export function buildDocumentCsv(documents, now = new Date()) {
  const rows = documents.map((document) => [
    document.document_name,
    document.document_number,
    document.revision_number,
    document.revision_date || "",
    document.disposal_due_year ?? "",
    locationLabel(document)
  ]);
  const csv = [DOCUMENT_CSV_HEADER, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");

  return {
    body: `\uFEFF${csv}\r\n`,
    filename: `hanlim-archive-documents-${now.toISOString().slice(0, 10)}.csv`
  };
}

const DOCUMENT_SET_CSV_HEADER = Object.freeze([
  "순번",
  "문서번호",
  "개정번호",
  "문서명",
  "대분류",
  "상태",
  "구역",
  "랙",
  "면",
  "열",
  "선반",
  "보관 위치 전체 문자열"
]);

export function buildDocumentSetCsv(set, documents, now = new Date()) {
  const rows = documents.map((document, index) => [
    index + 1,
    document.document_number,
    document.revision_number,
    document.document_name,
    document.category_name,
    document.status === "disposed" ? "폐기" : "보관중",
    document.zone_number,
    document.rack_number,
    Number(document.is_single_sided) === 1 ? "단면" : (document.rack_face === "B" ? "2면" : "1면"),
    document.column_number,
    document.shelf_number,
    locationLabel(document)
  ]);
  const csv = [DOCUMENT_SET_CSV_HEADER, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  const setId = Number(set?.id) || 0;
  return {
    body: `\uFEFF${csv}\r\n`,
    filename: `hanlim-archive-set-${setId}-${now.toISOString().slice(0, 10)}.csv`
  };
}

export async function readDocumentImportRows(form, limits) {
  const uploaded = form.get("csvFile");

  if (uploaded && typeof uploaded.text === "function" && uploaded.size > limits.maxBytes) {
    return { ok: false, error: `CSV 파일은 한 번에 ${limits.maxBytes / 1024}KB 이하만 가져올 수 있습니다.` };
  }

  const csvText = uploaded && typeof uploaded.text === "function" && uploaded.size > 0
    ? await uploaded.text()
    : String(form.get("csvText") ?? "");
  const csvBytes = new TextEncoder().encode(csvText).length;

  if (csvBytes > limits.maxBytes) {
    return { ok: false, error: `CSV 내용은 한 번에 ${limits.maxBytes / 1024}KB 이하만 가져올 수 있습니다.` };
  }

  let rows = [];
  try {
    rows = parseCsv(csvText);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (!rows.length) {
    return { ok: false, error: "가져올 CSV 데이터가 없습니다." };
  }

  if (rows.length > limits.maxRows) {
    return { ok: false, error: `CSV 가져오기는 한 번에 ${limits.maxRows}건까지 처리합니다. 파일을 나누어 가져오세요.` };
  }

  return { ok: true, rows };
}

export function prepareDocumentImportRows(rows, { categories, tags, slots }) {
  const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));
  const tagByName = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag]));
  const slotByPosition = new Map(slots.map((slot) => [`${slot.code}|${slot.column_number}|${slot.shelf_number}`, slot]));
  const slotByLegacyCode = new Map(slots.map((slot) => [`${slot.code}|${slot.slot_code}`, slot]));
  const slotByLegacyShelf = new Map(slots.map((slot) => [`${slot.code}|${slot.shelf_number}`, slot]));
  const errors = [];
  const items = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const row = rows[index];
    const categoryName = clean(row.category);
    const rackCode = clean(row.rackCode);
    const rackColumn = Number(clean(row.rackColumn || row.columnNumber || row.column || "1"));
    const shelfNumber = Number(clean(row.shelfNumber || row.shelf || row.slotCode || "1"));
    const legacySlotCode = clean(row.slotCode);
    const category = categoryByName.get(categoryName.toLowerCase());
    const slot = slotByPosition.get(`${rackCode}|${rackColumn}|${shelfNumber}`) ??
      (legacySlotCode ? slotByLegacyCode.get(`${rackCode}|${legacySlotCode}`) : null) ??
      (legacySlotCode ? slotByLegacyShelf.get(`${rackCode}|${legacySlotCode}`) : null);
    const tagNames = clean(row.tags)
      ? clean(row.tags).split(/[;|]/).map((name) => clean(name)).filter(Boolean)
      : [];
    const tagIds = [];

    for (const tagName of tagNames) {
      const tag = tagByName.get(tagName.toLowerCase());
      if (!tag) {
        errors.push(`${rowNumber}행: 존재하지 않는 태그(${tagName})`);
      } else {
        tagIds.push(tag.id);
      }
    }

    if (!category) {
      errors.push(`${rowNumber}행: 존재하지 않는 대분류(${categoryName || "-"})`);
    }

    if (!slot) {
      errors.push(`${rowNumber}행: 존재하지 않는 위치(${rackCode || "-"} / ${rackColumn || "-"}열 / ${shelfNumber || "-"}행)`);
    }

    const values = {
      documentNumber: clean(row.documentNumber),
      revisionNumber: clean(row.revisionNumber || "Rev.0"),
      revisionDate: clean(row.revisionDate),
      disposalDueYear: clean(row.disposalDueYear),
      documentName: clean(row.documentName),
      categoryId: category?.id ?? 0,
      rackSlotId: slot?.id ?? 0,
      rackFace: normalizeRackFace(row.rackFace || "A"),
      note: clean(row.note),
      tagIds: [...new Set(tagIds)]
    };

    const textError = validateDocumentTextFields(values);
    if (textError) {
      errors.push(`${rowNumber}행: ${textError}`);
    }
    const recordError = validateDocumentRecordFields(values);
    if (recordError) {
      errors.push(`${rowNumber}행: ${recordError}`);
    }

    if (!["A", "B"].includes(values.rackFace)) {
      errors.push(`${rowNumber}행: 보관 면은 1 또는 2만 가능합니다(구표기 A/B 허용).`);
    }

    if (slot?.is_single_sided && values.rackFace === "B") {
      errors.push(`${rowNumber}행: 단면 랙은 면 구분이 없어 2면을 선택할 수 없습니다.`);
    }

    const status = clean(row.status).toLowerCase();
    items.push({
      values,
      status: status === "disposed" || status === "폐기" ? "disposed" : "active"
    });
  }

  return { items, errors };
}
