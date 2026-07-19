# ADR 0002: 공통 계약과 utils 호환 façade

- 상태: 승인
- 일자: 2026-07-19

## Context

기존 `utils.js`가 HTTP, 보안, crypto, CSV, 위치 표기, HTML, 로깅을 함께 소유해
어느 계층에서도 직접 의존하는 전역 잡동사니 모듈이 됐다. 도메인 이동 전에 공통 경계와
D1 batch의 순서·예산·결과 해석을 표현할 계약이 필요하다.

## Decision

- 공통 순수 함수는 `shared/`, Worker adapter는 `platform/`, HTML은 `ui/`, 위치 규칙은
  `domains/racks/domain/`으로 이동한다.
- `utils.js`는 기존 공개 export만 재수출하는 deprecated 호환 façade로 유지한다.
- 기존 importer 목록을 감소만 가능한 기준선으로 고정해 신규 `utils.js` 의존성을 막는다.
- `RequestContext`는 HTTP 경계에서만 사용하고 session과 감사 주체 Actor를 분리한다.
- 예상 가능한 업무 실패는 `{ ok, value|error }` Result 계약과 안정된 error code를 사용한다.
- `D1Gateway`와 `BatchPlan`은 SQL을 숨기지 않고 statement 수, 순서, guard, audit event,
  변경 기대값과 내부 예산을 실행 전에 표현한다.

## Compatibility

crypto, cookie, CSRF, Origin, return URL, 위치 label, CSV formula 중화, HTML escape 구현은
기존 함수 본문과 출력 계약을 유지한다. 특히 `escapeHtml.toString()`은 외부 참조 없이
브라우저 realm에서 계속 실행된다. 신규 계약은 기존 production 경로에 아직 주입하지 않는다.

## Consequences

도메인별 이전 단계에서는 `utils.js` import를 실제 소유 모듈 import로 바꾸며 importer
기준선을 줄인다. D1Gateway 적용은 기존 batch 순서와 guard를 characterization test로 고정한
뒤 command 단위로 진행한다.
