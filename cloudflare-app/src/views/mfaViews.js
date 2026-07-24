import { escapeHtml } from "../ui/html/escape.js";
import { alertDanger, alertWarning, page } from "./layout.js";

export function mfaLoginPage({ error = "" } = {}) {
  return page("2단계 인증", `
    <section class="login-shell">
      <div class="login-side">
        <img class="login-logo" src="/images/hanlim-pharm-logo.svg" alt="한림제약">
        <h1>한림문서고</h1>
        <p>인증 앱의 6자리 코드 또는 복구 코드를 입력하세요.</p>
      </div>
      <div class="login-panel">
        <h2>2단계 인증</h2>
        ${error ? alertDanger(error) : ""}
        <form method="post" action="/login/mfa" class="stack">
          <label>인증 코드<input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="20"></label>
          <button type="submit" class="primary">확인</button>
        </form>
        <p class="muted form-foot"><a href="/login">로그인으로 돌아가기</a></p>
      </div>
    </section>
  `, null);
}

export function mfaSettingsPage({
  session,
  status,
  enrollment = null,
  recoveryCodes = [],
  error = "",
  success = ""
}) {
  const enabled = Boolean(status?.enabled);
  return page("2단계 인증", `
    <section class="panel narrow stack">
      <div>
        <h1>2단계 인증</h1>
        <p class="muted">인증 앱의 시간 기반 일회용 코드로 계정을 추가 보호합니다.</p>
      </div>
      ${error ? alertDanger(error) : ""}
      ${success ? `<div class="alert success" role="status">${escapeHtml(success)}</div>` : ""}
      ${recoveryCodes.length ? recoveryCodePanel(recoveryCodes) : ""}
      ${enrollment ? enrollmentPanel(enrollment) : enabled ? disablePanel(status) : beginPanel()}
    </section>
  `, session);
}

function beginPanel() {
  return `
    <div class="alert warning" role="status">2단계 인증이 아직 활성화되지 않았습니다.</div>
    <form method="post" action="/account/mfa/enroll" class="stack">
      <label>현재 비밀번호<input name="currentPassword" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="primary">인증 앱 연결 시작</button>
    </form>
  `;
}

function enrollmentPanel(enrollment) {
  return `
    ${alertWarning("이 설정 정보는 10분 동안만 유효합니다. 외부 QR 생성 서비스에 입력하지 마세요.")}
    <div class="stack">
      <label>수동 설정 키<input readonly value="${escapeHtml(enrollment.secret)}"></label>
      <details><summary>otpauth URI 보기</summary><code class="code-block">${escapeHtml(enrollment.otpauthUri)}</code></details>
    </div>
    <form method="post" action="/account/mfa/confirm" class="stack">
      <label>현재 비밀번호<input name="currentPassword" type="password" autocomplete="current-password" required></label>
      <label>인증 앱의 6자리 코드<input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="6"></label>
      <button type="submit" class="primary">2단계 인증 활성화</button>
    </form>
  `;
}

function disablePanel(status) {
  return `
    <div class="alert success" role="status">2단계 인증이 활성화되어 있습니다.${status.enabledAt ? ` (${escapeHtml(status.enabledAt)})` : ""}</div>
    <form method="post" action="/account/mfa/disable" class="stack">
      <label>현재 비밀번호<input name="currentPassword" type="password" autocomplete="current-password" required></label>
      <label>인증 코드 또는 복구 코드<input name="code" autocomplete="one-time-code" required maxlength="20"></label>
      <button type="submit" class="danger">2단계 인증 비활성화</button>
    </form>
  `;
}

function recoveryCodePanel(codes) {
  return `
    ${alertWarning("복구 코드는 다시 표시되지 않습니다. 안전한 장소에 별도로 보관하세요.")}
    <ul class="code-list">${codes.map((code) => `<li><code>${escapeHtml(code)}</code></li>`).join("")}</ul>
  `;
}
