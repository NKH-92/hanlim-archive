-- 도면 이미지(Archive.png, 1024x797) 회색 구역(랙 설치 구역) 실측 기준으로 좌표 보정.
-- 기존 좌표는 컨테이너 비율(1.45)과 이미지 비율(1.285) 불일치 + 크롭(object-fit: cover)
-- 상태에서 눈대중으로 맞춘 값이라 실제 구역과 어긋나 있었다.
UPDATE floor_plan_regions
SET top_pct = 3.2, left_pct = 4.7, width_pct = 47.5, height_pct = 38.2, updated_at = CURRENT_TIMESTAMP
WHERE region_key = 'zone-1';

UPDATE floor_plan_regions
SET top_pct = 55.8, left_pct = 2.5, width_pct = 43.9, height_pct = 38.9, updated_at = CURRENT_TIMESTAMP
WHERE region_key = 'zone-2';

UPDATE floor_plan_regions
SET top_pct = 55.8, left_pct = 52.2, width_pct = 39.1, height_pct = 38.9, updated_at = CURRENT_TIMESTAMP
WHERE region_key = 'zone-3';
