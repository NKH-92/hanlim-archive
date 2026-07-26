export function hasChanged(result) {
  return Number(result?.meta?.changes ?? 0) > 0;
}
