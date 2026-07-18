import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { styles } from "../src/views/styles.js";
import { tokenStyles } from "../src/views/styles/tokens.js";

const expectedTokens = {
  "--gray-50": "#f7f9fb",
  "--gray-100": "#eef1f5",
  "--gray-200": "#e1e6ed",
  "--gray-300": "#cbd3dd",
  "--gray-400": "#9aa7b8",
  "--gray-500": "#5a6a7d",
  "--gray-600": "#55647a",
  "--gray-700": "#3d4a5c",
  "--gray-800": "#283445",
  "--gray-900": "#18212f",
  "--bg": "#f3f5f8",
  "--surface": "#ffffff",
  "--ink": "var(--gray-900)",
  "--muted": "var(--gray-500)",
  "--line": "var(--gray-200)",
  "--primary": "#1e55c4",
  "--primary-strong": "#17439f",
  "--primary-soft": "#e9effb",
  "--primary-deep": "#122c63",
  "--success": "#0c7a43",
  "--success-soft": "#e5f4eb",
  "--warning": "#9a5b00",
  "--warning-soft": "#fdf1dd",
  "--danger": "#c22f2f",
  "--danger-soft": "#fbecec",
  "--ring": "rgba(30, 85, 196, .22)",
  "--scrim": "rgba(24, 33, 47, .5)",
  "--shadow-1": "0 4px 16px rgba(24, 33, 47, .08)",
  "--shadow-2": "0 12px 40px rgba(24, 33, 47, .18)",
  "--r-lg": "10px",
  "--r-md": "8px",
  "--r-sm": "6px",
  "--sp-1": "4px",
  "--sp-2": "8px",
  "--sp-3": "12px",
  "--sp-4": "16px",
  "--sp-5": "20px",
  "--sp-6": "24px",
  "--sp-8": "32px",
  "--font-mono": "ui-monospace, \"Cascadia Code\", \"SF Mono\", Consolas, monospace"
};

const approvedRgbaValues = [
  "rgba(24, 33, 47, .08)",
  "rgba(24, 33, 47, .18)",
  "rgba(24, 33, 47, .5)",
  "rgba(30, 85, 196, .05)",
  "rgba(30, 85, 196, .22)",
  "rgba(30, 85, 196, .45)",
  "rgba(255, 255, 255, .12)",
  "rgba(255, 255, 255, .14)",
  "rgba(255, 255, 255, .18)",
  "rgba(255, 255, 255, .4)",
  "rgba(255, 255, 255, .55)",
  "rgba(255, 255, 255, .6)",
  "rgba(255, 255, 255, .82)",
  "rgba(255, 255, 255, .92)"
];

test("전역 CSS 출력은 현재 golden과 바이트 단위로 같다", () => {
  const css = styles();

  assert.equal(css.length, 66731);
  assert.equal(Buffer.byteLength(css), 67051);
  assert.equal(
    createHash("sha256").update(css).digest("hex"),
    "8b6108c62f25d4dc277ad095ee4415089ab761dbfa69d1016363813707fc40a9"
  );
});

test("DESIGN 토큰 값은 전용 조각에 그대로 고정된다", () => {
  const actualTokens = Object.fromEntries(
    [...tokenStyles().matchAll(/^\s+(--[\w-]+):\s*([^;]+);$/gm)]
      .map((match) => [match[1], match[2]])
  );

  assert.deepEqual(actualTokens, expectedTokens);
});

test("원시 hex는 토큰 조각에만 있고 rgba는 승인된 예외만 사용한다", () => {
  const stylesDirectory = new URL("../src/views/styles/", import.meta.url);
  const files = readdirSync(stylesDirectory).filter((name) => name.endsWith(".js"));
  const sources = files.map((name) => [name, readFileSync(new URL(name, stylesDirectory), "utf8")]);

  for (const [name, source] of sources) {
    if (name !== "tokens.js") {
      assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/gi, `${name}에 원시 hex가 있습니다.`);
    }
  }

  const rgbaValues = [...new Set(
    sources.flatMap(([, source]) => source.match(/rgba\([^)]*\)/g) || [])
  )].sort();
  assert.deepEqual(rgbaValues, [...approvedRgbaValues].sort());
});
