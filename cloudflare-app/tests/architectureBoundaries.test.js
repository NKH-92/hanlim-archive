import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));
test("목표 modular-monolith 계층은 역방향·도메인 내부 결합을 만들지 않는다", async () => {
  const violations = [];
  for (const file of await javascriptFiles(SOURCE_ROOT)) {
    const source = await readFile(file, "utf8");
    const importer = slash(path.relative(SOURCE_ROOT, file));
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const target = slash(path.relative(SOURCE_ROOT, path.resolve(path.dirname(file), specifier)));
      const reason = targetArchitectureViolation(importer, target);
      if (reason) violations.push(`${importer} -> ${specifier}: ${reason}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("snapshot repository는 조립점만 남기고 DB 작업을 책임 파일에 둔다", async () => {
  const source = await readFile(path.join(SOURCE_ROOT, "domains/snapshots/infrastructure/repository.js"), "utf8");
  assert.doesNotMatch(source, /\benv\.DB\b|executeMutationBatch|createBatchPlan/);
  for (const name of ["queries", "lifecycle", "staging", "prepare", "apply", "export"]) {
    const moduleSource = await readFile(path.join(SOURCE_ROOT, `domains/snapshots/infrastructure/${name}.js`), "utf8");
    assert.ok(moduleSource.length > 0, name);
  }
});

test("production source는 retired compatibility 경로를 import하지 않는다", async () => {
  const violations = [];
  for (const file of await javascriptFiles(SOURCE_ROOT)) {
    const importer = slash(path.relative(SOURCE_ROOT, file));
    const source = await readFile(file, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const target = slash(path.relative(SOURCE_ROOT, path.resolve(path.dirname(file), specifier)));
      if (retiredCompatibilityTarget(target)) violations.push(`${importer} -> ${target}`);
    }
  }
  assert.deepEqual(violations, []);
});

function retiredCompatibilityTarget(target) {
  if (["db.js", "html.js", "utils.js", "routes.js", "documentRules.js"].includes(target)) return true;
  if (["handlers/documentHandlers.js", "app/requestContext.js"].includes(target)) return true;
  if ([
    "domains/documents/application/commandService.js",
    "domains/documents/application/queries.js",
    "domains/documents/application/validation.js",
    "domains/documents/infrastructure/referenceValidation.js",
    "domains/sets/application/service.js"
  ].includes(target)) return true;
  if (target.startsWith("shared/contracts/")) return true;
  return target.startsWith("data/");
}

function targetArchitectureViolation(importer, target) {
  if (importer.startsWith("platform/") && target.startsWith("domains/")) {
    return "platform은 업무 domain을 import할 수 없음";
  }

  const importerDomain = importer.match(/^domains\/([^/]+)\/(domain|application|infrastructure|web)\//);
  const targetDomain = target.match(/^domains\/([^/]+)\/(domain|application|infrastructure|web)\//);
  if (!importerDomain) return "";

  if (targetDomain && importerDomain[1] !== targetDomain[1] && !/\/(index|readModels\/[^/]+)\.js$/.test(target)) {
    return "다른 domain의 내부 파일 직접 import 금지";
  }

  const fromLayer = importerDomain[2];
  const toLayer = targetDomain?.[2] || "";
  if (fromLayer === "domain" && new Set(["application", "infrastructure", "web"]).has(toLayer)) {
    return "domain 계층 역방향 import";
  }
  if (fromLayer === "application" && new Set(["infrastructure", "web"]).has(toLayer)) {
    return "application 계층 역방향 import";
  }
  if (fromLayer === "infrastructure" && toLayer === "web") {
    return "infrastructure는 web을 import할 수 없음";
  }
  return "";
}

function moduleSpecifiers(source) {
  const values = [];
  const patterns = [
    /\bimport\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/g
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

async function javascriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(absolute));
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
  }
  return files.sort();
}

function slash(value) {
  return value.replaceAll(path.sep, "/");
}
