export function createSetService(repository) {
  return Object.freeze({ ...repository });
}
