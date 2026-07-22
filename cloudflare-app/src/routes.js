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
  const match = path.match(/^\/sets\/(\d+)(?:\/([a-z.-]+))?$/);
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
  const match = path.match(/^\/admin\/users\/(\d+)\/(approve|reject|disable|enable|permissions)$/);
  if (!match) {
    return null;
  }

  return {
    id: Number(match[1]),
    action: match[2]
  };
}

export function matchDisposalBatchRoute(path) {
  const item = path.match(/^\/disposal-batches\/(\d+)\/items\/(\d+)\/(exclude|include)$/);
  if (item) {
    return { id: Number(item[1]), itemId: Number(item[2]), action: item[3] };
  }
  const match = path.match(/^\/disposal-batches\/(\d+)(?:\/(edit|freeze|start|process|cancel|export\.csv))?$/);
  if (!match) return null;
  return { id: Number(match[1]), action: match[2] || "details", itemId: 0 };
}

export function matchDocumentImportJobRoute(path) {
  const match = path.match(/^\/document-import-jobs\/(\d+)(?:\/(process|cancel|failures\.csv))?$/);
  if (!match) return null;
  return { id: Number(match[1]), action: match[2] || "details" };
}

export function matchDocumentSnapshotRoute(path) {
  const match = path.match(/^\/document-snapshots\/(\d+)(?:\/(rows|prepare|apply|cancel))?$/);
  if (!match) return null;
  return { id: Number(match[1]), action: match[2] || "details" };
}
