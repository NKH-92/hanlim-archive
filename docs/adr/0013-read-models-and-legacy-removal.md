# ADR 0013: Read Model 경계와 전역 Legacy Façade 제거

- 상태: 승인
- 날짜: 2026-07-19

## 결정

관리자 대시보드의 cross-domain 조회는 `src/readModels/adminDashboard.js`에서 권한별로 조합한다.
시스템 감사는 `domains/audit`, 데이터 품질 issue catalog·query·view는 `domains/dataQuality`가 소유한다.
handler는 도메인의 공개 `index.js`, 명시적 read model, 실제 view 모듈을 import한다.

운영 코드와 테스트의 소비자가 0임을 import graph 계약으로 확인한 뒤 전역 `src/db.js`, `src/html.js`,
`src/utils.js`를 삭제한다. 전체 export 이름을 snapshot처럼 고정하던 exact-export 테스트도 제거한다.
공개 계약은 route/permission, domain behavior, BatchPlan, SQL integration, render 결과로 검증한다.

## 결과

- 새 use case의 의존성이 거대한 전역 export 목록에 숨지 않는다.
- audit/data-quality/admin 조회 소유권과 DB row → 화면 경계가 명확하다.
- `architectureBoundaries.test.js`가 삭제된 façade의 production consumer 0을 계속 강제한다.
- route, permission, D1 statement 순서, schema, migration, UI 출력은 변경하지 않는다.

이 결정은 ADR 0002, 0007, 0008에서 단계적 이전을 위해 유지했던 전역 façade 방침의 종료를 기록한다.
해당 ADR은 당시 결정의 이력으로 보존한다.
