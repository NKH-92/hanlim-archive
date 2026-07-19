# ADR 0001: Phase 1 개발 가드레일

- 상태: 승인
- 일자: 2026-07-19

## Context

도메인별 구조 이동 전에 문법 검사와 단위 테스트만으로는 import 경계, migration 변조,
JSDoc 타입 오류와 최소 형식 문제를 일관되게 막기 어렵다. 테스트가 하위 디렉터리로 이동하면
기존 `tests/*.test.js` glob도 누락을 만들 수 있다.

## Decision

- Node 24를 로컬·CI 공통 기준으로 고정한다.
- `npm run verify`가 syntax, checkJs, ESLint, 최소 format, migration checksum/schema/FK,
  재귀적 `node:test`를 순서대로 실행한다.
- checkJs는 오류가 없는 leaf 계약부터 시작하고 이후 Phase에서 include를 넓힌다.
- ESLint는 대규모 style rewrite 없이 오류 가능성이 높은 규칙만 적용한다.
- migration manifest는 과거 SQL의 SHA-256과 최종 table/trigger 목록을 함께 고정한다.
- 목표 `domain/application/infrastructure/web` import 규칙을 현재 구조와 병행 검사한다.

## Consequences

- runtime bundle과 동작은 바뀌지 않는다.
- migration을 새로 추가할 때 manifest checksum과 schema 기대값을 함께 갱신해야 한다.
- 현재 coverage 수치는 관찰값이며 Phase 1에서는 실패 threshold로 강제하지 않는다.
- GitHub branch protection에서 required check로 지정하는 작업은 저장소 외 설정이므로 운영자
  확인이 필요하지만, CI와 deploy workflow는 모두 동일한 `npm run verify`를 실행한다.
