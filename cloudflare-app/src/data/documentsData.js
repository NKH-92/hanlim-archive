import { validateDocumentRecordFields, validateDocumentTextFields } from "../documentRules.js";
import { clean, normalizeRackFace } from "../utils.js";
import {
  DOCUMENT_BASE_JOINS,
  DOCUMENT_CORE_COLUMNS,
  DOCUMENT_LOCATION_COLUMNS,
  DOCUMENT_TAG_CONCAT,
  DOCUMENT_TAG_JOINS
} from "./sqlShared.js";
import { getActiveCategories, getActiveTags, getCategories, getTags } from "./mastersData.js";
import { getSlotOptions } from "./racksData.js";

export async function getCategoryDocumentIndex(env) {
  const result = await env.DB.prepare(`
    SELECT
      c.id,
      c.name,
      c.description,
      c.sort_order,
      c.is_active,
      COUNT(d.id) AS document_count,
      SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END) AS active_document_count,
      MIN(r.zone_number) AS first_zone_number,
      MIN(r.rack_number) AS first_rack_number
    FROM categories c
    LEFT JOIN documents d ON d.category_id = c.id
    LEFT JOIN rack_slots rs ON rs.id = d.rack_slot_id
    LEFT JOIN racks r ON r.id = rs.rack_id
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `).all();

  return result.results ?? [];
}

export async function getDocumentQualitySummary(env) {
  // 문서별 품질 지표는 한 번의 본문 스캔으로 계산하고, 중복 키 집계만 CTE로 분리한다.
  const row = await env.DB.prepare(`
    WITH duplicate_keys AS (
      SELECT document_number, revision_number
      FROM documents
      GROUP BY document_number, revision_number
      HAVING COUNT(*) > 1
    ),
    tagged_documents AS (
      SELECT DISTINCT document_id
      FROM document_tags
    )
    SELECT
      (SELECT COUNT(*) FROM duplicate_keys) AS duplicate_document_numbers,
      COALESCE(SUM(CASE WHEN rs.id IS NULL OR r.id IS NULL THEN 1 ELSE 0 END), 0) AS missing_location,
      COALESCE(SUM(CASE WHEN c.id IS NULL OR c.is_active = 0 THEN 1 ELSE 0 END), 0) AS missing_category,
      COALESCE(SUM(CASE WHEN r.is_single_sided = 1 AND d.rack_face = 'B' THEN 1 ELSE 0 END), 0) AS invalid_rack_face,
      COALESCE(SUM(CASE
        WHEN d.document_name LIKE '%�%'
          OR d.document_name LIKE '%Ã%'
          OR d.document_name LIKE '%Â%'
          OR d.note LIKE '%�%'
          OR d.note LIKE '%Ã%'
          OR d.note LIKE '%Â%'
        THEN 1 ELSE 0 END), 0) AS suspicious_text,
      COALESCE(SUM(CASE WHEN td.document_id IS NULL THEN 1 ELSE 0 END), 0) AS documents_without_tags,
      COALESCE(SUM(CASE WHEN d.status = 'disposed' THEN 1 ELSE 0 END), 0) AS disposed_documents
    FROM documents d
    LEFT JOIN rack_slots rs ON rs.id = d.rack_slot_id
    LEFT JOIN racks r ON r.id = rs.rack_id
    LEFT JOIN categories c ON c.id = d.category_id
    LEFT JOIN tagged_documents td ON td.document_id = d.id
  `).first();

  return {
    duplicateDocumentNumbers: Number(row?.duplicate_document_numbers || 0),
    missingLocation: Number(row?.missing_location || 0),
    missingCategory: Number(row?.missing_category || 0),
    invalidRackFace: Number(row?.invalid_rack_face || 0),
    suspiciousText: Number(row?.suspicious_text || 0),
    documentsWithoutTags: Number(row?.documents_without_tags || 0),
    disposedDocuments: Number(row?.disposed_documents || 0)
  };
}

export async function getDocumentsForExport(env) {
  const result = await env.DB.prepare(`
    SELECT
      ${DOCUMENT_CORE_COLUMNS}
      ${DOCUMENT_LOCATION_COLUMNS}
      rs.column_number,
      rs.shelf_number,
      rs.slot_code,
      ${DOCUMENT_TAG_CONCAT}
    ${DOCUMENT_BASE_JOINS}
    ${DOCUMENT_TAG_JOINS}
    GROUP BY d.id
    ORDER BY d.id
  `).all();

  return result.results ?? [];
}

export async function getDocument(env, id) {
  return env.DB.prepare(`
    SELECT
      d.id,
      d.storage_code,
      d.category_id,
      d.document_number,
      d.revision_number,
      d.revision_date,
      d.disposal_due_year,
      d.document_name,
      d.note,
      d.rack_slot_id,
      d.rack_face,
      d.status,
      d.updated_at,
      ${DOCUMENT_LOCATION_COLUMNS}
      r.column_count,
      r.shelf_count,
      rs.column_number,
      rs.shelf_number,
      rs.slot_code
    ${DOCUMENT_BASE_JOINS}
    WHERE d.id = ?
  `).bind(id).first();
}

export async function getDocumentTags(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT t.id, t.name
    FROM document_tags dt
    JOIN tags t ON t.id = dt.tag_id
    WHERE dt.document_id = ?
    ORDER BY t.name
  `).bind(documentId).all();

  return result.results ?? [];
}

export async function getDisposalLogs(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT id, action, performed_by, reason, created_at
    FROM disposal_logs
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(documentId).all();

  return result.results ?? [];
}

export async function getDocumentAuditLogs(env, documentId) {
  const result = await env.DB.prepare(`
    SELECT id, action, actor, actor_role, summary, details, created_at
    FROM document_audit_logs
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(documentId).all();

  return result.results ?? [];
}

export async function validateDocumentInput(env, values, options = {}) {
  // 화면 입력과 CSV 입력이 동일한 길이·필수값 규칙을 사용하도록 순수 검증을 공유한다.
  const textError = validateDocumentTextFields(values);
  if (textError) {
    return textError;
  }
  const recordError = validateDocumentRecordFields(values, { required: true });
  if (recordError) {
    return recordError;
  }

  if (!Number.isInteger(values.categoryId) || values.categoryId <= 0) {
    return "대분류를 선택하세요.";
  }

  if (!Number.isInteger(values.rackSlotId) || values.rackSlotId <= 0) {
    return "보관 위치를 선택하세요.";
  }

  if (!["A", "B"].includes(values.rackFace)) {
    return "보관 면은 1면 또는 2면만 선택할 수 있습니다.";
  }

  const allowInactiveCategory = options.allowInactiveCategory === true ||
    Number(options.allowInactiveCategoryId) === values.categoryId;

  const uniqueTagIds = [...new Set(values.tagIds || [])]
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  const allowInactiveTagIds = new Set(
    (options.allowInactiveTagIds || [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
  );

  // 대분류·슬롯·태그 존재 검사는 서로 독립이므로 한 번에 조회한다.
  const [category, slot, tagRows] = await Promise.all([
    env.DB.prepare(`
      SELECT id, is_active FROM categories
      WHERE id = ?
    `).bind(values.categoryId).first(),
    env.DB.prepare(`
      SELECT rs.id, r.is_single_sided
      FROM rack_slots rs
      JOIN racks r ON r.id = rs.rack_id
      WHERE rs.id = ? AND rs.is_active = 1 AND r.is_active = 1
    `).bind(values.rackSlotId).first(),
    uniqueTagIds.length
      ? env.DB.prepare(`
          SELECT id, is_active
          FROM tags
          WHERE id IN (${uniqueTagIds.map(() => "?").join(", ")})
        `).bind(...uniqueTagIds).all()
      : Promise.resolve({ results: [] })
  ]);

  if (!category || (!category.is_active && !allowInactiveCategory)) {
    return "사용 가능한 대분류가 아닙니다.";
  }

  if (!slot) {
    return "사용 가능한 보관 위치가 아닙니다.";
  }

  if (slot.is_single_sided && values.rackFace === "B") {
    return "단면 랙은 면 구분 없이 사용합니다. 2면을 선택할 수 없습니다.";
  }

  if (uniqueTagIds.length) {
    const found = new Map((tagRows.results ?? []).map((tag) => [Number(tag.id), tag]));
    for (const tagId of uniqueTagIds) {
      const tag = found.get(tagId);
      if (!tag) {
        return "존재하지 않는 태그가 포함되어 있습니다.";
      }
      if (!tag.is_active && !allowInactiveTagIds.has(tagId)) {
        return "사용 가능한 태그가 아닙니다.";
      }
    }
  }

  return "";
}

export function parseDocumentNumberList(text) {
  const seen = new Set();
  const numbers = [];

  // 문서번호/보관코드는 공백 없는 코드이므로 공백·줄바꿈·쉼표·세미콜론·탭을 모두 구분자로 본다.
  for (const token of String(text ?? "").split(/[\s,;]+/)) {
    const value = clean(token);
    if (!value) {
      continue;
    }

    const key = value.toUpperCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    numbers.push(value);
  }

  return numbers;
}

export async function findDocumentsByNumbers(env, numbers) {
  if (!numbers.length) {
    return { documents: [], missing: [] };
  }

  const upperNumbers = numbers.map((number) => number.toUpperCase());
  const placeholders = upperNumbers.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT id, document_number, storage_code
    FROM documents
    WHERE UPPER(document_number) IN (${placeholders})
       OR UPPER(storage_code) IN (${placeholders})
  `).bind(...upperNumbers, ...upperNumbers).all();
  const documents = result.results ?? [];
  const matched = new Set();

  for (const document of documents) {
    matched.add(String(document.document_number).toUpperCase());
    matched.add(String(document.storage_code).toUpperCase());
  }

  const missing = numbers.filter((number) => !matched.has(number.toUpperCase()));
  return { documents, missing };
}

export function documentToFormValues(document) {
  return {
    documentNumber: document.document_number,
    revisionNumber: document.revision_number,
    revisionDate: document.revision_date || "",
    disposalDueYear: document.disposal_due_year ?? "",
    documentName: document.document_name,
    categoryId: document.category_id,
    rackSlotId: document.rack_slot_id,
    rackFace: document.rack_face,
    note: document.note || "",
    updatedAt: document.updated_at
  };
}

export function valuesFromDocumentForm(form) {
  return {
    documentNumber: clean(form.get("documentNumber")),
    revisionNumber: clean(form.get("revisionNumber")),
    revisionDate: clean(form.get("revisionDate")),
    disposalDueYear: clean(form.get("disposalDueYear")),
    documentName: clean(form.get("documentName")),
    categoryId: Number(form.get("categoryId")),
    rackSlotId: Number(form.get("rackSlotId")),
    rackFace: normalizeRackFace(form.get("rackFace")),
    note: clean(form.get("note")),
    tagIds: form.getAll("tagIds").map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0),
    // 낙관적 잠금: 사용자가 수정 화면을 연 시점의 updated_at(hidden). 비어 있으면 잠금 없이 동작.
    expectedUpdatedAt: clean(form.get("expectedUpdatedAt"))
  };
}

export async function loadDocumentFormOptions(env, { activeOnly = false, includeSlots = true } = {}) {
  const [categories, tags, slots] = await Promise.all([
    activeOnly ? getActiveCategories(env) : getCategories(env),
    activeOnly ? getActiveTags(env) : getTags(env),
    includeSlots ? getSlotOptions(env) : Promise.resolve([])
  ]);
  return { categories, tags, slots };
}

export function parseDisposalFilters(params = {}) {
  const read = (name) => typeof params?.get === "function" ? params.get(name) : params?.[name];
  const positive = (value) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  };
  const year = positive(read("disposalDueYear"));
  return {
    categoryId: positive(read("category") || read("categoryId")),
    rackId: positive(read("rack") || read("rackId")),
    disposalDueYear: year >= 1900 && year <= 9999 ? year : 0
  };
}

export async function getDisposalDueYears(env) {
  const result = await env.DB.prepare(`
    SELECT DISTINCT disposal_due_year AS year
    FROM documents
    WHERE status = 'active' AND disposal_due_year IS NOT NULL
    ORDER BY disposal_due_year
  `).all();
  return (result.results ?? []).map((row) => Number(row.year)).filter(Boolean);
}

export async function getDisposalCandidates(env, filters = {}, limit = 201) {
  const clauses = ["d.status = 'active'"];
  const binds = [];
  if (filters.categoryId) {
    clauses.push("d.category_id = ?");
    binds.push(filters.categoryId);
  }
  if (filters.rackId) {
    clauses.push("r.id = ?");
    binds.push(filters.rackId);
  }
  if (filters.disposalDueYear) {
    clauses.push("d.disposal_due_year = ?");
    binds.push(filters.disposalDueYear);
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 201, 201));
  const result = await env.DB.prepare(`
    SELECT
      d.id,
      ${DOCUMENT_CORE_COLUMNS}
      d.updated_at,
      ${DOCUMENT_LOCATION_COLUMNS}
      rs.column_number,
      rs.shelf_number,
      rs.slot_code
    ${DOCUMENT_BASE_JOINS}
    WHERE ${clauses.join(" AND ")}
    ORDER BY d.disposal_due_year, c.name, r.zone_number, r.rack_number, rs.column_number, rs.shelf_number, d.document_number
    LIMIT ?
  `).bind(...binds, safeLimit).all();
  return result.results ?? [];
}
