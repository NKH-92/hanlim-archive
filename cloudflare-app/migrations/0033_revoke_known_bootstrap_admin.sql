-- 0027이 심은 알려진 bootstrap 자격증명만 회수·비활성화한다.
-- 과거 migration은 수정하지 않으며, 동명이지만 signature가 다른 계정은 자동 승격·삭제하지 않는다.
-- 동명 non-bootstrap 계정이 0027 ON CONFLICT로 Admin이 된 경우 권한만 회수하고 수동 검토 대상으로 남긴다.

UPDATE app_users
SET
  status = 'rejected',
  rejected_at = CURRENT_TIMESTAMP,
  rejected_by = 'system-bootstrap-revoke',
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
  updated_at = CURRENT_TIMESTAMP
WHERE username = 'nkh92@hanlim.com'
  AND password_salt = 'SbSC_rf4ZST_wP85vzRNrQ'
  AND password_hash = '4qR0RbTdZfjmx7IOgmaD1F3sdrF8YqWS-oIblfuL02I';

-- 동명·다른 credential: 자동 Admin 승격 잔여분을 회수하고 검토 대상으로 표시한다.
UPDATE app_users
SET
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
  updated_at = CURRENT_TIMESTAMP
WHERE username = 'nkh92@hanlim.com'
  AND NOT (
    password_salt = 'SbSC_rf4ZST_wP85vzRNrQ'
    AND password_hash = '4qR0RbTdZfjmx7IOgmaD1F3sdrF8YqWS-oIblfuL02I'
  )
  AND (
    role = 'Admin'
    OR can_manage_users = 1
    OR approved_by = 'system-bootstrap'
  );

-- prepare 시점 승인 baseline을 apply에서 재계산하지 않도록 저장한다.
ALTER TABLE document_snapshots
ADD COLUMN baseline_current_document_count INTEGER NOT NULL DEFAULT 0
  CHECK (baseline_current_document_count >= 0);

ALTER TABLE document_snapshots
ADD COLUMN approval_required INTEGER NOT NULL DEFAULT 0
  CHECK (approval_required IN (0, 1));
