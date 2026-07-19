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
    updatedAt: document.updated_at,
    rowVersion: document.row_version
  };
}

// 공개 read model에는 내부 storage_code를 의도적으로 포함하지 않는다.
export function documentRowToPublicReadModel(row) {
  return Object.freeze({
    id: Number(row.id),
    documentNumber: row.document_number,
    revisionNumber: row.revision_number,
    revisionDate: row.revision_date || "",
    disposalDueYear: row.disposal_due_year ?? null,
    documentName: row.document_name,
    note: row.note || "",
    status: row.status,
    categoryName: row.category_name || "",
    zoneNumber: Number(row.zone_number || 0),
    rackNumber: Number(row.rack_number || 0),
    rackFace: row.rack_face,
    columnNumber: Number(row.column_number || 0),
    shelfNumber: Number(row.shelf_number || 0),
    updatedAt: row.updated_at || "",
    rowVersion: Number(row.row_version || 0)
  });
}
