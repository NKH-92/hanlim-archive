export function matchDocumentRoute(path) {
  const match = path.match(/^\/documents\/(\d+)(?:\/([a-z-]+))?$/);
  if (!match) {
    return null;
  }

  return {
    id: Number(match[1]),
    action: match[2] || "details"
  };
}

export function matchRackRoute(path) {
  const match = path.match(/^\/racks\/(\d+)(?:\/([a-z-]+))?$/);
  if (!match) {
    return null;
  }

  return {
    id: Number(match[1]),
    action: match[2] || "details"
  };
}

export function matchSetRoute(path) {
  const match = path.match(/^\/sets\/(\d+)(?:\/([a-z-]+))?$/);
  if (!match) {
    return null;
  }

  return {
    id: Number(match[1]),
    action: match[2] || "details"
  };
}

export function matchMasterRoute(path, base) {
  const match = path.match(new RegExp(`^/${base}/(\\d+)/(edit|delete)$`));
  if (!match) {
    return null;
  }

  return {
    id: Number(match[1]),
    action: match[2]
  };
}

export function matchAdminUserRoute(path) {
  const match = path.match(/^\/admin\/users\/(\d+)\/(approve|reject)$/);
  if (!match) {
    return null;
  }

  return {
    id: Number(match[1]),
    action: match[2]
  };
}
