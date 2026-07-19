export function isSetLocked(set) {
  return Number(set?.is_locked ?? set?.isLocked) === 1;
}

export function actorDisplayName(actor) {
  if (actor && typeof actor === "object") {
    return String(actor.displayName ?? actor.display_name ?? actor.username ?? "알 수 없음").trim() || "알 수 없음";
  }
  // 기존 테스트·외부 소비자의 단계적 이전만 지원하는 호환 입력이다.
  return String(actor || "알 수 없음").trim() || "알 수 없음";
}
