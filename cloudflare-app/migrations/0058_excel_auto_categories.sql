-- 최초 대량등록 중에는 외부 기준정보 변경을 계속 차단하되,
-- 내부 apply batch가 잠금을 잡은 뒤 수행하는 문서종류 자동 생성은 허용한다.
DROP TRIGGER IF EXISTS trg_bootstrap_lock_categories_insert;

CREATE TRIGGER trg_bootstrap_lock_categories_insert BEFORE INSERT ON categories
WHEN (SELECT suppress_derived_triggers FROM bootstrap_runtime_control WHERE id = 1) = 0
  AND EXISTS (
    SELECT 1
    FROM document_snapshots
    WHERE status = 'applying'
      AND mode = 'bootstrap'
      AND bootstrap_apply_actor_json IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'BOOTSTRAP_APPLY_IN_PROGRESS');
END;
