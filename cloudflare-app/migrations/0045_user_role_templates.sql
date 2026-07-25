-- 운영자가 관리하는 역할 템플릿과 사용자별 적용 상태를 추가한다.
-- 기존 세부 권한 플래그는 authorization의 단일 근거로 계속 사용한다.
CREATE TABLE user_role_templates (
  key TEXT PRIMARY KEY CHECK (key NOT GLOB '*[^a-z0-9_]*' AND length(key) BETWEEN 1 AND 40),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 50),
  can_manage_documents INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_documents IN (0, 1)),
  can_move_documents INTEGER NOT NULL DEFAULT 0 CHECK (can_move_documents IN (0, 1)),
  can_manage_disposals INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_disposals IN (0, 1)),
  can_manage_sets INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_sets IN (0, 1)),
  can_manage_masters INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_masters IN (0, 1)),
  can_manage_users INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_users IN (0, 1)),
  can_view_audit INTEGER NOT NULL DEFAULT 0 CHECK (can_view_audit IN (0, 1)),
  can_apply_document_snapshots INTEGER NOT NULL DEFAULT 0 CHECK (can_apply_document_snapshots IN (0, 1)),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL
);

INSERT INTO user_role_templates (
  key, label,
  can_manage_documents, can_move_documents, can_manage_disposals, can_manage_sets,
  can_manage_masters, can_manage_users, can_view_audit, can_apply_document_snapshots,
  updated_by
) VALUES
  ('viewer', '조회', 0, 0, 0, 0, 0, 0, 0, 0, 'migration:0045'),
  ('document_manager', '문서관리', 1, 1, 1, 1, 0, 0, 0, 0, 'migration:0045'),
  ('system_admin', '시스템관리', 1, 1, 1, 1, 1, 1, 1, 1, 'migration:0045');

-- 시스템관리 템플릿은 복구·권한 경계의 기준이므로 애플리케이션 밖에서도 고정한다.
CREATE TRIGGER trg_system_role_template_no_update
BEFORE UPDATE ON user_role_templates
WHEN OLD.key = 'system_admin'
BEGIN
  SELECT RAISE(ABORT, '시스템관리 역할 템플릿은 수정할 수 없습니다.');
END;

CREATE TRIGGER trg_system_role_template_no_delete
BEFORE DELETE ON user_role_templates
WHEN OLD.key = 'system_admin'
BEGIN
  SELECT RAISE(ABORT, '시스템관리 역할 템플릿은 삭제할 수 없습니다.');
END;

ALTER TABLE app_users
ADD COLUMN role_template_key TEXT REFERENCES user_role_templates(key);

ALTER TABLE app_users
ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

-- 정확히 일치하는 표준 구성만 연결하고, 기존 예외 구성은 사용자 지정(NULL)으로 보존한다.
UPDATE app_users
SET role_template_key = CASE
  WHEN role = 'Admin' THEN 'system_admin'
  WHEN can_manage_documents = 0
    AND can_move_documents = 0
    AND can_manage_disposals = 0
    AND can_manage_sets = 0
    AND can_manage_masters = 0
    AND can_manage_users = 0
    AND can_view_audit = 0
    AND can_apply_document_snapshots = 0 THEN 'viewer'
  WHEN can_manage_documents = 1
    AND can_move_documents = 1
    AND can_manage_disposals = 1
    AND can_manage_sets = 1
    AND can_manage_masters = 0
    AND can_manage_users = 0
    AND can_view_audit = 0
    AND can_apply_document_snapshots = 0 THEN 'document_manager'
  ELSE NULL
END;
