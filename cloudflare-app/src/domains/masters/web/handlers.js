import { notFoundPage } from "../../../views/authViews.js";
import { redirect } from "../../../platform/http/responses.js";
import { deleteCategory, deleteTag, getCategories, getTags, upsertCategory, upsertTag } from "../service.js";
import { parseCategoryForm, parseTagForm } from "./forms.js";
import { categoriesPage, tagsPage } from "./views.js";

export async function renderCategories(env, session, error = "", values = {}) {
  return categoriesPage({ session, categories: await getCategories(env), error, values });
}
export async function renderTags(env, session, error = "", values = {}) {
  return tagsPage({ session, tags: await getTags(env), error, values });
}

export async function handleSaveCategory(request, env, session, id = 0) {
  const values = parseCategoryForm(await request.formData(), id);
  const result = await upsertCategory(env, values, session);
  return result.ok ? redirect("/categories?toast=saved") : renderCategories(env, session, result.message, values);
}
export async function handleSaveTag(request, env, session, id = 0) {
  const values = parseTagForm(await request.formData(), id);
  const result = await upsertTag(env, values, session);
  return result.ok ? redirect("/tags?toast=saved") : renderTags(env, session, result.message, values);
}

export async function handleCategoryAction(request, env, session, routeInfo) {
  if (routeInfo.action === "edit") return handleSaveCategory(request, env, session, routeInfo.id);
  if (routeInfo.action !== "delete") return notFoundPage(session);
  const result = await deleteCategory(env, routeInfo.id, session);
  return result.ok ? redirect("/categories?toast=saved") : renderCategories(env, session, result.message);
}
export async function handleTagAction(request, env, session, routeInfo) {
  if (routeInfo.action === "edit") return handleSaveTag(request, env, session, routeInfo.id);
  if (routeInfo.action !== "delete") return notFoundPage(session);
  const result = await deleteTag(env, routeInfo.id, session);
  return result.ok ? redirect("/tags?toast=saved") : renderTags(env, session, result.message);
}
