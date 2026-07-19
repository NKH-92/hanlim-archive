import { clean } from "../../../shared/text/normalize.js";

export function parseCategoryForm(form, id = 0) {
  return {
    id,
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    sortOrder: Number(form.get("sortOrder") || 0),
    isActive: id ? form.get("isActive") === "1" : true
  };
}

export function parseTagForm(form, id = 0) {
  return {
    id,
    name: clean(form.get("name")),
    description: clean(form.get("description")),
    isActive: id ? form.get("isActive") === "1" : true
  };
}
