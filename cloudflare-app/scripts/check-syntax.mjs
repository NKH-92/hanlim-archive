// src/와 scripts/ 아래 모든 JS 파일을 node --check로 문법 검사한다.
// 파일을 새로 만들 때 package.json의 check 목록을 갱신할 필요가 없도록 디렉터리를 순회한다.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function collect(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collect(path));
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const targets = [...collect("src"), ...collect("scripts")];
let failed = false;

for (const file of targets) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    console.error(`✗ ${file}\n${result.stderr}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log(`✓ ${targets.length}개 파일 문법 검사 통과`);
