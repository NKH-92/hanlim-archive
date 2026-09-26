// 인증 전 랜딩과 로그인 화면. 실제 업무 UI와 구분된 공개 소개 면을 구성한다.
// 기능 설명은 쇼릴 영상과 챕터 문장이 맡고, 같은 내용을 반복하는 예시 섹션은 두지 않는다.

import { escapeHtml } from "../ui/html/escape.js";
import { alertDanger, alertWarning, page } from "./layout.js";

export function loginPage({ returnUrl, error, setupWarning, support = { department: "", name: "", email: "" } }) {
  const supportName = [support.department, support.name].filter(Boolean).join(" / ");
  const supportAction = support.email
    ? `<a href="mailto:${escapeHtml(support.email)}">${escapeHtml(support.email)}</a>`
    : "소속 부서의 문서고 운영 관리자";
  const loginAlert = error ? alertDanger(error === "locked"
    ? "로그인을 여러 번 실패해서 잠시 멈췄어요. 10분 뒤에 다시 시도해 주세요."
    : "이메일이나 비밀번호를 다시 확인해 주세요.") : "";
  const setupAlert = setupWarning ? alertWarning(setupWarning) : "";
  const supportContext = supportName ? ` (${escapeHtml(supportName)})` : "";

  const body = [
    landingHeaderAndHero(),
    landingShowreelSection(),
    landingLoginSection({ returnUrl: escapeHtml(returnUrl), setupAlert, loginAlert, supportAction, supportContext }),
    landingFooter()
  ].join("");
  return page("로그인", `<div class="landing-page">${body}</div>`, null, 200, { mainClass: "landing-main", skipTarget: "top" });
}

function landingHeaderAndHero() {
  return `
    <header class="landing-header">
      <div class="landing-container landing-header-inner">
        <a class="landing-brand" href="#top" aria-label="한림문서고 처음으로">
          <img class="landing-brand-logo" src="/images/hanlim-pharm-logo.svg" alt="">
          <span><strong>한림문서고</strong><small>한림제약 QA</small></span>
        </a>
        <a class="button landing-header-login" href="#login">로그인</a>
      </div>
    </header>

    <section class="landing-hero" id="top" tabindex="-1" aria-labelledby="landing-title">
      <div class="landing-container landing-hero-grid">
        <div class="landing-hero-heading">
          <p class="landing-kicker">한림제약 · 문서고 관리 시스템</p>
          <h1 id="landing-title">찾는 문서부터,<br><span>보관 위치까지.</span></h1>
        </div>
        <picture class="landing-hero-art">
          <source media="(max-width: 900px)" srcset="/images/landing/archive-hero-mobile-v2.webp" width="1122" height="1402">
          <img class="landing-hero-rack" src="/images/landing/archive-hero-desktop-v2.webp" width="1672" height="941" fetchpriority="high" alt="금속 이동식 랙에 노랑과 청록색 문서 바인더가 정리된 모습">
        </picture>
        <div class="landing-hero-details">
          <p class="landing-lead">문서번호나 이름으로 찾으면<br>어느 랙, 몇 번째 선반인지 바로 알려줘요.</p>
          <div class="landing-hero-actions">
            <a class="button landing-primary-cta" href="#login">문서고 로그인 <span aria-hidden="true">→</span></a>
            <a class="button secondary landing-secondary-cta" href="#showreel" data-reel-start><i class="fa-solid fa-play" aria-hidden="true"></i>20초 영상 보기</a>
          </div>
        </div>
      </div>
    </section>`;
}

// 쇼릴 챕터는 영상 편집 타임라인(초)과 맞춘다. 0–2.5초는 도입, 17.5초부터는 엔드 카드다.
// 챕터 문장은 영상을 재생하지 않는 사람에게 서비스를 설명하는 글이자 영상의 대체 텍스트다.
const SHOWREEL_CHAPTERS = Object.freeze([
  { number: "01", name: "문서 검색", line: "기억나는 이름으로 찾아요", from: 2.5, to: 5 },
  { number: "02", name: "보관 위치", line: "선반 위치까지 바로 보여요", from: 5, to: 12.1 },
  { number: "03", name: "변경 이력", line: "옮기고 고쳐도 기록이 이어져요", from: 12.1, to: 15.2 },
  { number: "04", name: "운영 원칙", line: "권한만큼 쓰고, 바뀐 건 남겨요", from: 15.2, to: 17.5 }
]);

function landingShowreelSection() {
  const chapters = SHOWREEL_CHAPTERS.map(({ number, name, line, from, to }) => `
            <li><button type="button" class="landing-reel-chapter" data-reel-from="${from}" data-reel-to="${to}"><span class="landing-reel-bar" aria-hidden="true"></span><small class="landing-reel-chapter-meta"><b>${number}</b> ${name} · <span class="mono">0:${String(Math.floor(from)).padStart(2, "0")}</span><span class="sr-only">부터 재생</span></small><strong class="landing-reel-chapter-line">${line}</strong></button></li>`).join("");
  // 자동 재생하지 않는다. 포스터만 먼저 보이고 영상은 사용자가 재생할 때 받는다.
  return `
    <section class="landing-reel" id="showreel" tabindex="-1" aria-labelledby="landing-reel-title">
      <div class="landing-reel-inner">
        <div class="landing-reel-head">
          <h2 id="landing-reel-title">20초로 먼저 보기</h2>
          <p>화면 예시 영상 · 소리 있음</p>
        </div>
        <div class="landing-reel-stage" data-landing-reel>
          <div class="landing-reel-frame">
            <video class="landing-reel-video" controls preload="none" poster="/images/landing/archive-showreel-poster-v1.webp" width="1920" height="1080" aria-label="한림문서고 20초 소개 영상" aria-describedby="landing-reel-summary">
              <source src="/media/landing/archive-showreel-v1.mp4" type="video/mp4">
            </video>
            <button type="button" class="landing-reel-play" data-reel-play hidden><span class="landing-reel-play-icon"><i class="fa-solid fa-play" aria-hidden="true"></i></span><span>영상 재생</span><small class="mono">0:20</small></button>
          </div>
          <div class="landing-reel-end" data-reel-end hidden>
            <a class="button landing-primary-cta" href="#login">문서고 로그인 <span aria-hidden="true">→</span></a>
            <button type="button" class="button secondary landing-reel-replay" data-reel-replay><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>다시 보기</button>
          </div>
        </div>
        <p class="sr-only" id="landing-reel-summary">제품표준서를 이름으로 찾고, 1구역 13-2면 4열 3선반의 보관 위치와 개정·이동 이력, 운영 원칙까지 차례로 보여주는 20초 영상이에요. 내레이션 없이 화면 글자와 음악으로 보여주고, 장면마다 요점은 아래 챕터 문장에 있어요.</p>
        <ol class="landing-reel-chapters" aria-label="영상 챕터">${chapters}
        </ol>
      </div>
    </section>`;
}

function landingLoginSection({ returnUrl, setupAlert, loginAlert, supportAction, supportContext }) {
  // 공식 원본 안내는 GMP 기준이라 영상에 없더라도 로그인 옆에 항상 글로 남긴다.
  return `
    <section class="landing-login-section" aria-label="문서고 접속">
      <div class="landing-container landing-login-grid">
        <div class="landing-login-copy">
          <h2>문서고에서<br>업무를 이어가세요.</h2>
          <p class="landing-source-note"><strong>공식 원본은 승인·서명된 문서대장이에요.</strong>한림문서고는 이 대장을 기준으로 문서를 찾고, 위치와 이력을 확인하도록 도와요.</p>
          <div class="landing-login-signature"><span>한림제약</span><span>QA 문서고 관리 시스템</span></div>
        </div>
        <div class="login-panel landing-login-card" id="login" tabindex="-1" aria-labelledby="landing-login-title">
          <div class="landing-login-title"><div class="landing-login-brand"><img class="login-logo" src="/images/hanlim-pharm-logo.svg" alt="한림제약"><h2 id="landing-login-title">문서고 로그인</h2></div><p>승인된 사내 계정으로 로그인해 주세요.</p></div>
          ${setupAlert}
          ${loginAlert}
          <form method="post" action="/login" class="stack landing-login-form">
            <input type="hidden" name="returnUrl" value="${returnUrl}">
            <label>이메일<input name="username" type="email" autocomplete="username" required></label>
            <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
            <button type="submit" class="primary">로그인</button>
          </form>
          <details class="login-help">
            <summary>계정이 없거나 로그인이 안 되나요?</summary>
            <p>비밀번호를 잊었거나, 계정이 잠겼거나 사용중지됐다면 ${supportAction}${supportContext}에게 계정 이메일과 문제가 생긴 시각을 알려 주세요.</p>
            <p class="muted">등록된 사내 이메일로 로그인할 수 있어요. 새 계정은 운영 관리자가 만들어 드려요.</p>
          </details>
        </div>
      </div>
    </section>`;
}

function landingFooter() {
  return `
    <footer class="landing-footer">
      <div class="landing-container"><span><strong>한림문서고</strong> · 한림제약 사내 문서고 관리 시스템</span><a href="#top">처음으로 <span aria-hidden="true">↑</span></a></div>
    </footer>`;
}
