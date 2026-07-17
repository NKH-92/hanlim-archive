import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CSV_IMPORT_LIMITS,
  FREE_TIER_BUDGET,
  getAppConfig,
  MAX_RACKS_PER_ZONE
} from "../src/config.js";

test("getAppConfig uses safe defaults without env overrides", () => {
  const config = getAppConfig({});

  assert.equal(config.csvImport.maxBytes, DEFAULT_CSV_IMPORT_LIMITS.maxBytes);
  assert.equal(config.csvImport.maxRows, DEFAULT_CSV_IMPORT_LIMITS.maxRows);
  assert.equal(config.racks.maxPerZone, MAX_RACKS_PER_ZONE);
  assert.equal(config.csvImport.maxRows, FREE_TIER_BUDGET.csvImportMaxItems);
  assert.equal(FREE_TIER_BUDGET.maxD1StatementsPerRequest, 40);
  assert.equal(FREE_TIER_BUDGET.documentPageSize, 30);
  assert.deepEqual(config.support, { department: "", name: "", email: "" });
});

test("getAppConfig normalizes optional support contact settings", () => {
  const config = getAppConfig({
    SUPPORT_DEPARTMENT: " SQA팀 ",
    SUPPORT_NAME: " 문서 담당자 ",
    SUPPORT_EMAIL: "archive@example.com"
  });

  assert.deepEqual(config.support, {
    department: "SQA팀",
    name: "문서 담당자",
    email: "archive@example.com"
  });
  assert.equal(getAppConfig({ SUPPORT_EMAIL: "not-an-email" }).support.email, "");
});

test("getAppConfig accepts positive integer CSV limits from env", () => {
  const config = getAppConfig({
    CSV_IMPORT_MAX_BYTES: "4096",
    CSV_IMPORT_MAX_ROWS: "10"
  });

  assert.equal(config.csvImport.maxBytes, 4096);
  assert.equal(config.csvImport.maxRows, 10);
});

test("getAppConfig ignores invalid env overrides", () => {
  const config = getAppConfig({
    CSV_IMPORT_MAX_BYTES: "-1",
    CSV_IMPORT_MAX_ROWS: "abc"
  });

  assert.equal(config.csvImport.maxBytes, DEFAULT_CSV_IMPORT_LIMITS.maxBytes);
  assert.equal(config.csvImport.maxRows, DEFAULT_CSV_IMPORT_LIMITS.maxRows);
});
