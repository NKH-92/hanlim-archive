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
          <span><strong>한림문서고</strong><small>QA DOCUMENT ARCHIVE</small></span>
        </a>
        <nav class="landing-nav" aria-label="시스템 소개">
          <a href="#search">문서 검색</a>
          <a href="#location">보관 위치</a>
          <a href="#workflow">업무 흐름</a>
          <a href="#control">운영·통제</a>
        </nav>
        <a class="button landing-header-login" href="#login">로그인</a>
      </div>
    </header>

    <section class="landing-hero" id="top">
      <div class="landing-container landing-hero-grid">
        <div class="landing-hero-copy">
          <p class="landing-kicker">의약품 제조소 QA를 위한 문서고 관리 시스템</p>
          <h1>문서가 많아질수록,<br>찾기는 더 쉬워져야 합니다.</h1>
          <p class="landing-lead">승인된 문서대장을 기준으로 문서번호와 실제 보관 위치를 연결합니다. 문서를 검색하면 어느 구역, 어느 랙의 몇 번째 선반에 있는지 바로 확인할 수 있습니다.</p>
          <div class="landing-hero-actions">
            <a class="button landing-primary-cta" href="#login">로그인</a>
            <a class="button secondary landing-secondary-cta" href="#search">시스템 살펴보기</a>
          </div>
          <dl class="landing-hero-facts" aria-label="핵심 기능">
            <div><dt>빠른 검색</dt><dd>문서번호·문서명·키워드</dd></div>
            <div><dt>위치 연결</dt><dd>구역·랙·면·열·선반</dd></div>
            <div><dt>이력 관리</dt><dd>개정·이동·폐기 기록</dd></div>
          </dl>
        </div>

        <div class="landing-product-window landing-hero-preview" role="img" aria-label="한림문서고 문서 검색 화면 예시">
          <div class="landing-window-bar">
            <span class="landing-window-brand"><i class="fa-solid fa-box-archive" aria-hidden="true"></i> 한림문서고</span>
            <span class="landing-window-user">QA 사용자</span>
          </div>
          <div class="landing-window-body">
            <div class="landing-demo-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>문서명, 문서번호, 키워드로 검색</span><b>검색</b></div>
            <div class="landing-demo-filters"><span>보관중</span><span>대분류 전체</span><span>위치 전체</span><span>최신순</span></div>
            <div class="landing-demo-table">
              <div class="landing-demo-row landing-demo-head"><span>문서명</span><span>문서번호 · 개정</span><span>보관 위치</span></div>
              <div class="landing-demo-row"><strong>제품표준서</strong><span class="mono">QA-SP-001 · 04</span><span class="mono landing-demo-location">1구역 · 13-2 · 4열 · 3선반</span></div>
              <div class="landing-demo-row"><strong>밸리데이션 계획서</strong><span class="mono">QA-VP-014 · 02</span><span class="mono landing-demo-location">2구역 · 07-1 · 2열 · 5선반</span></div>
              <div class="landing-demo-row"><strong>제조위생관리 기준서</strong><span class="mono">QA-SOP-021 · 07</span><span class="mono landing-demo-location">1구역 · 04-1 · 6열 · 2선반</span></div>
              <div class="landing-demo-row"><strong>공정밸리데이션 보고서</strong><span class="mono">QA-PVR-032 · 01</span><span class="mono landing-demo-location">3구역 · 09-2 · 1열 · 4선반</span></div>
            </div>
            <div class="landing-window-foot"><span>보관중 문서만 표시</span><span>예시 화면</span></div>
          </div>
        </div>
      </div>
    </section>`;
}

function landingSearchSection() {
  return `
    <section class="landing-section landing-section-soft" id="search">
      <div class="landing-container landing-split">
        <div class="landing-copy-block">
          <h2>문서번호를 몰라도<br>찾을 수 있습니다.</h2>
          <p>문서명의 일부만 기억해도 검색할 수 있고, 대분류·태그·보관 구역으로 결과를 좁힐 수 있습니다. 기본 화면은 현재 보관중인 문서에 집중합니다.</p>
          <ul class="landing-check-list">
            <li><i class="fa-solid fa-list-check" aria-hidden="true"></i><span><strong>검색 중심</strong> 문서번호·문서명·키워드 검색</span></li>
            <li><i class="fa-solid fa-list-check" aria-hidden="true"></i><span><strong>보관중 우선</strong> 현재 사용하는 문서를 기본으로 확인</span></li>
            <li><i class="fa-solid fa-list-check" aria-hidden="true"></i><span><strong>조건 필터</strong> 대분류·태그·구역·정렬로 빠르게 좁히기</span></li>
          </ul>
        </div>
        <div class="landing-feature-visual landing-search-visual" role="img" aria-label="검색어와 필터로 문서 결과를 좁히는 화면 예시">
          <div class="landing-visual-label"><span>문서 검색</span><small>검색 결과 3건</small></div>
          <div class="landing-search-query"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><strong>세척 밸리데이션</strong><span>검색</span></div>
          <div class="landing-filter-line"><b>대분류 · 밸리데이션</b><b>1구역</b><b>최신순</b></div>
          <div class="landing-result-list">
            <div class="landing-result-item is-selected"><span><strong>세척 밸리데이션 계획서</strong><small class="mono">QA-CV-001 · Rev.03</small></span><b class="mono">1구역 · 08-1</b></div>
            <div class="landing-result-item"><span><strong>세척 밸리데이션 보고서</strong><small class="mono">QA-CV-002 · Rev.02</small></span><b class="mono">1구역 · 08-1</b></div>
            <div class="landing-result-item"><span><strong>세척 밸리데이션 연간 검토</strong><small class="mono">QA-CV-017 · Rev.00</small></span><b class="mono">1구역 · 08-2</b></div>
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
          <div class="landing-location-head"><span><small>선택 위치</small><strong class="mono">1구역 · 13-2면</strong></span><b class="mono">4열 · 3선반</b></div>
          <div class="landing-rack-guide"><span>1열</span><strong>면을 바라본 모습</strong><span>7열</span></div>
          <div class="landing-rack-grid" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span class="is-hit">4열 · 3</span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
          <div class="landing-rack-axis"><span>아래가 1선반</span><span>현재 위치에 활성 문서가 연결됩니다</span></div>
        </div>
        <div class="landing-copy-block">
          <h2>검색 결과가<br>실제 문서고의 위치로 이어집니다.</h2>
          <p>문서를 찾은 다음 다시 종이 대장을 뒤질 필요가 없도록 보관 위치를 구역·랙·면·열·선반 단위로 연결합니다. 문서 상세에서 위치를 확인하고 실제 랙까지 같은 기준으로 찾아갈 수 있습니다.</p>
          <div class="landing-inline-note"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>모든 랙은 <strong>면을 바라본 기준으로 왼쪽부터 1열, 아래부터 1선반</strong>으로 표시합니다.</span></div>
        </div>
      </div>
    </section>`;
}

function landingWorkflowSection() {
  return `
    <section class="landing-section landing-section-soft" id="workflow">
      <div class="landing-container">
        <div class="landing-section-heading">
          <h2>문서가 바뀌어도,<br>이전 기록은 남습니다.</h2>
          <p>등록, 개정, 위치 이동, 폐기처럼 문서고에서 실제로 일어나는 변화를 각각 기록합니다. 현재본만 보는 것이 아니라 어떤 과정을 거쳐 지금 상태가 되었는지 확인할 수 있습니다.</p>
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
          <h2>문서고 운영 기록은<br>문서 자체만큼 중요합니다.</h2>
          <p>권한, 변경 이력, 로그인 보호, 복구 기준을 운영 원칙으로 명확하게 보여줍니다.</p>
        </div>
        <div class="landing-control-grid">
          <article><span>01</span><h3>권한</h3><p>조회·등록·이동·폐기·관리 기능을 역할과 업무 권한에 따라 제한합니다.</p></article>
          <article><span>02</span><h3>변경 이력</h3><p>문서 변경, 위치 이동, 주요 관리 작업의 이력을 확인할 수 있습니다.</p></article>
          <article><span>03</span><h3>로그인 보호</h3><p>반복 로그인 실패를 제한하고 계정 상태 변경 시 기존 세션을 폐기합니다.</p></article>
          <article><span>04</span><h3>복구 기준</h3><p>D1 시점 복구와 승인된 Excel 대장을 기준으로 운영 데이터를 복원합니다.</p></article>
        </div>
        <div class="landing-source-principle">
          <strong>공식 원본은 승인·서명된 문서대장입니다.</strong>
          <p>한림문서고는 공식 원본을 대체하지 않습니다. 검색, 위치 확인, 이력 추적을 빠르게 하기 위한 운영 시스템입니다.</p>
        </div>
      </div>
    </section>`;
}

function landingLoginSection({ returnUrl, setupAlert, loginAlert, supportAction, supportContext }) {
  return `
    <section class="landing-login-section" id="login">
      <div class="landing-container landing-login-grid">
        <div class="landing-login-copy">
          <p class="landing-kicker">HANLIM ARCHIVE</p>
          <h2>필요한 문서가 떠오른 순간,<br>바로 찾을 수 있게.</h2>
          <p>사내 계정으로 로그인하면 현재 권한에 맞는 문서 검색과 보관 위치 확인, 운영 업무를 시작할 수 있습니다.</p>
        </div>
        <div class="login-panel landing-login-card">
          <img class="login-logo" src="/images/hanlim-pharm-logo.svg" alt="한림제약">
          <div class="landing-login-title"><h2>로그인</h2><p>등록된 사내 이메일 계정으로 접속하세요.</p></div>
          ${setupAlert}
          ${loginAlert}
          <form method="post" action="/login" class="stack landing-login-form">
            <input type="hidden" name="returnUrl" value="${returnUrl}">
            <label>이메일<input name="username" type="email" autocomplete="username" required></label>
            <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
            <button type="submit" class="primary">로그인</button>
          </form>
          <div class="login-help">
            <strong>로그인에 문제가 있나요?</strong>
            <p>비밀번호 분실·계정 잠금·사용중지 상태는 ${supportAction}${supportContext}에게 계정 이메일과 발생 시각을 알려주세요.</p>
            <p class="muted">등록된 사내 이메일 계정만 로그인할 수 있습니다. 신규 계정은 운영 관리자가 생성·승인합니다.</p>
          </div>
        </div>
      </div>
    </section>`;
}

function landingFooter() {
  return `
    <footer class="landing-footer">
      <div class="landing-container"><span><strong>한림문서고</strong> · HANLIM ARCHIVE</span><span>한림제약 사내 문서고 관리 시스템</span></div>
    </footer>`;
}
