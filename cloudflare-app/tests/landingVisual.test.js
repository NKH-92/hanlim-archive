import assert from "node:assert/strict";
import test from "node:test";

import { loginPage } from "../src/views/landingView.js";
import { page } from "../src/views/layout.js";

test("랜딩은 같은 문서와 위치를 연결하고 4열 3선반을 정확히 강조한다", async () => {
  const html = await loginPage({ returnUrl: "/app" }).text();
  const hero = html.split('id="search"')[0];
  const location = html.split('id="location"')[1].split('id="workflow"')[0];
  const rows = [...location.matchAll(/<div class="landing-rack-row">([\s\S]*?)<\/div>/g)];
  assert.equal(rows.length, 6);
  assert.equal(rows.filter((row) => row[1].includes('class="is-hit"')).length, 1);
  assert.match(rows[3][1], /^<small>3선반<\/small>(<span><\/span>){3}<span class="is-hit">문서<\/span>/);
  assert.match(location, /제품표준서[\s\S]*QA-SP-001[\s\S]*1구역 · 13-2면[\s\S]*4열 · 3선반/);
  assert.match(hero, /<source[^>]+media="\(max-width: 900px\)"[^>]+archive-hero-mobile-v2\.webp/);
  assert.match(hero, /<img[^>]+archive-hero-desktop-v2\.webp[^>]+fetchpriority="high"/);
});

test("랜딩 본문 바로가기는 헤더 뒤의 초점 가능한 소개 영역을 가리킨다", async () => {
  const html = await loginPage({ returnUrl: "/app" }).text();
  assert.match(html, /<a href="#top" class="skip-nav">/);
  assert.match(html, /<\/header>[\s\S]*<section class="landing-hero" id="top" tabindex="-1"/);
  assert.match(html, /<div class="login-panel landing-login-card" id="login" tabindex="-1" aria-labelledby="landing-login-title">/);
  assert.match(html, /<form method="post" action="\/login"[\s\S]*name="username" type="email" autocomplete="username" required[\s\S]*name="password" type="password" autocomplete="current-password" required/);
  const standard = await page("기본 화면", "본문", null).text();
  assert.match(standard, /<a href="#main-content" class="skip-nav">/);
});
