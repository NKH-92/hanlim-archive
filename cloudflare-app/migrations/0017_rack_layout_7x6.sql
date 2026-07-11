-- 실제 문서고 랙 규격 반영: 랙은 단면 또는 양면이고, 면 하나는 좌우 7열 × 상하 6선반 = 42칸이다.
-- 양면 랙은 13-1(1면)/13-2(2면)처럼 면 단위로 부르며, 문서가 rack_face(A=1면, B=2면)로 면을 구분한다.
-- rack_slots는 면과 무관한 (열, 선반) 좌표이므로 랙당 42행이면 양면까지 표현된다.

UPDATE racks
SET column_count = 7,
    shelf_count = 6,
    updated_at = CURRENT_TIMESTAMP
WHERE column_count <> 7 OR shelf_count <> 6;

-- 칸 활성화 상태를 7×6 기준으로 재계산한다. 범위 밖 칸은 비활성으로 내리되 행은 남겨,
-- 그 위에 놓인 문서(있다면)가 위치 정보를 잃지 않게 한다.
UPDATE rack_slots
SET is_active = CASE
      WHEN column_number BETWEEN 1 AND 7 AND shelf_number BETWEEN 1 AND 6 THEN 1
      ELSE 0
    END,
    updated_at = CURRENT_TIMESTAMP;

-- 7×6 범위에서 아직 없는 칸을 생성한다 (db.js syncRackSlots와 같은 규칙).
WITH RECURSIVE
  cols(column_number) AS (
    VALUES(1)
    UNION ALL
    SELECT column_number + 1 FROM cols WHERE column_number < 7
  ),
  shelves(shelf_number) AS (
    VALUES(1)
    UNION ALL
    SELECT shelf_number + 1 FROM shelves WHERE shelf_number < 6
  )
INSERT INTO rack_slots (
  rack_id,
  slot_code,
  column_number,
  shelf_number,
  description,
  is_active,
  updated_at
)
SELECT
  racks.id,
  printf('%d-%d', cols.column_number, shelves.shelf_number),
  cols.column_number,
  shelves.shelf_number,
  printf('%d열 %d선반', cols.column_number, shelves.shelf_number),
  1,
  CURRENT_TIMESTAMP
FROM racks
CROSS JOIN cols
CROSS JOIN shelves
WHERE 1 = 1
ON CONFLICT(rack_id, slot_code) DO UPDATE SET
  column_number = excluded.column_number,
  shelf_number = excluded.shelf_number,
  description = excluded.description,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP;
