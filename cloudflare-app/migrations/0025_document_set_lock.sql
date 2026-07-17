-- 세트 잠금은 전자승인이 아니라 감사 준비 목록의 우발적 편집을 막는 운영 잠금이다.
ALTER TABLE document_sets ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE document_sets ADD COLUMN locked_at TEXT;
ALTER TABLE document_sets ADD COLUMN locked_by_user_id INTEGER;
ALTER TABLE document_sets ADD COLUMN locked_by_name TEXT;
ALTER TABLE document_sets ADD COLUMN lock_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_document_sets_locked
ON document_sets(is_locked, updated_at DESC);
