import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

import { loginPage } from "../src/views/landingView.js";

test("공개 랜딩 히어로는 문서랙 자산과 검색 UI를 함께 렌더링한다", async () => {
  const html = await loginPage({ returnUrl: "/app" }).text();

  assert.match(html, /class="landing-hero-stage"/);
  assert.match(html, /src="\/images\/landing\/archive-rack\.png"/);
  assert.match(html, /class="landing-hero-rack"[^>]+alt=""/);
  assert.match(html, /class="landing-product-window landing-hero-preview"/);
  assert.match(html, /제품표준서[\s\S]*QA-SP-001[\s\S]*1구역 · 13-2면/);
});

test("랜딩 문서랙 자산은 배포 가능한 공개 이미지로 존재한다", async () => {
  const asset = await stat(new URL("../public/images/landing/archive-rack.png", import.meta.url));

  assert.ok(asset.isFile());
  assert.ok(asset.size > 100_000);
});
