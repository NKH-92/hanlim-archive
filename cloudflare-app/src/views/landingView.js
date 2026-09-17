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
  return page("로그인", `<div class="landing-page">${body}</div>`, null, 200, { mainClass: "landing-main" });
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

    <section class="landing-hero" id="top">
      <div class="landing-container landing-hero-grid">
        <div class="landing-hero-copy">
          <p class="landing-kicker">문서를 찾는 일, 더 간결하게</p>
          <h1>찾는 문서부터,<br><span>보관 위치까지.</span></h1>
          <p class="landing-lead">문서번호와 이름으로 찾고,<br>어느 랙, 몇 번째 선반인지 바로 확인하세요.</p>
          <div class="landing-hero-actions">
            <a class="button landing-primary-cta" href="#login">문서고 로그인 <span aria-hidden="true">→</span></a>
            <a class="button secondary landing-secondary-cta" href="#search">기능 살펴보기</a>
          </div>
          <p class="landing-account-note">승인된 사내 계정으로 이용할 수 있습니다.</p>
        </div>

        <div class="landing-hero-stage">
          <img class="landing-hero-rack" src="/images/landing/archive-rack.png" width="1672" height="941" alt="" fetchpriority="high" decoding="async">
          <div class="landing-product-window landing-hero-preview" role="img" aria-label="정적인 검색 화면 예시. 제품표준서 QA-SP-001 개정 04의 위치는 1구역 13-2면, 4열 3선반입니다.">
          <div class="landing-window-bar">
            <span class="landing-window-brand"><i class="fa-solid fa-box-archive" aria-hidden="true"></i> 한림문서고</span>
            <span class="landing-window-user">화면 예시</span>
          </div>
          <div class="landing-window-body">
            <div class="landing-demo-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>문서명, 문서번호로 검색</span></div>
            <div class="landing-demo-list-title"><strong>보관중인 문서</strong><span>보관 위치</span></div>
            <div class="landing-demo-table">
              <div class="landing-demo-row is-selected"><span><strong>제품표준서</strong><small class="mono">QA-SP-001 · Rev.04</small></span><span class="landing-demo-location"><b>1구역 · 13-2면</b><small>4열 · 3선반</small></span></div>
              <div class="landing-demo-row"><span><strong>밸리데이션 계획서</strong><small class="mono">QA-VP-014 · Rev.02</small></span><span class="landing-demo-location"><b>2구역 · 07-1면</b><small>2열 · 5선반</small></span></div>
              <div class="landing-demo-row"><span><strong>제조위생관리 기준서</strong><small class="mono">QA-SOP-021 · Rev.07</small></span><span class="landing-demo-location"><b>1구역 · 04-1면</b><small>6열 · 2선반</small></span></div>
            </div>
            <div class="landing-window-foot"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>검색한 문서의 위치까지 한눈에.</span></div>
          </div>
          </div>
        </div>
      </div>
    </section>
    <div class="landing-container">
      <dl class="landing-hero-facts" aria-label="핵심 기능">
        <div><dt>쉽게 찾고</dt><dd>문서명·번호·키워드 검색</dd></div>
        <div><dt>정확히 확인하고</dt><dd>구역부터 선반까지 위치 확인</dd></div>
        <div><dt>기록으로 이어갑니다</dt><dd>개정·이동·폐기 이력 조회</dd></div>
      </dl>
    </div>`;
}

function landingSearchSection() {
  return `
    <section class="landing-section landing-section-soft" id="search">
      <div class="landing-container landing-split">
        <div class="landing-copy-block">
          <h2>이름의 일부만 알아도,<br>필요한 문서를 찾도록.</h2>
          <p>기억나는 단어로 검색해 보세요.<br>대분류와 태그, 보관 구역을 더하면 원하는 문서에 가까워집니다.</p>
          <ul class="landing-check-list">
            <li><i class="fa-solid fa-list-check" aria-hidden="true"></i><span><strong>현재 보관중인 문서부터</strong>폐기 문서는 별도 화면에서 확인합니다.</span></li>
            <li><i class="fa-solid fa-list-check" aria-hidden="true"></i><span><strong>조건을 더해 정확하게</strong>분류·태그·구역으로 결과를 좁힙니다.</span></li>
          </ul>
        </div>
        <div class="landing-feature-visual landing-search-visual" role="img" aria-label="정적인 검색 예시. 세척 밸리데이션을 검색하고 분류와 1구역 필터로 세 문서를 좁힌 모습입니다.">
          <div class="landing-visual-label"><span>문서 검색</span><small>화면 예시</small></div>
          <div class="landing-search-query"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><strong>세척 밸리데이션</strong></div>
          <div class="landing-filter-line"><b>대분류 · 밸리데이션</b><b>1구역</b><b>최신순</b></div>
          <div class="landing-result-list">
            <div class="landing-result-item is-selected"><span><strong><mark>세척 밸리데이션</mark> 계획서</strong><small class="mono">QA-CV-001 · Rev.03</small></span><b class="mono">1구역 · 08-1</b></div>
            <div class="landing-result-item"><span><strong><mark>세척 밸리데이션</mark> 보고서</strong><small class="mono">QA-CV-002 · Rev.02</small></span><b class="mono">1구역 · 08-1</b></div>
            <div class="landing-result-item"><span><strong><mark>세척 밸리데이션</mark> 연간 검토</strong><small class="mono">QA-CV-017 · Rev.00</small></span><b class="mono">1구역 · 08-2</b></div>
          </div>
        </div>
      </div>
    </section>`;
}

function landingLocationSection() {
  return `
    <section class="landing-section" id="location">
      <div class="landing-container landing-split landing-split-reverse">
        <div class="landing-feature-visual landing-location-visual" role="img" aria-label="1구역 13-2면의 4열 3선반을 강조한 보관 위치 예시">
          <div class="landing-visual-label"><span>보관 위치</span><small>화면 예시</small></div>
          <div class="landing-location-head"><span><small>제품표준서 · QA-SP-001</small><strong>1구역 · 13-2면</strong></span><b>4열 · 3선반</b></div>
          ${landingRackExample()}
          <div class="landing-rack-axis"><span>면을 바라본 모습</span><span>왼쪽 1열 · 아래 1선반</span></div>
        </div>
        <div class="landing-copy-block">
          <h2>찾았다면,<br>이제 꺼낼 위치까지.</h2>
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
    <section class="landing-section landing-section-soft" id="workflow">
      <div class="landing-container">
        <div class="landing-section-heading">
          <h2>문서는 바뀌어도,<br>그 과정은 남도록.</h2>
          <p>등록부터 개정, 이동, 폐기까지.<br>현재 상태와 함께 문서가 지나온 이력을 확인합니다.</p>
        </div>
        <ol class="landing-workflow" aria-label="문서 생애주기">
          <li><span>01</span><strong>등록</strong><p>문서 식별정보와 보관 위치를 함께 등록합니다.</p></li>
          <li><span>02</span><strong>개정</strong><p>새 개정을 만들고 이전본과 현재본을 연결합니다.</p></li>
          <li><span>03</span><strong>이동</strong><p>보관 위치가 바뀌면 변경 전·후 위치와 사유를 남깁니다.</p></li>
          <li><span>04</span><strong>폐기</strong><p>폐기 후에도 문서의 상태와 처리 기록을 조회할 수 있습니다.</p></li>
        </ol>
      </div>
    </section>`;
}

function landingControlSection() {
  return `
    <section class="landing-section" id="control">
      <div class="landing-container">
        <div class="landing-section-heading">
          <h2>일상의 편리함 아래,<br>분명한 운영 원칙.</h2>
          <p>필요한 권한으로 일하고, 변경은 기록으로 남깁니다.</p>
        </div>
        <div class="landing-control-grid">
          <article><span class="landing-control-icon"><i class="fa-solid fa-user" aria-hidden="true"></i></span><h3>역할에 맞는 권한</h3><p>조회·등록·이동·폐기를 맡은 업무와 권한에 따라 이용합니다.</p></article>
          <article><span class="landing-control-icon"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></span><h3>변경 과정의 기록</h3><p>문서와 위치의 변경, 주요 관리 작업의 이력을 확인합니다.</p></article>
          <article><span class="landing-control-icon"><i class="fa-solid fa-lock" aria-hidden="true"></i></span><h3>계정 접근 보호</h3><p>반복 로그인 실패를 제한하고 사용중지된 계정의 접근을 막습니다.</p></article>
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
    <section class="landing-login-section" id="login">
      <div class="landing-container landing-login-grid">
        <div class="landing-login-copy">
          <h2>찾는 일은 간결하게.<br>관리하는 일은 정확하게.</h2>
          <p>한림문서고에서 오늘의 업무를 시작하세요.<br>사내 계정으로 로그인하면 이용할 수 있습니다.</p>
          <div class="landing-login-signature"><span>한림제약</span><span>QA 문서고 관리 시스템</span></div>
        </div>
        <div class="login-panel landing-login-card">
          <img class="login-logo" src="/images/hanlim-pharm-logo.svg" alt="한림제약">
          <div class="landing-login-title"><h2>문서고 로그인</h2><p>등록된 사내 이메일 계정으로 접속하세요.</p></div>
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
