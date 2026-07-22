PRAGMA foreign_keys = ON;

-- 신규 schema에서 이전 Worker로 rollback해도 개정 이력 불변식은 DB가 지킨다.
-- 개정 생성 batch는 link INSERT 전에 이전본을 폐기하므로 정상 경로를 방해하지 않는다.
CREATE TRIGGER trg_revision_previous_no_restore
BEFORE UPDATE OF status ON documents
WHEN OLD.status = 'disposed'
  AND NEW.status = 'active'
  AND EXISTS (
    SELECT 1
    FROM document_revision_links link
    WHERE link.previous_document_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, '개정으로 대체된 이전본은 복원할 수 없습니다.');
END;

CREATE TRIGGER trg_revision_linked_identity_no_update
BEFORE UPDATE OF document_number, revision_number ON documents
WHEN EXISTS (
    SELECT 1
    FROM document_revision_links link
    WHERE link.previous_document_id = OLD.id OR link.new_document_id = OLD.id
  )
  AND (
    UPPER(NEW.document_number) <> UPPER(OLD.document_number)
    OR UPPER(NEW.revision_number) <> UPPER(OLD.revision_number)
  )
BEGIN
  SELECT RAISE(ABORT, '개정 이력에 연결된 문서 identity는 변경할 수 없습니다.');
END;

CREATE TRIGGER trg_revision_linked_document_no_delete
BEFORE DELETE ON documents
WHEN EXISTS (
  SELECT 1
  FROM document_revision_links link
  WHERE link.previous_document_id = OLD.id OR link.new_document_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, '개정 이력에 연결된 문서는 삭제할 수 없습니다.');
END;
