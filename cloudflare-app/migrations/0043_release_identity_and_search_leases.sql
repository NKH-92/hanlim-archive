-- Release-scoped identities expire independently of workflow cleanup.
ALTER TABLE app_users
ADD COLUMN expires_at TEXT;

CREATE INDEX idx_app_users_expiry
ON app_users(status, expires_at);

-- Outbox rows are claimed before cross-D1 writes. The lease is tied to the
-- current event_version so a newer event immediately invalidates an old claim.
ALTER TABLE search_index_outbox
ADD COLUMN lease_owner TEXT;

ALTER TABLE search_index_outbox
ADD COLUMN lease_event_version INTEGER;

ALTER TABLE search_index_outbox
ADD COLUMN lease_expires_at TEXT;

CREATE INDEX idx_search_index_outbox_lease
ON search_index_outbox(available_at, lease_expires_at, updated_at, document_id);

ALTER TABLE search_index_state
ADD COLUMN processor_lease_owner TEXT;

ALTER TABLE search_index_state
ADD COLUMN processor_lease_expires_at TEXT;
