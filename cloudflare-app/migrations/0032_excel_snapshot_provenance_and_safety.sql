-- 엑셀 대장 출처·입력 안전성·감사 대조를 보강한다. 과거 migration은 변경하지 않는다.

ALTER TABLE document_snapshots
ADD COLUMN source_size INTEGER NOT NULL DEFAULT 0 CHECK (source_size >= 0);

ALTER TABLE document_snapshots
ADD COLUMN identity_change_count INTEGER NOT NULL DEFAULT 0 CHECK (identity_change_count >= 0);

ALTER TABLE document_snapshots
ADD COLUMN validation_errors_json TEXT;

ALTER TABLE document_snapshots
ADD COLUMN bootstrap_backup_confirmed INTEGER NOT NULL DEFAULT 0
  CHECK (bootstrap_backup_confirmed IN (0, 1));

ALTER TABLE document_snapshots
ADD COLUMN bootstrap_confirmed_at TEXT;

CREATE TABLE document_snapshot_export_manifests (
  manifest_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  base_version INTEGER NOT NULL,
  current_snapshot_id INTEGER,
  canonical_export_hash TEXT NOT NULL,
  document_count INTEGER NOT NULL CHECK (document_count >= 0),
  created_by_user_id INTEGER,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  last_snapshot_id INTEGER,
  FOREIGN KEY (current_snapshot_id) REFERENCES document_snapshots(id),
  FOREIGN KEY (last_snapshot_id) REFERENCES document_snapshots(id)
);

CREATE INDEX idx_document_snapshot_export_manifests_state
ON document_snapshot_export_manifests(base_version, current_snapshot_id, created_at DESC);

ALTER TABLE document_movements
ADD COLUMN snapshot_code TEXT;

ALTER TABLE disposal_logs
ADD COLUMN snapshot_code TEXT;
