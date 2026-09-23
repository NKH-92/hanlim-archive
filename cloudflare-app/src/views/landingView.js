// 인증 전 랜딩과 로그인 화면. 실제 업무 UI와 구분된 공개 소개 면을 구성한다.

import { escapeHtml } from "../ui/html/escape.js";
import { alertDanger, alertWarning, page } from "./layout.js";

export function loginPage({ returnUrl, error, setupWarning, support = { department: "", name: "", email: "" } }) {
  const supportName = [support.department, support.name].filter(Boolean).join(" / ");
  const supportAction = support.email
    ? `<a href="mailto:${escapeHtml(support.email)}">${escapeHtml(support.email)}</a>`
    : "소속 부서의 문서고 운영 관리자";
  const loginAlert = error ? alertDanger(error === "locked"
    ? "로그인 실패가 반복되어 이 접속의 로그인이 잠시 제한되었습니다. 10분 후 다시 시도하세요."
    : "아이디 또는 비밀번호가 올바르지 않습니다.") : "";
  const setupAlert = setupWarning ? alertWarning(setupWarning) : "";
  const supportContext = supportName ? ` (${escapeHtml(supportName)})` : "";

  const body = [
    landingHeaderAndHero(),
    landingSearchSection(),
    landingLocationSection(),
    landingWorkflowSection(),
    landingControlSection(),
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
        <nav class="landing-nav" aria-label="시스템 소개">
          <a href="#search">문서 검색</a>
          <a href="#location">보관 위치</a>
          <a href="#workflow">업무 흐름</a>
          <a href="#control">운영 원칙</a>
        </nav>
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
          <p class="landing-lead">문서번호와 이름으로 찾고,<br>어느 랙, 몇 번째 선반인지 바로 확인하세요.</p>
          <div class="landing-hero-actions">
            <a class="button landing-primary-cta" href="#login">문서고 로그인 <span aria-hidden="true">→</span></a>
            <a class="button secondary landing-secondary-cta" href="#search">기능 살펴보기</a>
          </div>
          <p class="landing-account-note">승인된 사내 계정으로 이용할 수 있습니다.</p>
        </div>
      </div>
    </section>`;
}

function landingSearchSection() {
  return `
    <section class="landing-section" id="search">
      <div class="landing-container landing-split landing-search-layout">
        <div class="landing-copy-block">
          <h2>기억나는 이름으로,<br>필요한 문서를.</h2>
          <p>문서명이나 번호로 검색하고,<br>분류·태그·구역으로 원하는 문서를 좁혀보세요.</p>

        </div>
        <div class="landing-search-demo">
        <div class="landing-feature-visual landing-search-visual" role="img" aria-label="정적인 검색 예시. 제품표준서를 검색해 선택한 QA-SP-001 개정 04의 위치가 1구역 13-2면, 4열 3선반으로 표시됩니다.">
          <div class="landing-visual-label"><span>문서 검색</span><small>화면 예시</small></div>
          <div class="landing-search-query"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><strong>제품표준서</strong></div>
          <div class="landing-filter-line"><b>보관중</b><b>1구역</b></div>
          <div class="landing-result-list">
            <div class="landing-result-item is-selected"><span><small class="landing-selection-label">선택한 문서</small><strong><mark>제품표준서</mark></strong><small class="mono">QA-SP-001 · Rev.04</small></span><span class="landing-result-location"><b>1구역 · 13-2면</b><small class="landing-slot-label">4열 · 3선반</small></span></div>
            <div class="landing-result-item"><span><strong><mark>제품표준서</mark> 작성 지침</strong><small class="mono">QA-SOP-012 · Rev.02</small></span><span class="landing-result-location"><b>1구역 · 04-1면</b><small>6열 · 2선반</small></span></div>
          </div>
        </div>
        <a class="landing-example-link" href="#location">이 문서의 보관 위치 보기 <span aria-hidden="true">→</span></a>
        </div>
      </div>
    </section>`;
}

function landingLocationSection() {
  return `
    <section class="landing-section landing-section-soft" id="location" tabindex="-1" aria-labelledby="landing-location-title">
      <div class="landing-container landing-split landing-split-reverse">
        <div class="landing-feature-visual landing-location-visual" role="img" aria-label="1구역 13-2면의 4열 3선반을 강조한 보관 위치 예시">
          <div class="landing-visual-label"><span>보관 위치</span><small>화면 예시</small></div>
          <div class="landing-location-head"><span><small>제품표준서 · QA-SP-001 · Rev.04</small><strong>1구역 · 13-2면</strong></span><b>4열 · 3선반</b></div>
          ${landingRackExample()}
          <div class="landing-rack-axis"><span>면을 바라본 모습</span><span>왼쪽 1열 · 아래 1선반</span></div>
        </div>
        <div class="landing-copy-block">
          <h2 id="landing-location-title">찾았다면,<br>이제 꺼낼 위치까지.</h2>
          <p>구역과 랙, 면과 열, 선반까지.<br>문서 상세의 위치 표시를 따라 실제 문서가 있는 곳으로 이동하세요.</p>
          <div class="landing-inline-note"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span><strong>현장에서도 같은 기준으로</strong>모든 랙은 왼쪽부터 1열, 아래부터 1선반입니다.</span></div>
        </div>
      </div>
    </section>`;
}

function landingRackExample() {
  // 선반 번호는 바닥에서 올라간다. 화면의 네 번째 행이 3선반이다.
  const columns = Array.from({ length: 7 }, (_, index) => `<span>${index + 1}열</span>`).join("");
  const rows = Array.from({ length: 6 }, (_, index) => {
    const shelf = 6 - index;
    const cells = Array.from({ length: 7 }, (_, column) => shelf === 3 && column === 3
      ? `<span class="is-hit">문서</span>`
      : `<span></span>`).join("");
    return `<div class="landing-rack-row"><small>${shelf}선반</small>${cells}</div>`;
  }).join("");
  return `<div class="landing-rack-diagram" aria-hidden="true"><div class="landing-rack-columns"><span></span>${columns}</div>${rows}</div>`;
}

function landingWorkflowSection() {
  return `
    <section class="landing-section landing-workflow-section" id="workflow">
      <div class="landing-container landing-workflow-layout">
        <div class="landing-section-heading">
          <h2>문서가 바뀌어도,<br>이력은 이어집니다.</h2>
          <p>등록부터 개정, 이동, 폐기까지.<br>현재 상태와 함께 문서가 지나온 이력을 확인합니다.</p>
        </div>
        <div class="landing-history">
          <div class="landing-history-current">
            <div class="landing-visual-label"><span>현재 보관 정보</span><small>화면 예시</small></div>
            <h3>제품표준서</h3><p class="mono">QA-SP-001</p>
            <dl class="landing-current-facts">
              <div><dt>현재 개정</dt><dd class="mono">Rev.04</dd></div>
              <div><dt>보관 위치</dt><dd>1구역 · 13-2면<br><span>4열 · 3선반</span></dd></div>
              <div><dt>상태</dt><dd>보관중</dd></div>
            </dl>
          </div>
          <div class="landing-history-records">
            <div class="landing-visual-label"><span>변경 기록</span><small>최근 변경부터 · 예시</small></div>
            <ol class="landing-record-list" aria-label="제품표준서 변경 기록 예시">
              <li><span class="landing-record-kind">이동</span><div><p class="landing-record-change"><span><small>이전 위치</small>13-1면</span><span class="landing-record-arrow" aria-label="에서">→</span><span><small>현재 위치</small><strong>13-2면</strong></span></p><p class="landing-record-note">1구역 · 4열 · 3선반 / 사유: 보관 위치 재배치</p></div></li>
              <li><span class="landing-record-kind">개정</span><div><p class="landing-record-change"><span><small>이전본</small><span class="mono">Rev.03</span></span><span class="landing-record-arrow" aria-label="에서">→</span><span><small>현재본</small><strong class="mono">Rev.04</strong></span></p><p class="landing-record-note">사유: 문서 내용 개정</p></div></li>
              <li><span class="landing-record-kind">등록</span><div><p class="landing-record-change"><strong class="mono">Rev.01</strong><span>최초 등록</span></p><p class="landing-record-note">문서번호와 최초 보관 위치 기록</p></div></li>
            </ol>
            <p class="landing-history-retention">폐기 이후에도 처리 기록은 이어집니다.</p>
          </div>
        </div>
      </div>
    </section>`;
}

function landingControlSection() {
  return `
    <section class="landing-section landing-control-section" id="control">
      <div class="landing-container">
        <div class="landing-section-heading">
          <h2>믿고 사용하는 업무의 기준</h2>
          <p>필요한 권한으로 일하고, 변경은 기록으로 남깁니다.</p>
        </div>
        <div class="landing-control-grid">
          <article><h3>역할에 맞는 권한</h3><p>조회·등록·이동·폐기를 맡은 업무와 권한에 따라 이용합니다.</p></article>
          <article><h3>변경 과정의 기록</h3><p>문서와 위치의 변경, 주요 관리 작업의 이력을 확인합니다.</p></article>
          <article><h3>계정 접근 보호</h3><p>반복 로그인 실패를 제한하고 사용중지된 계정의 접근을 막습니다.</p></article>
        </div>
        <div class="landing-source-principle">
          <strong>공식 원본은 승인·서명된 문서대장입니다.</strong>
          <p>한림문서고는 승인된 대장을 기준으로 검색·위치 확인·이력 추적을 돕는 운영 시스템입니다.</p>
        </div>
      </div>
    </section>`;
}

function landingLoginSection({ returnUrl, setupAlert, loginAlert, supportAction, supportContext }) {
  return `
    <section class="landing-login-section" aria-label="문서고 접속">
      <div class="landing-container landing-login-grid">
        <div class="landing-login-copy">
          <h2>문서고에서<br>업무를 이어가세요.</h2>
          <p>승인된 사내 계정으로 이용할 수 있습니다.</p>
          <div class="landing-login-signature"><span>한림제약</span><span>QA 문서고 관리 시스템</span></div>
        </div>
        <div class="login-panel landing-login-card" id="login" tabindex="-1" aria-labelledby="landing-login-title">
          <div class="landing-login-title"><div class="landing-login-brand"><img class="login-logo" src="/images/hanlim-pharm-logo.svg" alt="한림제약"><h2 id="landing-login-title">문서고 로그인</h2></div><p>사내 이메일과 비밀번호를 입력하세요.</p></div>
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
            <p>비밀번호 분실·계정 잠금·사용중지 상태는 ${supportAction}${supportContext}에게 계정 이메일과 발생 시각을 알려주세요.</p>
            <p class="muted">등록된 사내 이메일 계정만 로그인할 수 있습니다. 신규 계정은 운영 관리자가 생성·승인합니다.</p>
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
