-- Search D1은 Core D1에서 언제든 재구축할 수 있는 파생 데이터만 저장한다.
PRAGMA foreign_keys = ON;

CREATE TABLE search_documents (
  document_id INTEGER PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  document_number TEXT NOT NULL,
  revision_number TEXT NOT NULL,
  document_name TEXT NOT NULL,
  category_name TEXT NOT NULL,
  rack_code TEXT NOT NULL,
  tag_names TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE search_documents_fts USING fts5(
  document_id UNINDEXED,
  normalized_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE search_runtime_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  indexed_document_count INTEGER NOT NULL DEFAULT 0 CHECK (indexed_document_count >= 0),
  rebuild_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (rebuild_status IN ('pending', 'building', 'ready', 'failed')),
  last_document_id INTEGER NOT NULL DEFAULT 0 CHECK (last_document_id >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO search_runtime_state (id) VALUES (1);
