-- 사용자 상태와 세분화 권한을 추가한다. 기존 status CHECK에 disabled를 넣기 위해
-- app_users를 보존 재작성하고, 기존 Admin은 모든 권한을 갖도록 이관한다.
ALTER TABLE app_users RENAME TO app_users_legacy_0021;

CREATE TABLE app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'disabled')) DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  approved_by TEXT,
  rejected_at TEXT,
  rejected_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role TEXT NOT NULL DEFAULT 'User' CHECK (role IN ('Admin', 'User')),
  can_manage_documents INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_documents IN (0, 1)),
  can_move_documents INTEGER NOT NULL DEFAULT 0 CHECK (can_move_documents IN (0, 1)),
  can_manage_disposals INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_disposals IN (0, 1)),
  can_manage_sets INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_sets IN (0, 1)),
  can_manage_masters INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_masters IN (0, 1)),
  can_manage_users INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_users IN (0, 1)),
  can_view_audit INTEGER NOT NULL DEFAULT 0 CHECK (can_view_audit IN (0, 1))
);

INSERT INTO app_users (
  id,
  username,
  display_name,
  password_salt,
  password_hash,
  status,
  requested_at,
  approved_at,
  approved_by,
  rejected_at,
  rejected_by,
  updated_at,
  role,
  can_manage_documents,
  can_move_documents,
  can_manage_disposals,
  can_manage_sets,
  can_manage_masters,
  can_manage_users,
  can_view_audit
)
SELECT
  id,
  username,
  display_name,
  password_salt,
  password_hash,
  status,
  requested_at,
  approved_at,
  approved_by,
  rejected_at,
  rejected_by,
  updated_at,
  role,
  CASE WHEN role = 'Admin' THEN 1 ELSE 0 END,
  CASE WHEN role = 'Admin' THEN 1 ELSE 0 END,
  CASE WHEN role = 'Admin' THEN 1 ELSE 0 END,
  CASE WHEN role = 'Admin' THEN 1 ELSE 0 END,
  CASE WHEN role = 'Admin' THEN 1 ELSE 0 END,
  CASE WHEN role = 'Admin' THEN 1 ELSE 0 END,
  CASE WHEN role = 'Admin' THEN 1 ELSE 0 END
FROM app_users_legacy_0021;

DROP TABLE app_users_legacy_0021;

CREATE INDEX idx_app_users_status
ON app_users(status, requested_at);

-- 도메인 전반의 중요한 변경을 한곳에서 조회하는 append-only 감사로그.
-- 사용자 삭제나 비활성화 뒤에도 보존해야 하므로 actor_user_id에 FK를 두지 않는다.
CREATE TABLE system_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  entity_reference TEXT,
  action TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_username_snapshot TEXT NOT NULL,
  actor_display_name_snapshot TEXT NOT NULL,
  actor_permissions_snapshot TEXT,
  summary TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_system_audit_entity
ON system_audit_logs(entity_type, entity_id, created_at DESC);

CREATE INDEX idx_system_audit_actor
ON system_audit_logs(actor_username_snapshot, created_at DESC);

CREATE INDEX idx_system_audit_created
ON system_audit_logs(created_at DESC);

CREATE TRIGGER trg_system_audit_logs_no_update
BEFORE UPDATE ON system_audit_logs
BEGIN
  SELECT RAISE(ABORT, '전역 감사 로그는 수정할 수 없습니다(append-only).');
END;

CREATE TRIGGER trg_system_audit_logs_no_delete
BEFORE DELETE ON system_audit_logs
BEGIN
  SELECT RAISE(ABORT, '전역 감사 로그는 삭제할 수 없습니다(append-only).');
END;

-- 기존 문서 감사로그는 그대로 유지하되, 신규 행부터 안정적인 계정 식별자를 함께 남긴다.
ALTER TABLE document_audit_logs ADD COLUMN actor_user_id INTEGER;
ALTER TABLE document_audit_logs ADD COLUMN actor_username TEXT;
