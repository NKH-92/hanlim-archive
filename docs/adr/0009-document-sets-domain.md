# ADR 0009: Document Sets 독립 도메인

- 상태: 승인
- 날짜: 2026-07-19

## 결정

세트 조회, CRUD, 잠금, 항목 추가·제외, 이력 SQL을 `domains/sets`가 소유한다. HTTP handler는 표시명 문자열 대신 session Actor 객체를 command에 전달한다. infrastructure는 호환 호출을 포함해 한 지점에서 감사 표시명을 정규화한다.

모든 변경은 이름 있는 `sets.*` BatchPlan을 사용한다. 수정·삭제·항목 변경은 `is_locked = 0` guard를 로그, touch, 실제 변경에 동일하게 적용한다. 잠금·해제는 세트 로그 → 시스템 감사 → 상태 변경 순서를 유지한다.

## 결과

- 잠긴 세트의 수정·삭제·항목 변경은 기존과 같이 거부된다.
- 변경 이력은 실제 상태 변경보다 먼저 같은 atomic batch에 기록된다.
- 최대 200개 항목 추가도 기존 단일 multi-row statement와 3문장 batch를 유지한다.
- CSV·인쇄 결과, route, permission, schema, migration은 변하지 않는다.
- `data/setsData.js`는 기존 소비자를 위한 compatibility facade다.
