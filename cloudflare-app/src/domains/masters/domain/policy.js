import { clean } from "../../../shared/text/normalize.js";

export const MASTER_TYPES = Object.freeze({
  category: Object.freeze({ noun: "카테고리", entityType: "category" }),
  tag: Object.freeze({ noun: "태그", entityType: "tag" })
});

export function validateMasterValues(type, values = {}) {
  const spec = MASTER_TYPES[type];
  if (!spec) throw new TypeError(`지원하지 않는 기준정보 유형: ${type}`);
  const normalized = {
    id: positiveId(values.id),
    name: clean(values.name),
    description: clean(values.description),
    isActive: values.id ? Boolean(values.isActive) : true,
    ...(type === "category" ? { sortOrder: Number.isFinite(values.sortOrder) ? values.sortOrder : 0 } : {})
  };
  if (!normalized.name) return { ok: false, message: `${spec.noun} 이름은 필수입니다.`, values: normalized };
  return { ok: true, values: normalized };
}

export function masterSnapshot(type, row) {
  return {
    name: row.name,
    description: row.description || "",
    ...(type === "category" ? { sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0) } : {}),
    isActive: Boolean(row.is_active ?? row.isActive)
  };
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}
