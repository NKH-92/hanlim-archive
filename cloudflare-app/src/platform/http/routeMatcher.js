export function normalizePath(path) {
  return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}
