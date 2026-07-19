// 기존 파일을 자동 포맷하지 않고, 수정 파일에 안전하게 적용할 최소 형식만 검사한다.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["src", "scripts", "tests"];
const ROOT_FILES = ["eslint.config.js", "jsconfig.check.json", "package.json"];
const EXTENSIONS = new Set([".js", ".mjs", ".json"]);
const violations = [];

for (const file of [...await collectTargets(), ...ROOT_FILES]) {
  const source = await readFile(file, "utf8");
  if (!source.endsWith("\n")) violations.push(`${file}: 파일 끝 개행이 없습니다.`);
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (/[ \t]+$/.test(line)) violations.push(`${slash(file)}:${index + 1}: 줄 끝 공백`);
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("✓ 최소 형식 검사 통과");

async function collectTargets() {
  const files = [];
  for (const root of ROOTS) files.push(...await walk(root));
  return files.sort();
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) files.push(file);
  }
  return files;
}

function slash(value) {
  return value.replaceAll(path.sep, "/");
}
