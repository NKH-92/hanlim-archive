import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import worker, * as workerModule from "../src/index.js";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_ROOT = path.join(APP_ROOT, "src");

test("Worker 모듈은 default fetch 하나만 공개하고 healthz 응답 계약을 지킨다", async () => {
  assert.deepEqual(Object.keys(workerModule).sort(), ["default"]);
  assert.deepEqual(Object.keys(worker).sort(), ["fetch"]);
  assert.equal(typeof worker.fetch, "function");

  const prepared = [];
  const response = await worker.fetch(new Request("https://archive.example.com/healthz"), {
    DB: {
      prepare(sql) {
        prepared.push(sql);
        return { async first() { return { ok: 1 }; } };
      }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.deepEqual(prepared, ["SELECT 1 AS ok"]);
  assert.equal(await response.text(), '{"ok":true}');
});

test("src는 Workers 표준 API만 사용하고 계층 역방향 import를 만들지 않는다", async () => {
  const sourceFiles = await javascriptFiles(SOURCE_ROOT);
  const nodeBuiltins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
  const violations = [];

  // 이 검사는 배포 소스(src)만 보호한다. tests의 leaf 직접 import는 SQL 순서·직렬화 같은
  // white-box 불변식을 검증할 때 의도적으로 허용한다.
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    const importer = slash(path.relative(SOURCE_ROOT, file));

    for (const specifier of moduleSpecifiers(source)) {
      const bareSpecifier = specifier.replace(/^node:/, "");
      const builtinRoot = bareSpecifier.split("/")[0];
      if (specifier.startsWith("node:") || nodeBuiltins.has(bareSpecifier) || nodeBuiltins.has(builtinRoot)) {
        violations.push(`${importer} -> ${specifier}: src에서 Node API를 사용할 수 없음`);
        continue;
      }

      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      const target = slash(path.relative(SOURCE_ROOT, resolved));
      if (target.startsWith("../")) {
        violations.push(`${importer} -> ${specifier}: src 바깥 상대 import`);
        continue;
      }

      const reason = invalidLayerImport(importer, target);
      if (reason) violations.push(`${importer} -> ${specifier}: ${reason}`);
    }
  }

  assert.deepEqual(violations, []);
});

function invalidLayerImport(importer, target) {
  const isData = target.startsWith("data/");
  const isView = target.startsWith("views/");
  const isHandler = target.startsWith("handlers/");

  if (["db.js", "html.js", "utils.js"].includes(target)) return "제거 대상 전역 호환 façade를 import할 수 없음";
  if (importer === "index.js" && isData) return "index.js는 data leaf 대신 domain·handler를 사용해야 함";
  if (importer.startsWith("views/") && (isData || isHandler || ["db.js", "html.js", "index.js"].includes(target))) {
    return "view에서 상위 계층을 역참조할 수 없음";
  }
  if (importer.startsWith("data/") && (isView || isHandler || ["db.js", "html.js", "index.js"].includes(target))) {
    return "data에서 상위 계층을 역참조할 수 없음";
  }
  return "";
}

function moduleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return [...new Set(specifiers)];
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
