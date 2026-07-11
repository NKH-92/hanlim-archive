-- 1구역 실물 반영: 1번 랙만 단면이고, 2~13번 랙은 모두 양면이다.
-- 양면 랙의 면 방향은 도면 기준 좌측이 1면(N-1), 우측이 2면(N-2)이며 표시는 html.js가 담당한다.

UPDATE racks
SET is_single_sided = CASE WHEN rack_number = 1 THEN 1 ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP
WHERE zone_number = 1;

-- 단면이 된 1번 랙은 면 구분이 없으므로, 그 랙에 2면(B)으로 기록된 문서는 1면(A)으로 정리한다.
-- (그대로 두면 데이터 품질 패널의 "단면 랙 2면 문서"에 잡히고 위치 표기도 어긋난다.)
UPDATE documents
SET rack_face = 'A',
    updated_at = CURRENT_TIMESTAMP
WHERE rack_face = 'B'
  AND rack_slot_id IN (
    SELECT rs.id
    FROM rack_slots rs
    JOIN racks r ON r.id = rs.rack_id
    WHERE r.zone_number = 1 AND r.rack_number = 1
  );
