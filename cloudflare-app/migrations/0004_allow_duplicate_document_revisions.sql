PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS documents_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_code TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL,
  document_number TEXT NOT NULL,
  revision_number TEXT NOT NULL,
  document_name TEXT NOT NULL,
  note TEXT,
  rack_slot_id INTEGER NOT NULL,
  rack_face TEXT NOT NULL CHECK (rack_face IN ('A', 'B')) DEFAULT 'A',
  status TEXT NOT NULL CHECK (status IN ('active', 'disposed')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (rack_slot_id) REFERENCES rack_slots(id)
);

INSERT INTO documents_new (
  id,
  storage_code,
  category_id,
  document_number,
  revision_number,
  document_name,
  note,
  rack_slot_id,
  rack_face,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  storage_code,
  category_id,
  document_number,
  revision_number,
  document_name,
  note,
  rack_slot_id,
  rack_face,
  status,
  created_at,
  updated_at
FROM documents;

DROP TABLE documents;

ALTER TABLE documents_new RENAME TO documents;

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents(document_number, document_name, storage_code);
CREATE INDEX IF NOT EXISTS idx_documents_location ON documents(rack_slot_id, rack_face);

PRAGMA foreign_keys = ON;
