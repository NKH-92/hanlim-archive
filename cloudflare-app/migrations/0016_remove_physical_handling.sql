-- 실물 취급 기능 제거: 입·반출(checkout/return)과 이동(move) 워크플로를 코드에서 삭제하면서
-- 관련 테이블도 함께 정리한다. 문서 등록·검색과 위치(랙)·폐기·세트 기능은 그대로 유지한다.
--
-- SQLite는 DROP TABLE 시 해당 테이블의 인덱스·트리거를 자동으로 함께 제거하지만,
-- 0015에서 만든 movement_logs 불변성 트리거는 명시적으로 먼저 내려 의도를 분명히 한다.
-- disposal_logs / document_set_logs 트리거는 폐기·세트 기능이 유지되므로 남겨 둔다.

DROP TRIGGER IF EXISTS trg_movement_logs_no_update;

-- 반출 기록: documents 하드삭제 CASCADE 자식 테이블(자기완결적). 인덱스도 함께 제거된다.
DROP TABLE IF EXISTS document_checkouts;

-- 이동 이력: rack_slots를 FK로 참조하는 자식 테이블. 등록 시 초기 이동 로그 INSERT도 코드에서 제거됨.
DROP TABLE IF EXISTS movement_logs;
