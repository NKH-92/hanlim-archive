import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL("../src/searchCore.js", import.meta.url);
const outputUrl = new URL("../public/assets/search-core.js", import.meta.url);
const source = (await readFile(sourceUrl, "utf8")).replaceAll("\r\n", "\n");
const generated = `// generated from src/searchCore.js; do not edit\n${source}`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputUrl, "utf8").catch(() => "");
  if (current.replaceAll("\r\n", "\n") !== generated) {
    console.error("public/assets/search-core.js가 src/searchCore.js와 다릅니다. npm run build:browser를 실행하세요.");
    process.exitCode = 1;
  } else {
    console.log("✓ browser search ESM asset 일치");
  }
} else {
  await mkdir(new URL("../public/assets/", import.meta.url), { recursive: true });
  await writeFile(outputUrl, generated, "utf8");
  console.log("✓ public/assets/search-core.js 생성");
}
