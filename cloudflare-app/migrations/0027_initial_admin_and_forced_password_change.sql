-- 최초 관리자 계정의 기본 비밀번호 변경 여부를 서버에서 매 요청 확인한다.
ALTER TABLE app_users
ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
CHECK (must_change_password IN (0, 1));

-- 신규 환경에는 등록된 최초 관리자만 추가한다. 기존 동명 계정의 비밀번호는 덮어쓰지 않는다.
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
  'nkh92@hanlim.com',
  '관리자',
  'SbSC_rf4ZST_wP85vzRNrQ',
  '4qR0RbTdZfjmx7IOgmaD1F3sdrF8YqWS-oIblfuL02I',
  'approved',
  CURRENT_TIMESTAMP,
  'system-bootstrap',
  'Admin',
  1, 1, 1, 1, 1, 1, 1,
  1,
  CURRENT_TIMESTAMP
)
ON CONFLICT(username) DO UPDATE SET
  status = 'approved',
  approved_at = COALESCE(app_users.approved_at, CURRENT_TIMESTAMP),
  approved_by = COALESCE(app_users.approved_by, 'system-bootstrap'),
  rejected_at = NULL,
  rejected_by = NULL,
  role = 'Admin',
  can_manage_documents = 1,
  can_move_documents = 1,
  can_manage_disposals = 1,
  can_manage_sets = 1,
  can_manage_masters = 1,
  can_manage_users = 1,
  can_view_audit = 1,
  updated_at = CURRENT_TIMESTAMP;
