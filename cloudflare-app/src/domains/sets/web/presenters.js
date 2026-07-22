export function setRowToReadModel(row) {
  return Object.freeze({
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    isLocked: Number(row.is_locked) === 1,
    documentCount: Number(row.document_count || 0),
    currentCount: Number(row.current_count || 0),
    excludedCount: Number(row.excluded_count || 0),
    disposedCount: Number(row.disposed_count || 0),
    updatedAt: row.updated_at || ""
  });
}
