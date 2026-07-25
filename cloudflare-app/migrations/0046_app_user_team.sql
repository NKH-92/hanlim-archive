-- 사용자 명단의 팀(부서)을 보관한다. 표시·조회용 값이며 권한 판정에는 사용하지 않는다.
-- 이전 Worker는 이 컬럼을 읽지 않으므로 rollback 중에도 그대로 동작한다.
ALTER TABLE app_users
ADD COLUMN team TEXT CHECK (team IS NULL OR length(trim(team)) BETWEEN 1 AND 40);
