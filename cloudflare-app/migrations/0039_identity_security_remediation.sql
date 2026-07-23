-- 보안 검토 계정은 일반 UI 승인으로 복구하지 않는다.
-- production Environment 승인을 거친 전용 작업만 추적 가능한 authorization을 남기고
-- 알려진 bootstrap 계정을 새로운 credential + 최초 변경 상태로 복구할 수 있다.
CREATE TABLE identity_security_remediations (
  operation_id TEXT PRIMARY KEY
    CHECK (
      length(operation_id) BETWEEN 8 AND 128
      AND operation_id NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
  target_username TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_identity_security_remediations_no_update
BEFORE UPDATE ON identity_security_remediations
BEGIN
  SELECT RAISE(ABORT, 'identity security remediation records are immutable');
END;

CREATE TRIGGER trg_identity_security_remediations_no_delete
BEFORE DELETE ON identity_security_remediations
BEGIN
  SELECT RAISE(ABORT, 'identity security remediation records are immutable');
END;

DROP TRIGGER trg_security_review_no_approval;

CREATE TRIGGER trg_security_review_no_approval
BEFORE UPDATE OF
  status,
  security_review_required,
  role,
  approved_by,
  password_salt,
  password_hash
ON app_users
WHEN OLD.security_review_required = 1
  AND NEW.status = 'approved'
  AND NOT (
    OLD.username = 'nkh92@hanlim.com'
    AND OLD.status = 'rejected'
    AND OLD.rejected_by = 'system-bootstrap-quarantine'
    AND NEW.username = OLD.username
    AND NEW.security_review_required = 0
    AND NEW.role = 'Admin'
    AND NEW.can_manage_documents = 1
    AND NEW.can_move_documents = 1
    AND NEW.can_manage_disposals = 1
    AND NEW.can_manage_sets = 1
    AND NEW.can_manage_masters = 1
    AND NEW.can_manage_users = 1
    AND NEW.can_view_audit = 1
    AND NEW.can_apply_document_snapshots = 1
    AND NEW.must_change_password = 1
    AND NEW.session_epoch > OLD.session_epoch
    AND NEW.password_salt <> OLD.password_salt
    AND NEW.password_hash <> OLD.password_hash
    AND NEW.approved_at IS NOT NULL
    AND NEW.approved_by LIKE 'security-remediation:%'
    AND NEW.rejected_at IS NULL
    AND NEW.rejected_by IS NULL
    AND EXISTS (
      SELECT 1
      FROM identity_security_remediations AS remediation
      WHERE remediation.operation_id = substr(
        NEW.approved_by,
        length('security-remediation:') + 1
      )
        AND remediation.target_username = OLD.username
        AND remediation.requested_by = 'github-production-environment'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'security review account requires dedicated remediation');
END;
