-- 감사·이력 테이블 불변성 (ALCOA+ Original/Enduring: 기록은 변조·삭제 불가).
-- 애플리케이션은 이 테이블들에 INSERT만 하므로 UPDATE/DELETE를 DB 수준에서 차단해
-- D1 콘솔·향후 코드 버그·엔드포인트가 이력을 조용히 바꾸지 못하게 한다.
--
-- 주의: movement_logs / disposal_logs 는 documents 하드삭제 시 ON DELETE CASCADE로 함께 지워질 수
-- 있으므로 DELETE는 허용하고 UPDATE만 막는다(완전삭제 전 이력은 document_audit_logs에 스냅샷 보존).
-- document_audit_logs 는 어떤 FK로도 CASCADE되지 않으므로 UPDATE·DELETE를 모두 막는다.

CREATE TRIGGER IF NOT EXISTS trg_document_audit_logs_no_update
BEFORE UPDATE ON document_audit_logs
BEGIN
  SELECT RAISE(ABORT, '감사 로그는 수정할 수 없습니다(append-only).');
END;

CREATE TRIGGER IF NOT EXISTS trg_document_audit_logs_no_delete
BEFORE DELETE ON document_audit_logs
BEGIN
  SELECT RAISE(ABORT, '감사 로그는 삭제할 수 없습니다(append-only).');
END;

CREATE TRIGGER IF NOT EXISTS trg_movement_logs_no_update
BEFORE UPDATE ON movement_logs
BEGIN
  SELECT RAISE(ABORT, '이동 이력은 수정할 수 없습니다(append-only).');
END;

CREATE TRIGGER IF NOT EXISTS trg_disposal_logs_no_update
BEFORE UPDATE ON disposal_logs
BEGIN
  SELECT RAISE(ABORT, '폐기 이력은 수정할 수 없습니다(append-only).');
END;

CREATE TRIGGER IF NOT EXISTS trg_document_set_logs_no_update
BEFORE UPDATE ON document_set_logs
BEGIN
  SELECT RAISE(ABORT, '세트 변경 이력은 수정할 수 없습니다(append-only).');
END;

CREATE TRIGGER IF NOT EXISTS trg_document_set_logs_no_delete
BEFORE DELETE ON document_set_logs
BEGIN
  SELECT RAISE(ABORT, '세트 변경 이력은 삭제할 수 없습니다(append-only).');
END;
