-- 0033의 동명 non-bootstrap 자동 demotion을 exact-signature + fail-closed review 의으로 보정다.
-- 과거 migration(0033 포함)은 수정하지 않는다.
-- 상태 기반 Admin 자동 복구/승격은 하지 않는다. 동명 non-signature는 비특권 + 검토 플래그만 남긴다.

ALTER TABLE app_users
ADD COLUMN security_review_required INTEGER NOT NULL DEFAULT 0
  CHECK (security_review_required IN (0, 1));

ALTER TABLE document_snapshots
ADD COLUMN approval_policy_version TEXT NOT NULL DEFAULT 'v1';

-- exact known bootstrap signature만 0033에서 hard revoke 대상이다.
-- 그 외 동명(비특권 User·0033 demotion 잔여·system-bootstrap 승격)은 권한을 자동으로 되돌리지 않고
-- 검토 플래그만 켠다. 런타임은 security_review_required=1 이면 로그인/세션을 거부한다.
UPDATE app_users
SET
  security_review_required = 1,
  must_change_password = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE username = 'nkh92@hanlim.com'
  AND NOT (
    password_salt = 'SbSC_rf4ZST_wP85vzRNrQ'
    AND password_hash = '4qR0RbTdZfjmx7IOgmaD1F3sdrF8YqWS-oIblfuL02I'
  );
