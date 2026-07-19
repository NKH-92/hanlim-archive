import { clean } from "../text/normalize.js";

export function actorFromSession(session, permissions = {}) {
  if (!session || typeof session !== "object") throw new TypeError("Actor 생성에는 인증된 session 객체가 필요합니다.");
  const userId = Number(session.userId ?? session.user_id ?? session.id);
  const role = session.role === "Admin" ? "Admin" : "User";
  return Object.freeze({
    userId: Number.isInteger(userId) && userId > 0 ? userId : null,
    username: clean(session.username),
    displayName: clean(session.displayName ?? session.display_name) || clean(session.username),
    role,
    permissions: Object.freeze({ ...permissions })
  });
}

export function systemActor(name = "system") {
  const label = clean(name) || "system";
  return Object.freeze({ userId: null, username: label, displayName: label, role: "System", permissions: Object.freeze({}) });
}

export function serializeActor(actor) {
  if (!actor || typeof actor !== "object") throw new TypeError("Actor는 객체여야 합니다.");
  return Object.freeze({
    userId: actor.userId ?? null,
    username: clean(actor.username),
    displayName: clean(actor.displayName),
    role: actor.role,
    permissions: Object.freeze({ ...(actor.permissions || {}) })
  });
}
