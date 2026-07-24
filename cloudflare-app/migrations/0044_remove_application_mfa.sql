-- 애플리케이션의 2단계 인증 기능을 제거한다.
-- 이전 Worker로 긴급 롤백할 수 있도록 테이블은 당분간 유지하되,
-- 기존 TOTP seed와 복구 코드 데이터는 모두 폐기한다.
DELETE FROM user_mfa_recovery_codes;
DELETE FROM user_mfa;
