import { verifyPassword } from "./passwords.js";
import { normalizeRole } from "./shared.js";

export async function validateUser(env, username, password) {
  const normalizedUsername = username.trim();

  const user = await env.DB.prepare(`
    SELECT username, display_name, password_salt, password_hash, status, role,
           must_change_password
    FROM app_users
    WHERE username = ?
    LIMIT 1
  `).bind(normalizedUsername).first();

  if (!user || user.status !== "approved") {
    return null;
  }

  const validPassword = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!validPassword) {
    return null;
  }

  return {
    username: user.username,
    displayName: user.display_name,
    role: normalizeRole(user.role),
    mustChangePassword: Number(user.must_change_password) === 1
  };
}
