import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CSV_IMPORT_LIMITS,
  getAppConfig,
  MAX_RACKS_PER_ZONE
} from "../src/config.js";

test("getAppConfig uses safe defaults without env overrides", () => {
  const config = getAppConfig({});

  assert.equal(config.csvImport.maxBytes, DEFAULT_CSV_IMPORT_LIMITS.maxBytes);
  assert.equal(config.csvImport.maxRows, DEFAULT_CSV_IMPORT_LIMITS.maxRows);
  assert.equal(config.racks.maxPerZone, MAX_RACKS_PER_ZONE);
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
