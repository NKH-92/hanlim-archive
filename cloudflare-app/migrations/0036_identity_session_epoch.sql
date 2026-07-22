-- 비밀번호 변경·로그아웃 뒤 기존 signed cookie를 즉시 무효화한다.
ALTER TABLE app_users
ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0
  CHECK (session_epoch >= 0);

-- 알려진 0027 bootstrap verifier는 상태만 반려하는 것으로 충분하지 않다.
-- verifier 자체를 복구 불가능한 무작위 값으로 교체하고 일반 재승인 경로에서도
-- 풀 수 없는 보안 검토 대상으로 격리한다.
UPDATE app_users
SET
  password_salt = lower(hex(randomblob(16))),
  password_hash = lower(hex(randomblob(32)))
WHERE username = 'nkh92@hanlim.com'
  AND password_salt = 'SbSC_rf4ZST_wP85vzRNrQ'
  AND password_hash = '4qR0RbTdZfjmx7IOgmaD1F3sdrF8YqWS-oIblfuL02I';

-- 0027의 동명 충돌 이력까지 모두 명시적 수동 검토 전에는 인증하지 않는다.
-- status도 함께 닫아 이 migration보다 이전 Worker로 rollback되어도 fail-closed다.
UPDATE app_users
SET
  status = 'rejected',
  rejected_at = CURRENT_TIMESTAMP,
  rejected_by = 'system-bootstrap-quarantine',
  role = 'User',
  can_manage_documents = 0,
  can_move_documents = 0,
  can_manage_disposals = 0,
  can_manage_sets = 0,
  can_manage_masters = 0,
  can_manage_users = 0,
  can_view_audit = 0,
  can_apply_document_snapshots = 0,
  must_change_password = 1,
  security_review_required = 1,
  session_epoch = session_epoch + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE username = 'nkh92@hanlim.com';

-- 이전 Worker도 보안 검토 계정을 일반 승인 경로로 되살릴 수 없다.
CREATE TRIGGER trg_security_review_no_approval
BEFORE UPDATE OF status ON app_users
WHEN OLD.security_review_required = 1
  AND NEW.status = 'approved'
BEGIN
  SELECT RAISE(ABORT, 'security review account requires dedicated remediation');
END;

-- 이전 Worker의 상태 변경도 epoch를 회전시켜 이후 최신 Worker가 기존
-- cookie를 수락하지 않게 한다. 최신 Worker는 직접 epoch를 올리므로 중복 증가하지 않는다.
CREATE TRIGGER trg_user_status_session_epoch_compat
AFTER UPDATE OF status ON app_users
WHEN NEW.status <> OLD.status
  AND NEW.session_epoch = OLD.session_epoch
BEGIN
  UPDATE app_users
  SET session_epoch = OLD.session_epoch + 1
  WHERE id = NEW.id;
END;

-- epoch를 모르는 이전 Worker가 disabled 계정을 다시 승인하면 탈취 cookie가
-- 살아날 수 있으므로, 재활성화는 epoch-aware UPDATE에서만 허용한다.
CREATE TRIGGER trg_user_enable_requires_epoch_rotation
BEFORE UPDATE OF status ON app_users
WHEN OLD.status = 'disabled'
  AND NEW.status = 'approved'
  AND NEW.session_epoch <= OLD.session_epoch
BEGIN
  SELECT RAISE(ABORT, 'user enable requires session epoch rotation');
END;
