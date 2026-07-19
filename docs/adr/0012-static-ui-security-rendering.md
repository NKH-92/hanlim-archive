# ADR 0012: 정적 UI Asset과 구조적 보안 렌더링

- 상태: 승인
- 날짜: 2026-07-19

## 결정

전역 CSS와 JS는 build 단계에서 `public/assets/app.css`, `app.js`로 생성하고 HTML shell은 정적 asset을 참조한다. 요청마다 CSS/JS 전체 문자열을 조립하지 않는다. 화면 구조와 DESIGN token 값은 변경하지 않는다.

`RenderContext`가 요청별 CSP nonce와 CSRF 값을 소유한다. `secureHtmlDocument`는 정규식이 아니라 인용부호를 인식하는 opening-tag tokenizer로 HTML을 읽고, 모든 POST form에 CSRF hidden input을 정확히 하나 추가하며 inline executable script/style에 nonce를 적용한다. shell의 전역 script nonce는 직접 렌더한다. embedded JSON은 `<`, U+2028, U+2029를 안전하게 직렬화한다.

## 결과

- CSP header는 기존 nonce 정책을 유지한다.
- 키보드, print CSS, 접근성 label과 UI golden 동작을 유지한다.
- `check:browser`가 검색 ESM, CSS, JS asset drift를 모두 차단한다.
- route, permission, schema, migration은 변하지 않는다.
