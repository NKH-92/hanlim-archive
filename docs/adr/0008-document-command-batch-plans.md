# ADR 0008: 문서 명령 BatchPlan

- 상태: 승인
- 날짜: 2026-07-19

## 결정

문서 생성, 수정, 이동, 폐기, 복원, 대량 폐기, 영구삭제의 D1 statement 배열을 이름 있는 `BatchPlan`으로 실행한다. plan은 use case id, step 이름, guard 설명, 감사 event id, 최종 변경 기대값과 statement budget을 실행 전에 고정한다.

기존 검증된 SQL과 bind 순서는 바꾸지 않는다. 현재 D1 결과의 stale/no-op 판정도 기존 `hasChanged` 계약을 유지한다. command service는 application 포트에 infrastructure 구현을 주입하고, `db.js`는 도메인 공개 API로 위임한다.

## Plan 계약

| Plan | 고정 순서 | 최대 batch 문장 |
|---|---|---:|
| `documents.create` | temporary insert → tags → audit → storage code finalize | 40 |
| `documents.update` | pre-state audit → tag detach/attach → optimistic update | 40 |
| `documents.move` | document audit → movement history → system audit → location update | 4 |
| `documents.dispose` | disposal log → document audit → status update | 3 |
| `documents.restore` | disposal log → document audit → system audit → status update | 4 |
| `documents.bulk-dispose` | 문서별 disposal log → audit → status update | 38 |
| `documents.permanent-delete` | history snapshot audit → system snapshot → delete | 3 |

대량 폐기의 38문장 제한은 선행 문서·태그 조회 2문장을 포함한 요청 전체 40문장 예산을 보존한다.

## 결과

- temporary storage code 확정, 태그·감사 원자성, pre-state audit, optimistic lock을 보존한다.
- 모든 no-op 로그 statement는 최종 변경과 같은 guard를 사용해 ghost audit을 만들지 않는다.
- migration, route, permission, UI 계약은 변하지 않는다.
