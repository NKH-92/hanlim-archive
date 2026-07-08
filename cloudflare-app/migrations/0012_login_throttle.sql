-- 로그인 무차별 대입 방어: 10분 내 5회 실패 시 10분 잠금.
CREATE TABLE IF NOT EXISTS login_throttle (
  username TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until TEXT
);
