ALTER TABLE racks ADD COLUMN column_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE racks ADD COLUMN shelf_count INTEGER NOT NULL DEFAULT 3;

ALTER TABLE rack_slots ADD COLUMN column_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rack_slots ADD COLUMN shelf_number INTEGER NOT NULL DEFAULT 1;

WITH numbered_slots AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY rack_id
      ORDER BY
        CASE WHEN CAST(slot_code AS INTEGER) > 0 THEN CAST(slot_code AS INTEGER) ELSE id END,
        id
    ) AS shelf_number
  FROM rack_slots
)
UPDATE rack_slots
SET
  column_number = 1,
  shelf_number = (
    SELECT numbered_slots.shelf_number
    FROM numbered_slots
    WHERE numbered_slots.id = rack_slots.id
  );

UPDATE rack_slots
SET slot_code = printf('%d-%d', column_number, shelf_number);

UPDATE racks
SET
  column_count = COALESCE((
    SELECT MAX(column_number)
    FROM rack_slots
    WHERE rack_slots.rack_id = racks.id
  ), 1),
  shelf_count = COALESCE((
    SELECT MAX(shelf_number)
    FROM rack_slots
    WHERE rack_slots.rack_id = racks.id
  ), 3);

CREATE INDEX IF NOT EXISTS idx_rack_slots_layout ON rack_slots(rack_id, column_number, shelf_number);
