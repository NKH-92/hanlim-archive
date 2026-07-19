# ADR 0005: Identity, Session, Permission 계약

- 상태: 승인
- 일자: 2026-07-19

## Context

session 값, 감사 행위자 snapshot, 비밀번호 최소 길이, 사용자 상태 전이와 메뉴 노출 판정이
여러 파일에 반복됐다. 직접 URL 권한과 화면 메뉴 정책도 코드만 보면 의도적 차이인지 알기 어려웠다.

## Decision

- `domains/identity`가 session→Actor, password policy, user state machine, capability model과
  사용자 mutation BatchPlan을 소유한다.
- Actor는 user id, username, display name, role, permission snapshot을 고정하며 system audit은
  이 mapper만 사용한다.
- 비밀번호 최소 길이 8자는 HTTP handler, password 변경 service, legacy signup data path가 같은
  policy를 사용한다. PBKDF2 iteration, salt, hash와 cookie 형식은 변경하지 않는다.
- 사용자 상태는 pending/rejected→approved, pending→rejected, approved→disabled,
  disabled→approved 전이만 허용한다.
- 사용자 상태·권한 변경은 audit→update 순서의 2-statement plan으로 표현한다.
- 직접 URL은 User의 세부 permission을 허용하지만, 고급 설정 submenu는 기존처럼 Admin에게만
  노출한다. capability model에 이 차이를 이름으로 기록한다.
- route에 연결되지 않았던 signup handler는 제거한다. `/signup`은 계속 session 조회 전 404다.

## Deferred

비밀번호 변경 시 다른 기존 session의 즉시 revoke, bootstrap provisioning, role/permission 모델
재설계는 동작·schema 변경이 필요하므로 별도 작업으로 남긴다.
