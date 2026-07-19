// deprecated compatibility façade: 신규 코드는 domains/masters 공개 API를 사용한다.
export {
  getCategories,
  getActiveCategories,
  getTags,
  getActiveTags,
  upsertCategory,
  deleteCategory,
  upsertTag,
  deleteTag
} from "../domains/masters/index.js";
