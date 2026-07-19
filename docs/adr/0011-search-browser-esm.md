# ADR 0011: 검색 Browser ESM Bundle

- 상태: 승인
- 날짜: 2026-07-19

## 결정

`src/searchCore.js`를 서버와 브라우저 검색 로직의 단일 출처로 유지한다. `build:browser`는 이 ESM 모듈을 `public/assets/search-core.js`로 그대로 복사하고, `check:browser`가 바이트 일치를 검증한다. 검색 화면은 nonce가 주입된 외부 `type="module"` script로 asset을 로드한다.

런타임 `createSearchCore.toString()` 직렬화와 esbuild `__name` shim은 제거한다. 검색 repository, application service, presenter 공개 경계는 `domains/search`에 둔다.

## 결과

- Phase 0 golden 점수·이유·정렬과 서버/브라우저 row markup parity를 유지한다.
- exact code, 초성, 한/영 자판 오타, dominant answer 임계값이 동일하다.
- 내부 storage code는 서버·브라우저 검색 index 어디에도 포함되지 않는다.
- CSP nonce, route, permission, schema, migration은 변하지 않는다.
