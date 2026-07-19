import { permissionSnapshot } from "../../../permissions.js";
import { clean } from "../../../shared/text/normalize.js";

export function sessionToActor(session) {
  if (!session || typeof session !== "object") throw new TypeError("Actor 생성에는 session 객체가 필요합니다.");
  return freezeActor({
    userId: positiveInteger(session.userId ?? session.user_id ?? session.id),
    username: clean(session.username) || "system",
    displayName: clean(session.displayName ?? session.display_name) || clean(session.username) || "시스템",
    role: session.role === "Admin" ? "Admin" : "User",
    permissions: permissionSnapshot(session)
  });
}

export function systemActor(name = "system") {
  const label = clean(name) || "system";
  return freezeActor({ userId: null, username: label, displayName: label, role: "System", permissions: {} });
}

export function auditActorSnapshot(value) {
  if (typeof value === "string") return systemActor(clean(value) || "시스템");
  return value?.role === "System" ? freezeActor(value) : sessionToActor(value || {});
}

export function actorUsername(actor) {
  return auditActorSnapshot(actor).username;
}

function freezeActor(actor) {
  return Object.freeze({ ...actor, permissions: Object.freeze({ ...(actor.permissions || {}) }) });
}
function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
