-- 현재 문서고 운영 현황 반영: 랙은 1구역에만 있으며, 좌측부터 1번~13번 총 13개다.
-- 2·3구역은 아직 랙이 없으므로 랙을 비활성화한다(행은 증설 대비 보존 — configureRackCounts와
-- 같은 방식이며, 문서가 있는 랙도 조회는 그대로 동작한다). 구역 구조 자체(1~3)는 유지한다.

-- 1구역 1~13번 랙이 없으면 만든다. 규격은 0017과 동일한 면당 7열×6선반.
WITH RECURSIVE nums(rack_number) AS (
  VALUES(1)
  UNION ALL
  SELECT rack_number + 1 FROM nums WHERE rack_number < 13
)
INSERT INTO racks (
  zone_number,
  rack_number,
  code,
  name,
  description,
  is_single_sided,
  is_active,
  column_count,
  shelf_count,
  updated_at
)
SELECT
  1,
  nums.rack_number,
  printf('1-%02d', nums.rack_number),
  printf('1구역 %02d번 랙', nums.rack_number),
  '1구역 운영 랙',
  0,
  1,
  7,
  6,
  CURRENT_TIMESTAMP
FROM nums
WHERE 1 = 1
ON CONFLICT(zone_number, rack_number) DO NOTHING;

-- 활성 랙 = 1구역 1~13번뿐.
UPDATE racks
SET is_active = CASE WHEN zone_number = 1 AND rack_number <= 13 THEN 1 ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP;

-- 새로 생긴 1구역 랙(특히 13번)의 42칸을 채운다 (0017과 동일 규칙).
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
WHERE racks.zone_number = 1
ON CONFLICT(rack_id, slot_code) DO UPDATE SET
  column_number = excluded.column_number,
  shelf_number = excluded.shelf_number,
  description = excluded.description,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP;

-- 도면: 1구역 기본 랙 수를 실제(13)에 맞춘다.
UPDATE floor_plan_regions
SET default_rack_count = 13,
    updated_at = CURRENT_TIMESTAMP
WHERE region_key = 'zone-1';
