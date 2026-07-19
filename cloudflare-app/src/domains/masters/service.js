import { createMasterService } from "./application/service.js";
import * as repository from "./infrastructure/repository.js";

const service = createMasterService(repository);

export const {
  getCategories,
  getActiveCategories,
  getTags,
  getActiveTags,
  upsertCategory,
  deleteCategory,
  upsertTag,
  deleteTag
} = service;
