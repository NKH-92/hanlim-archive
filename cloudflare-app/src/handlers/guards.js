import { accessDeniedPage } from "../views/authViews.js";

export function requireAdmin(session) {
  return session.role === "Admin" ? null : accessDeniedPage(session);
}
