// 로그인·오류 페이지.

import { escapeHtml } from "../ui/html/escape.js";
import { page } from "./layout.js";

export { loginPage } from "./landingView.js";

export function accessDeniedPage(session) {
  return errorPage("필요하면 운영 관리자에게 권한을 요청해 주세요.", session, 403);
}

export function notFoundPage(session) {
  return errorPage("주소를 확인하거나 검색 화면에서 다시 찾아 주세요.", session, 404);
}

// 결과 화면 구성(아이콘 → 제목 → 원인·다음 행동 → 버튼)으로 무슨 일이 있었고 무엇을 하면 되는지 함께 보여 준다.
export function errorPage(message, session, status = 500) {
  const title = status === 403
    ? "권한이 필요해요"
    : status === 404
      ? "페이지를 찾지 못했어요"
      : "요청을 처리하지 못했어요";
  return page("오류", `<section class="panel narrow result-panel" role="alert" aria-live="assertive">
    <span class="result-icon" aria-hidden="true"><i class="fa-solid fa-circle-exclamation"></i></span>
    <h1>${title}</h1>
    <p>${escapeHtml(message)}</p>
    <div class="result-actions"><a class="button" href="/app">검색 화면으로 가기</a></div>
  </section>`, session, status);
}
