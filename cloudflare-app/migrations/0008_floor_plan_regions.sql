CREATE TABLE IF NOT EXISTS floor_plan_regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  top_pct REAL NOT NULL CHECK (top_pct >= 0 AND top_pct <= 100),
  left_pct REAL NOT NULL CHECK (left_pct >= 0 AND left_pct <= 100),
  width_pct REAL NOT NULL CHECK (width_pct > 0 AND width_pct <= 100),
  height_pct REAL NOT NULL CHECK (height_pct > 0 AND height_pct <= 100),
  default_rack_count INTEGER NOT NULL DEFAULT 0 CHECK (default_rack_count >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_floor_plan_regions_active
  ON floor_plan_regions(is_active, region_key);

INSERT OR IGNORE INTO floor_plan_regions (
  region_key,
  label,
  description,
  top_pct,
  left_pct,
  width_pct,
  height_pct,
  default_rack_count,
  is_active
) VALUES
  ('zone-1', '1구역', '좌상단 문서 보관 구역', 8.8, 5.2, 42.8, 38.8, 10, 1),
  ('zone-2', '2구역', '좌하단 문서 보관 구역', 55.0, 5.2, 42.8, 37.8, 10, 1),
  ('zone-3', '3구역', '우하단 문서 보관 구역', 55.0, 52.0, 37.8, 37.8, 10, 1);
