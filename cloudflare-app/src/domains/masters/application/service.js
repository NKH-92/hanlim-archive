import { validateMasterValues } from "../domain/policy.js";

export function createMasterService(repository) {
  return Object.freeze({
    getCategories: (env) => repository.listMasters(env, "category"),
    getActiveCategories: (env) => repository.listMasters(env, "category", { activeOnly: true }),
    getTags: (env) => repository.listMasters(env, "tag"),
    getActiveTags: (env) => repository.listMasters(env, "tag", { activeOnly: true }),
    upsertCategory: (env, values, actor = {}) => saveValidated(repository, env, "category", values, actor),
    upsertTag: (env, values, actor = {}) => saveValidated(repository, env, "tag", values, actor),
    deleteCategory: (env, id, actor = {}, expectedRowVersion = 0) => repository.deactivateMaster(env, "category", Number(id), actor, Number(expectedRowVersion)),
    deleteTag: (env, id, actor = {}, expectedRowVersion = 0) => repository.deactivateMaster(env, "tag", Number(id), actor, Number(expectedRowVersion))
  });
}

async function saveValidated(repository, env, type, values, actor) {
  const validation = validateMasterValues(type, values);
  if (!validation.ok) return { ok: false, message: validation.message };
  return repository.saveMaster(env, type, validation.values, actor);
}
