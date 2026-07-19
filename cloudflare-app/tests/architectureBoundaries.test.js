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

test("production source는 전역 legacy façade를 import하지 않는다", async () => {
  const legacyImporters = [];
  for (const file of await javascriptFiles(SOURCE_ROOT)) {
    const importer = slash(path.relative(SOURCE_ROOT, file));
    if (["db.js", "html.js", "utils.js"].includes(importer)) continue;
    const source = await readFile(file, "utf8");
    const importsLegacy = moduleSpecifiers(source).some((specifier) => /(?:^|\/)(?:db|html|utils)\.js$/.test(specifier));
    if (importsLegacy) legacyImporters.push(importer);
  }
  assert.deepEqual(legacyImporters, []);
});

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
