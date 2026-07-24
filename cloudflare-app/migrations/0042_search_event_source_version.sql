-- Give every Search-relevant Core mutation a persistent, globally monotonic
-- source version. Outbox row event_version remains a retry identity only.

CREATE TABLE search_event_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO search_event_clock (id) VALUES (1);

ALTER TABLE search_index_outbox
ADD COLUMN source_version INTEGER NOT NULL DEFAULT 1 CHECK (source_version >= 1);

DROP TRIGGER trg_search_outbox_document_insert;
DROP TRIGGER trg_search_outbox_document_update;
DROP TRIGGER trg_search_outbox_document_delete;
DROP TRIGGER trg_search_outbox_document_tag_insert;
DROP TRIGGER trg_search_outbox_document_tag_delete;

CREATE TRIGGER trg_search_outbox_document_insert
AFTER INSERT ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
  INSERT INTO search_index_outbox (document_id, operation, source_version)
  VALUES (
    NEW.id,
    'upsert',
    (SELECT current_version FROM search_event_clock WHERE id = 1)
  )
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_outbox_document_update
AFTER UPDATE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
  INSERT INTO search_index_outbox (document_id, operation, source_version)
  VALUES (
    NEW.id,
    CASE WHEN NEW.sync_state = 'current' THEN 'upsert' ELSE 'delete' END,
    (SELECT current_version FROM search_event_clock WHERE id = 1)
  )
  ON CONFLICT(document_id) DO UPDATE SET
    operation = excluded.operation,
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_outbox_document_delete
AFTER DELETE ON documents
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
  INSERT INTO search_index_outbox (document_id, operation, source_version)
  VALUES (
    OLD.id,
    'delete',
    (SELECT current_version FROM search_event_clock WHERE id = 1)
  )
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'delete',
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_outbox_document_tag_insert
AFTER INSERT ON document_tags
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
  INSERT INTO search_index_outbox (document_id, operation, source_version)
  VALUES (
    NEW.document_id,
    'upsert',
    (SELECT current_version FROM search_event_clock WHERE id = 1)
  )
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_outbox_document_tag_delete
AFTER DELETE ON document_tags
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
BEGIN
  UPDATE search_event_clock
  SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = 1;
  INSERT INTO search_index_outbox (document_id, operation, source_version)
  VALUES (
    OLD.document_id,
    'upsert',
    (SELECT current_version FROM search_event_clock WHERE id = 1)
  )
  ON CONFLICT(document_id) DO UPDATE SET
    operation = 'upsert',
    event_version = search_index_outbox.event_version + 1,
    source_version = excluded.source_version,
    attempt_count = 0,
    available_at = CURRENT_TIMESTAMP,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_search_clock_category_insert AFTER INSERT ON categories BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_category_update AFTER UPDATE ON categories BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_category_delete AFTER DELETE ON categories BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_tag_insert AFTER INSERT ON tags BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_tag_update AFTER UPDATE ON tags BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_tag_delete AFTER DELETE ON tags BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_rack_insert AFTER INSERT ON racks BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_rack_update AFTER UPDATE ON racks BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_rack_delete AFTER DELETE ON racks BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_rack_slot_insert AFTER INSERT ON rack_slots BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_rack_slot_update AFTER UPDATE ON rack_slots BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
CREATE TRIGGER trg_search_clock_rack_slot_delete AFTER DELETE ON rack_slots BEGIN
  UPDATE search_event_clock SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
END;
