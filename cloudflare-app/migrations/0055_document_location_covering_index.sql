-- 랙 요약, 슬롯 선택, 랙 상세처럼 보관 위치에서 문서를 찾는 조회는
-- rack_slot_id별로 current 문서를 반복 탐색한다. 30,000건 기준에서
-- 기존 current-name index를 사용하면 랙 요약 한 번에 문서 집합을 슬롯마다
-- 다시 읽으므로, 위치와 상태를 함께 제공하는 covering index를 복원한다.
--
-- sync_state를 rack_slot_id 바로 뒤에 두어 랙 요약의 current 조건을 먼저
-- 좁히고, rack_face/status까지 index에 포함해 슬롯·면별 집계의 table lookup을
-- 피한다. partial index로 만들지 않아 분할 bootstrap의 마지막 공개 단계에
-- index write가 한꺼번에 몰리지 않게 한다.
CREATE INDEX idx_documents_location_current_state
ON documents(rack_slot_id, sync_state, rack_face, status);
