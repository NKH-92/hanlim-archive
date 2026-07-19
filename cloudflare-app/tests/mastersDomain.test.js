import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as masters from "../src/domains/masters/index.js";
import { validateMasterValues } from "../src/domains/masters/domain/policy.js";
import { parseCategoryForm, parseTagForm } from "../src/domains/masters/web/forms.js";

test("masters form parser와 validation은 HTTP 입력을 정규화하고 기존 메시지를 유지한다", () => {
  const category = parseCategoryForm(form({ name: "  품질  ", description: " 설명 ", sortOrder: "4", isActive: "1" }), 3);
  assert.deepEqual(category, { id: 3, name: "품질", description: "설명", sortOrder: 4, isActive: true });
  assert.deepEqual(parseTagForm(form({ name: " 태그 " }), 0), { id: 0, name: "태그", description: "", isActive: true });
  assert.deepEqual(validateMasterValues("category", { name: "" }), {
    ok: false,
    message: "카테고리 이름은 필수입니다.",
    values: { id: 0, name: "", description: "", isActive: true, sortOrder: 0 }
  });
});

test("masters 공개 API는 query·command·view를 한 경계에서 제공한다", () => {
  for (const name of ["getCategories", "getActiveCategories", "getTags", "getActiveTags", "upsertCategory", "deleteCategory", "upsertTag", "deleteTag"]) {
    assert.equal(typeof masters[name], "function", name);
  }
  assert.equal(typeof masters.categoriesPage, "function");
  assert.equal(typeof masters.tagsPage, "function");
});

test("masters의 SQL은 infrastructure에만 존재한다", async () => {
  const nonInfrastructure = [
    "../src/domains/masters/domain/policy.js",
    "../src/domains/masters/application/service.js",
    "../src/domains/masters/web/forms.js",
    "../src/domains/masters/web/handlers.js",
    "../src/domains/masters/web/views.js",
    "../src/domains/masters/service.js",
    "../src/domains/masters/index.js"
  ];
  for (const relative of nonInfrastructure) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|[a-z_])/i, relative);
  }
});

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
