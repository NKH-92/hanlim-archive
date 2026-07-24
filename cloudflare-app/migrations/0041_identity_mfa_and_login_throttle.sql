-- 로그인 제한 식별자를 원문 이메일/IP 대신 고정키 HMAC으로 저장하고,
-- 선택형 TOTP MFA와 일회용 복구 코드를 추가한다.
CREATE TABLE login_throttle_v2 (
  bucket_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('pair', 'account', 'ip', 'global')),
  fail_count INTEGER NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_login_throttle_v2_expiry
ON login_throttle_v2(updated_at, locked_until);

CREATE TABLE user_mfa (
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'enabled')),
  encrypted_secret TEXT NOT NULL,
  encryption_key_version TEXT NOT NULL DEFAULT 'v1',
  last_totp_counter INTEGER CHECK (last_totp_counter IS NULL OR last_totp_counter >= 0),
  pending_expires_at TEXT,
  enabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_mfa_pending_expiry
ON user_mfa(status, pending_expires_at);

CREATE TABLE user_mfa_recovery_codes (
  user_id INTEGER NOT NULL,
  code_digest TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, code_digest),
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_mfa_recovery_unused
ON user_mfa_recovery_codes(user_id, used_at);

-- 공개 migration 이력에 verifier가 남은 영구 smoke 계정은 되살릴 수 없게 닫는다.
-- 행은 운영 감사와 이전 Worker 호환을 위해 보존하되 credential과 세션은 회수한다.
UPDATE app_users
SET
  status = 'rejected',
  rejected_at = CURRENT_TIMESTAMP,
  rejected_by = 'system-release-smoke-retired',
  password_salt = lower(hex(randomblob(16))),
  password_hash = lower(hex(randomblob(32))),
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
WHERE username = 'release-smoke@hanlim.internal';
