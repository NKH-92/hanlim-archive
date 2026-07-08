CREATE INDEX IF NOT EXISTS idx_documents_category_status ON documents(category_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_documents_number_revision ON documents(document_number, revision_number);
CREATE INDEX IF NOT EXISTS idx_document_tags_tag_document ON document_tags(tag_id, document_id);
CREATE INDEX IF NOT EXISTS idx_rack_slots_rack_layout ON rack_slots(rack_id, column_number, shelf_number);
