export {
  getCategories,
  getActiveCategories,
  getTags,
  getActiveTags,
  upsertCategory,
  deleteCategory,
  upsertTag,
  deleteTag
} from "./service.js";

export { categoriesPage, tagsPage } from "./web/views.js";
export {
  renderCategories,
  handleSaveCategory,
  handleCategoryAction,
  renderTags,
  handleSaveTag,
  handleTagAction
} from "./web/handlers.js";
