import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";

import { loginPage } from "../src/views/landingView.js";
import { page } from "../src/views/layout.js";

test("랜딩은 영상과 겹치는 예시 섹션 없이 히어로 → 쇼릴 → 로그인 순서로 이어진다", async () => {
  const html = await loginPage({ returnUrl: "/app" }).text();
  for (const removed of ['id="search"', 'id="location"', 'id="workflow"', 'id="control"', "landing-nav", "landing-rack-diagram", "landing-account-note"]) {
    assert.ok(!html.includes(removed), `${removed}는 영상과 중복되어 두지 않는다`);
  }
  const order = ['id="top"', 'id="showreel"', 'class="landing-login-section"', 'class="landing-footer"'].map((marker) => html.indexOf(marker));
  assert.deepEqual([...order].sort((left, right) => left - right), order);
  assert.ok(order.every((index) => index > 0));

  // 헤더는 로고와 로그인 하나만 둔다.
  const header = html.slice(html.indexOf('<header class="landing-header">'), html.indexOf("</header>"));
  assert.deepEqual([...header.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]), ["#top", "#login"]);

  const hero = html.slice(html.indexOf('id="top"'), html.indexOf('id="showreel"'));
  assert.match(hero, /<source[^>]+media="\(max-width: 900px\)"[^>]+archive-hero-mobile-v2\.webp/);
  assert.match(hero, /<img[^>]+archive-hero-desktop-v2\.webp[^>]+fetchpriority="high"/);
});

test("랜딩 쇼릴은 누를 때만 재생하고 챕터 문장으로 영상 내용을 글로 전한다", async () => {
  const html = await loginPage({ returnUrl: "/app" }).text();
  const reel = html.slice(html.indexOf('id="showreel"'), html.indexOf('class="landing-login-section"'));
  const video = reel.match(/<video[^>]*>/)?.[0] || "";
  assert.match(video, /\scontrols\s/);
  assert.match(video, /preload="none"/);
  assert.match(video, /poster="\/images\/landing\/archive-showreel-poster-v1\.webp"/);
  assert.match(video, /aria-describedby="landing-reel-summary"/);
  // 자동 재생·반복·무음 시작을 쓰지 않고, iPhone에서는 전체 화면으로 재생되도록 playsinline도 두지 않는다.
  assert.doesNotMatch(video, /\s(?:autoplay|loop|muted|playsinline)\b/);
  assert.match(reel, /<source src="\/media\/landing\/archive-showreel-v1\.mp4" type="video\/mp4">/);
  assert.match(reel, /<button type="button" class="landing-reel-play" data-reel-play hidden>/);
  assert.match(reel, /<div class="landing-reel-end" data-reel-end hidden>[\s\S]*href="#login"[\s\S]*data-reel-replay/);
  assert.match(reel, /<p class="sr-only" id="landing-reel-summary">[^<]*1구역 13-2면 4열 3선반/);

  const chapters = [...reel.matchAll(/data-reel-from="([\d.]+)" data-reel-to="([\d.]+)"[\s\S]*?<b>(\d+)<\/b> ([^·<]+?) ·[\s\S]*?<strong class="landing-reel-chapter-line">([^<]+)<\/strong>/g)]
    .map((match) => match.slice(1));
  assert.deepEqual(chapters, [
    ["2.5", "5", "01", "문서 검색", "기억나는 이름으로 찾아요"],
    ["5", "12.1", "02", "보관 위치", "선반 위치까지 바로 보여요"],
    ["12.1", "15.2", "03", "변경 이력", "옮기고 고쳐도 기록이 이어져요"],
    ["15.2", "17.5", "04", "운영 원칙", "권한만큼 쓰고, 바뀐 건 남겨요"]
  ]);
  assert.match(html, /<a class="button secondary landing-secondary-cta" href="#showreel" data-reel-start>/);
});

test("쇼릴 영상과 포스터는 웹 전송 예산 안에 있다", () => {
  const video = statSync(new URL("../public/media/landing/archive-showreel-v1.mp4", import.meta.url));
  const poster = statSync(new URL("../public/images/landing/archive-showreel-poster-v1.webp", import.meta.url));
  assert.ok(video.size <= 6 * 1024 * 1024, `영상 ${video.size} bytes`);
  assert.ok(poster.size <= 150 * 1024, `포스터 ${poster.size} bytes`);
});

test("로그인 영역은 공식 원본 안내와 승인 계정 안내를 한 번씩만 둔다", async () => {
  const html = await loginPage({ returnUrl: "/app" }).text();
  const login = html.slice(html.indexOf('class="landing-login-section"'), html.indexOf('class="landing-footer"'));
  assert.equal(html.match(/공식 원본은 승인·서명된 문서대장이에요/g)?.length, 1);
  assert.match(login, /<p class="landing-source-note"><strong>공식 원본은 승인·서명된 문서대장이에요\.<\/strong>/);
  assert.equal(html.match(/승인된 사내/g)?.length, 1);
  assert.match(login, /<p>승인된 사내 계정으로 로그인해 주세요\.<\/p>/);
});

test("랜딩과 로그인 문구는 해요체로 쓰고 오류는 다음 행동을 알려준다", async () => {
  const cases = [
    ["", null],
    ["1", "이메일이나 비밀번호를 다시 확인해 주세요."],
    ["locked", "로그인을 여러 번 실패해서 잠시 멈췄어요. 10분 뒤에 다시 시도해 주세요."]
  ];
  for (const [error, message] of cases) {
    const html = await loginPage({ returnUrl: "/app", error }).text();
    assert.doesNotMatch(html, /니다/, `error=${error || "없음"} 화면에 합쇼체 문장이 남아 있다`);
    if (message) assert.ok(html.includes(message), message);
  }
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
