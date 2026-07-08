ALTER TABLE app_users
ADD COLUMN role TEXT NOT NULL DEFAULT 'User' CHECK (role IN ('Admin', 'User'));
