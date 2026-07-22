-- 기준정보의 동시 수정을 감지하는 단조 증가 버전이다. 이 migration은 append-only로 유지한다.
ALTER TABLE categories
ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE tags
ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE racks
ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE document_sets
ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

-- 0038 이전 Worker가 row_version을 명시하지 않고 UPDATE하더라도 이후 요청이
-- stale 제출을 감지할 수 있도록 호환 경로에서도 버전을 단조 증가시킨다.
CREATE TRIGGER trg_category_row_version_compat
AFTER UPDATE ON categories
WHEN NEW.row_version = OLD.row_version
BEGIN
  UPDATE categories
  SET row_version = OLD.row_version + 1
  WHERE id = NEW.id AND row_version = OLD.row_version;
END;

CREATE TRIGGER trg_tag_row_version_compat
AFTER UPDATE ON tags
WHEN NEW.row_version = OLD.row_version
BEGIN
  UPDATE tags
  SET row_version = OLD.row_version + 1
  WHERE id = NEW.id AND row_version = OLD.row_version;
END;

CREATE TRIGGER trg_rack_row_version_compat
AFTER UPDATE ON racks
WHEN NEW.row_version = OLD.row_version
BEGIN
  UPDATE racks
  SET row_version = OLD.row_version + 1
  WHERE id = NEW.id AND row_version = OLD.row_version;
END;

CREATE TRIGGER trg_document_set_row_version_compat
AFTER UPDATE ON document_sets
WHEN NEW.row_version = OLD.row_version
BEGIN
  UPDATE document_sets
  SET row_version = OLD.row_version + 1
  WHERE id = NEW.id AND row_version = OLD.row_version;
END;
