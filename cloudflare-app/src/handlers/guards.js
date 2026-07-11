import { accessDeniedPage } from "../html.js";

export function requireAdmin(session) {
  return session.role === "Admin" ? null : accessDeniedPage(session);
}
