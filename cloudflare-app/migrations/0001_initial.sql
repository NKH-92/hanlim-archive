PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS racks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_number INTEGER NOT NULL CHECK (zone_number BETWEEN 1 AND 3),
  rack_number INTEGER NOT NULL CHECK (rack_number BETWEEN 1 AND 15),
  code TEXT NOT NULL UNIQUE,
  name TEXT,
  description TEXT,
  is_single_sided INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (zone_number, rack_number)
);

CREATE TABLE IF NOT EXISTS rack_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rack_id INTEGER NOT NULL,
  slot_code TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rack_id) REFERENCES racks(id) ON DELETE CASCADE,
  UNIQUE (rack_id, slot_code)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_code TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL,
  document_number TEXT NOT NULL,
  revision_number TEXT NOT NULL,
  document_name TEXT NOT NULL,
  note TEXT,
  rack_slot_id INTEGER NOT NULL,
  rack_face TEXT NOT NULL CHECK (rack_face IN ('A', 'B')) DEFAULT 'A',
  status TEXT NOT NULL CHECK (status IN ('active', 'disposed')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (rack_slot_id) REFERENCES rack_slots(id)
);

CREATE TABLE IF NOT EXISTS document_tags (
  document_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movement_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  from_rack_slot_id INTEGER,
  from_rack_face TEXT CHECK (from_rack_face IN ('A', 'B')),
  to_rack_slot_id INTEGER NOT NULL,
  to_rack_face TEXT NOT NULL CHECK (to_rack_face IN ('A', 'B')),
  performed_by TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (from_rack_slot_id) REFERENCES rack_slots(id),
  FOREIGN KEY (to_rack_slot_id) REFERENCES rack_slots(id)
);

CREATE TABLE IF NOT EXISTS disposal_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('disposed', 'restored')),
  performed_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents(document_number, document_name, storage_code);
CREATE INDEX IF NOT EXISTS idx_documents_location ON documents(rack_slot_id, rack_face);
CREATE INDEX IF NOT EXISTS idx_racks_zone_number ON racks(zone_number, rack_number);

INSERT OR IGNORE INTO categories (name, description, sort_order) VALUES
  ('제조기록서', '제조 공정 관리 문서', 10),
  ('제품사양서', '제품 기준 및 규격 문서', 20),
  ('PV', '공정 밸리데이션 문서', 30),
  ('CV', '청소 밸리데이션 문서', 40),
  ('IQ', '설치 적격성 평가 문서', 50),
  ('OQ', '운전 적격성 평가 문서', 60);

INSERT OR IGNORE INTO tags (name, description) VALUES
  ('감사대상 문서', '규제 감사 대상 여부를 확인해야 하는 문서'),
  ('중요문서', '우선 관리가 필요한 핵심 문서'),
  ('원본보관', '원본 상태 유지가 필요한 문서');

INSERT OR IGNORE INTO racks (zone_number, rack_number, code, name, description, is_single_sided)
WITH RECURSIVE nums(n) AS (
  VALUES(1)
  UNION ALL
  SELECT n + 1 FROM nums WHERE n < 10
),
zones(zone_number) AS (
  VALUES(1), (2), (3)
)
SELECT
  zones.zone_number,
  nums.n,
  printf('%d-%02d', zones.zone_number, nums.n),
  printf('%d구역 %02d번 랙', zones.zone_number, nums.n),
  printf('%d구역 테스트 랙', zones.zone_number),
  CASE WHEN zones.zone_number = 2 AND nums.n IN (9, 10) THEN 1 ELSE 0 END
FROM zones
CROSS JOIN nums;

INSERT OR IGNORE INTO rack_slots (rack_id, slot_code, description)
SELECT racks.id, slots.slot_code, slots.description
FROM racks
CROSS JOIN (
  SELECT '1' AS slot_code, '상단 선반' AS description
  UNION ALL SELECT '2', '중단 선반'
  UNION ALL SELECT '3', '하단 선반'
) slots;

INSERT OR IGNORE INTO documents (
  storage_code,
  category_id,
  document_number,
  revision_number,
  document_name,
  note,
  rack_slot_id,
  rack_face,
  status
)
SELECT
  'ARC-000001',
  c.id,
  'MR-2026-001',
  'Rev.0',
  '2026년 1분기 제조기록서',
  'Cloudflare 테스트 기본 문서',
  rs.id,
  'B',
  'active'
FROM categories c
JOIN racks r ON r.code = '1-01'
JOIN rack_slots rs ON rs.rack_id = r.id AND rs.slot_code = '1'
WHERE c.name = '제조기록서';

INSERT OR IGNORE INTO documents (
  storage_code,
  category_id,
  document_number,
  revision_number,
  document_name,
  note,
  rack_slot_id,
  rack_face,
  status
)
SELECT
  'ARC-000002',
  c.id,
  'PV-2026-014',
  'Rev.1',
  '충전공정 밸리데이션 보고서',
  'Cloudflare 테스트 기본 문서',
  rs.id,
  'A',
  'active'
FROM categories c
JOIN racks r ON r.code = '2-01'
JOIN rack_slots rs ON rs.rack_id = r.id AND rs.slot_code = '1'
WHERE c.name = 'PV';

INSERT OR IGNORE INTO document_tags (document_id, tag_id)
SELECT d.id, t.id
FROM documents d
JOIN tags t ON t.name IN ('감사대상 문서', '중요문서')
WHERE d.storage_code = 'ARC-000001';

INSERT OR IGNORE INTO movement_logs (document_id, to_rack_slot_id, to_rack_face, performed_by, note)
SELECT id, rack_slot_id, rack_face, '시드데이터', '초기 샘플 데이터 등록'
FROM documents
WHERE storage_code IN ('ARC-000001', 'ARC-000002');
