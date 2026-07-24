-- Keep the last ready search generation online while a replacement generation is built.
-- The v1 tables remain as a rollback-compatible mirror for the previously deployed Worker.
PRAGMA foreign_keys = ON;

CREATE TABLE search_documents_v2 (
  generation INTEGER NOT NULL CHECK (generation >= 1),
  document_id INTEGER NOT NULL,
  document_number TEXT NOT NULL,
  revision_number TEXT NOT NULL,
  document_name TEXT NOT NULL,
  category_id INTEGER NOT NULL DEFAULT 0,
  category_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  rack_id INTEGER NOT NULL DEFAULT 0,
  rack_code TEXT NOT NULL,
  zone_number INTEGER NOT NULL DEFAULT 0,
  rack_face TEXT NOT NULL DEFAULT '',
  column_number INTEGER NOT NULL DEFAULT 0,
  shelf_number INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  tag_names TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (generation, document_id)
);

CREATE INDEX idx_search_documents_v2_filters
ON search_documents_v2 (
  generation,
  status,
  category_id,
  zone_number,
  rack_id,
  rack_face,
  column_number,
  shelf_number
);

CREATE VIRTUAL TABLE search_documents_fts_v2 USING fts5(
  generation UNINDEXED,
  document_id UNINDEXED,
  normalized_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

ALTER TABLE search_runtime_state
ADD COLUMN active_generation INTEGER NOT NULL DEFAULT 1 CHECK (active_generation >= 1);

ALTER TABLE search_runtime_state
ADD COLUMN building_generation INTEGER CHECK (building_generation IS NULL OR building_generation >= 1);

ALTER TABLE search_runtime_state
ADD COLUMN building_last_document_id INTEGER NOT NULL DEFAULT 0 CHECK (building_last_document_id >= 0);

ALTER TABLE search_runtime_state
ADD COLUMN v2_ready INTEGER NOT NULL DEFAULT 0 CHECK (v2_ready IN (0, 1));

INSERT INTO search_documents_v2 (
  generation, document_id, document_number, revision_number, document_name,
  category_name, rack_code, tag_names, normalized_text, updated_at
)
SELECT
  generation, document_id, document_number, revision_number, document_name,
  category_name, rack_code, tag_names, normalized_text, updated_at
FROM search_documents;

INSERT INTO search_documents_fts_v2 (generation, document_id, normalized_text)
SELECT generation, document_id, normalized_text
FROM search_documents;

UPDATE search_runtime_state
SET active_generation = generation,
    building_generation = NULL,
    building_last_document_id = 0,
    v2_ready = 0,
    rebuild_status = 'pending',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
