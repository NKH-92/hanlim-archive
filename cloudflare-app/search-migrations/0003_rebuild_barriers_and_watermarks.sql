-- Make shadow rebuilds monotonic under concurrent Core outbox processing.
-- Physical Search generations are independent from the Core content generation.
PRAGMA foreign_keys = ON;

ALTER TABLE search_documents_v2
ADD COLUMN source_event_version INTEGER NOT NULL DEFAULT 0
  CHECK (source_event_version >= 0);

ALTER TABLE search_documents_v2
ADD COLUMN source_outbox_version INTEGER NOT NULL DEFAULT 0
  CHECK (source_outbox_version >= 0);

ALTER TABLE search_runtime_state
ADD COLUMN previous_active_generation INTEGER
  CHECK (previous_active_generation IS NULL OR previous_active_generation >= 1);

ALTER TABLE search_runtime_state
ADD COLUMN building_source_generation INTEGER
  CHECK (building_source_generation IS NULL OR building_source_generation >= 1);

ALTER TABLE search_runtime_state
ADD COLUMN building_source_version INTEGER
  CHECK (building_source_version IS NULL OR building_source_version >= 1);

ALTER TABLE search_runtime_state
ADD COLUMN rebuild_token TEXT
  CHECK (
    rebuild_token IS NULL
    OR (
      length(rebuild_token) BETWEEN 16 AND 128
      AND rebuild_token NOT GLOB '*[^A-Za-z0-9._-]*'
    )
  );

ALTER TABLE search_runtime_state
ADD COLUMN cutover_generation INTEGER
  CHECK (cutover_generation IS NULL OR cutover_generation >= 1);

CREATE TABLE search_document_watermarks (
  physical_generation INTEGER NOT NULL CHECK (physical_generation >= 1),
  document_id INTEGER NOT NULL,
  source_event_version INTEGER NOT NULL CHECK (source_event_version >= 0),
  source_outbox_version INTEGER NOT NULL DEFAULT 0 CHECK (source_outbox_version >= 0),
  write_token TEXT NOT NULL DEFAULT '',
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (physical_generation, document_id)
);

CREATE INDEX idx_search_document_watermarks_retention
ON search_document_watermarks(physical_generation, source_event_version);

INSERT INTO search_document_watermarks (
  physical_generation,
  document_id,
  source_event_version,
  source_outbox_version,
  is_deleted
)
SELECT generation, document_id, source_event_version, source_outbox_version, 0
FROM search_documents_v2;

-- A partially built v2 generation from the previous implementation has no
-- trustworthy barrier token. Keep the active generation serving and restart.
UPDATE search_runtime_state
SET previous_active_generation = NULL,
    building_generation = NULL,
    building_last_document_id = 0,
    building_source_generation = NULL,
    building_source_version = NULL,
    rebuild_token = NULL,
    cutover_generation = NULL,
    rebuild_status = 'pending',
    v2_ready = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
