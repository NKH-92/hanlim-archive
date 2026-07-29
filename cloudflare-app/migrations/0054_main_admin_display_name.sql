-- 운영 승인 요청에 따라 메인 관리자 표시 이름을 실제 담당자 이름으로 정정한다.
-- 사용자 ID와 권한·credential은 유지하고, 변경 전후 값은 전역 감사로그에 남긴다.

INSERT INTO system_audit_logs (
  entity_type,
  entity_id,
  entity_reference,
  action,
  actor_user_id,
  actor_username_snapshot,
  actor_display_name_snapshot,
  actor_permissions_snapshot,
  summary,
  details_json
)
SELECT
  'user',
  CAST(id AS TEXT),
  username,
  'profile_update',
  NULL,
  'migration-0054',
  '운영 승인 작업',
  '{}',
  '메인 관리자 이름 변경',
  json_object(
    'before', json_object('displayName', display_name),
    'after', json_object('displayName', '남광현'),
    'reason', '승인된 운영 요청'
  )
FROM app_users
WHERE username = 'nkh92@hanlim.com'
  AND display_name <> '남광현';

UPDATE app_users
SET display_name = '남광현',
    row_version = row_version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'nkh92@hanlim.com'
  AND display_name <> '남광현';

-- 승인 대상 계정이 정확히 1건 존재하고 최종 이름이 반영됐을 때만 migration을 완료한다.
CREATE TABLE migration_0054_main_admin_assertion (
  matched_count INTEGER NOT NULL CHECK (matched_count = 1)
);

INSERT INTO migration_0054_main_admin_assertion (matched_count)
SELECT COUNT(*)
FROM app_users
WHERE username = 'nkh92@hanlim.com'
  AND display_name = '남광현';

DROP TABLE migration_0054_main_admin_assertion;
