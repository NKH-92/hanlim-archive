import { createPasswordRecord } from "../src/auth.js";

const [username, displayName, password] = process.argv.slice(2);

if (!username || !displayName || !password) {
  console.error("Usage: node scripts/create-admin-sql.mjs <username> <display-name> <password>");
  process.exit(1);
}

if (username.length < 4) {
  console.error("The admin username must be at least 4 characters.");
  process.exit(1);
}

if (password.length < 8) {
  console.error("The admin password must be at least 8 characters.");
  process.exit(1);
}

const passwordRecord = await createPasswordRecord(password);

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

console.log(`
INSERT INTO app_users (
  username,
  display_name,
  password_salt,
  password_hash,
  status,
  approved_at,
  approved_by,
  role,
  updated_at
)
VALUES (
  ${sql(username)},
  ${sql(displayName)},
  ${sql(passwordRecord.salt)},
  ${sql(passwordRecord.hash)},
  'approved',
  CURRENT_TIMESTAMP,
  'admin bootstrap',
  'Admin',
  CURRENT_TIMESTAMP
)
ON CONFLICT(username) DO UPDATE SET
  display_name = excluded.display_name,
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  status = 'approved',
  approved_at = COALESCE(app_users.approved_at, CURRENT_TIMESTAMP),
  approved_by = COALESCE(app_users.approved_by, 'admin bootstrap'),
  rejected_at = NULL,
  rejected_by = NULL,
  role = 'Admin',
  updated_at = CURRENT_TIMESTAMP;
`.trim());
