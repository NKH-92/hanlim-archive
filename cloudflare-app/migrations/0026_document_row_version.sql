-- SQLite CURRENT_TIMESTAMP는 초 단위라 같은 초의 연속 변경을 구분하지 못한다.
-- 폐기 동결과 위치 이동의 낙관적 잠금은 단조 증가 버전을 함께 사용한다.
ALTER TABLE documents
ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE disposal_batch_items
ADD COLUMN expected_document_version INTEGER NOT NULL DEFAULT 1;
