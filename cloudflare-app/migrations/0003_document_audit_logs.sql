CREATE TABLE IF NOT EXISTS document_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER,
  storage_code TEXT NOT NULL,
  document_number TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_audit_logs_document ON document_audit_logs(document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_document_audit_logs_action ON document_audit_logs(action, created_at);

INSERT INTO document_audit_logs (
  document_id,
  storage_code,
  document_number,
  action,
  actor,
  actor_role,
  summary,
  details,
  created_at
)
SELECT
  d.id,
  d.storage_code,
  d.document_number,
  'legacy_import',
  '시스템',
  'System',
  '기존 문서 데이터 기준 audit 시작',
  json_object(
    'revisionNumber', d.revision_number,
    'documentName', d.document_name,
    'status', d.status,
    'rackFace', d.rack_face
  ),
  COALESCE(d.created_at, CURRENT_TIMESTAMP)
FROM documents d
WHERE NOT EXISTS (
  SELECT 1
  FROM document_audit_logs a
  WHERE a.document_id = d.id
);
