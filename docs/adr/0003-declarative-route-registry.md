# ADR 0003: 선언형 route registry와 권한 catalog

- 상태: 승인
- 일자: 2026-07-19

## Context

경로와 method 판정이 composition root와 세 개 compatibility router, 개별 handler에 분산되어
route 전수 검색, 충돌 탐지, 권한 문서 동기화와 named URL 생성이 어려웠다.

## Decision

- 공개 route와 인증 route를 `app/routeRegistry.js`의 descriptor로 선언한다.
- descriptor는 안정된 route id, family, method, path template, 인증, permission 또는 특수 policy,
  Origin·CSRF·강제 비밀번호 변경 metadata를 가진다.
- composition root의 공개 route와 인증 compatibility dispatcher는 registry match가 있는 경로만
  실행한다. 기존 handler 내부의 세부 권한과 상태 policy는 계속 최종 권한 원본이다.
- method mismatch는 registry API에서 405로 식별하지만 기존 Worker 응답은 호환성을 위해 404를
  유지한다.
- `/signup` always-404, restore Admin-only, 이동 이력의 move-or-audit 등 단순 permission으로
  환원할 수 없는 정책은 이름 있는 policy로 기록한다.
- route와 permission 문서는 `npm run docs:routes`로 생성하며 `npm run verify`가 최신 여부와
  collision을 검사한다.

## Compatibility

POST-only mutation, Origin 선행 검사, 인증 후 CSRF, logout 처리, 강제 비밀번호 변경 우선순위,
URL·redirect·403·404 응답을 변경하지 않는다. route id는 미처리 오류 structured log에 포함한다.
