-- 실사용 전 schema 정리.
--
-- user_mfa / user_mfa_recovery_codes:
--   애플리케이션 MFA는 0044에서 제거했고 seed·복구코드도 이미 삭제했다.
--   현재 Worker source는 두 테이블을 전혀 참조하지 않는다.
--
-- bootstrap_runs / bootstrap_chunks:
--   0040의 과거 초기 적재 작업 모델이며 현재 Excel snapshot bootstrap 경로에서는 사용하지 않는다.
--   현재 runtime source와 운영 script 모두 두 테이블을 참조하지 않는다.
--
-- 직전 Worker rollback 경로가 사용하지 않는 dead schema만 제거한다.
-- bootstrap_runtime_control, login_throttle, search_index_state는 현재 runtime/rollback 계약이 있어 유지한다.

DROP TABLE IF EXISTS user_mfa_recovery_codes;
DROP TABLE IF EXISTS user_mfa;

DROP TABLE IF EXISTS bootstrap_chunks;
DROP TABLE IF EXISTS bootstrap_runs;
