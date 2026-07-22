// 로그인·가입 요청·오류 페이지.

import { escapeHtml } from "../ui/html/escape.js";
import { alertDanger, alertWarning, page } from "./layout.js";

export function loginPage({ returnUrl, error, setupWarning, signupSubmitted, support = { department: "", name: "", email: "" } }) {
  const supportName = [support.department, support.name].filter(Boolean).join(" / ");
  const supportAction = support.email
    ? `<a href="mailto:${escapeHtml(support.email)}">${escapeHtml(support.email)}</a>`
    : "소속 부서의 문서고 운영 관리자";
  return page("로그인", `
    <section class="login-shell">
      <div class="login-side">
        <img class="login-logo" src="/images/hanlim-pharm-logo.svg" alt="한림제약">
        <h1>한림문서고</h1>
        <p>문서 정보와 실제 보관 위치를 한 번에 찾는 전용 검색 시스템입니다.</p>
      </div>
      <div class="login-panel">
        <h2>로그인</h2>
        ${setupWarning ? alertWarning(setupWarning) : ""}
        ${error ? alertDanger(error === "locked"
          ? "로그인 실패가 반복되어 이 접속의 로그인이 잠시 제한되었습니다. 10분 후 다시 시도하세요."
          : "아이디 또는 비밀번호가 올바르지 않습니다.") : ""}
        ${signupSubmitted ? `<div class="alert success" role="alert">가입 요청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.</div>` : ""}
        <form method="post" action="/login" class="stack">
          <input type="hidden" name="returnUrl" value="${escapeHtml(returnUrl)}">
          <label>이메일<input name="username" type="email" autocomplete="username" required></label>
          <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit" class="primary">로그인</button>
        </form>
        <div class="login-help">
          <strong>로그인에 문제가 있나요?</strong>
          <p>비밀번호 분실·계정 잠금·사용중지 상태는 ${supportAction}${supportName ? ` (${escapeHtml(supportName)})` : ""}에게 계정 이메일과 발생 시각을 알려주세요.</p>
          <p class="muted">등록된 사내 이메일 계정만 로그인할 수 있습니다. 신규 계정은 운영 관리자가 생성·승인합니다.</p>
        </div>
      </div>
    </section>
  `, null);
}

export function signupPage({ values = { username: "", displayName: "" }, error = "" }) {
  return page("가입 요청", `
    <section class="login-shell">
      <div class="login-side">
        <img class="login-logo" src="/images/hanlim-pharm-logo.svg" alt="한림제약">
        <h1>한림문서고</h1>
        <p>관리자 승인 후 문서 검색과 위치 조회를 이용할 수 있습니다.</p>
      </div>
      <div class="login-panel">
        <h2>가입 요청</h2>
        ${error ? alertDanger(error) : ""}
        <form method="post" action="/signup" class="stack">
          <label>아이디<input name="username" value="${escapeHtml(values.username || "")}" autocomplete="username" required></label>
          <label>이름<input name="displayName" value="${escapeHtml(values.displayName || "")}" required></label>
          <label>비밀번호<input name="password" type="password" autocomplete="new-password" required></label>
          <button type="submit" class="primary">가입 요청</button>
        </form>
        <p class="muted form-foot"><a href="/login">로그인으로 돌아가기</a></p>
      </div>
    </section>
  `, null);
}

export function accessDeniedPage(session) {
  return errorPage("접근 권한이 없습니다.", session, 403);
}

export function notFoundPage(session) {
  return errorPage("요청한 페이지를 찾을 수 없습니다.", session, 404);
}

export function errorPage(message, session, status = 500) {
  return page("오류", `<section class="panel narrow">${alertDanger(message)}<a class="button secondary" href="/app">검색 화면으로 이동</a></section>`, session, status);
}
