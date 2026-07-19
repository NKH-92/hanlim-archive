-- 운영 배포 검증은 변경 권한이 없는 전용 계정으로 인증 검색만 확인한다.
INSERT INTO app_users (
  username,
  display_name,
  password_salt,
  password_hash,
  status,
  approved_at,
  approved_by,
  role,
  can_manage_documents,
  can_move_documents,
  can_manage_disposals,
  can_manage_sets,
  can_manage_masters,
  can_manage_users,
  can_view_audit,
  must_change_password,
  updated_at
)
VALUES (
  'release-smoke@hanlim.internal',
  '배포 검증',
  'cdBJtx4CDuIlkkI1Gkp2aw',
  'DjUtr1zXWxPnVc_uY5VimLrqFYN1_Fd0FhwynRcjnA4',
  'approved',
  CURRENT_TIMESTAMP,
  'system-provisioning',
  'User',
  0, 0, 0, 0, 0, 0, 0,
  0,
  CURRENT_TIMESTAMP
)
ON CONFLICT(username) DO NOTHING;
