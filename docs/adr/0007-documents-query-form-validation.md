# ADR 0007: 문서 조회·폼·검증 경계

- 상태: 승인
- 날짜: 2026-07-19

## 결정

문서 읽기 기능은 `domains/documents/application`의 포트와 `infrastructure` 저장소 구현을 통해 공개한다. HTTP `FormData` 해석은 `web/forms.js`, D1의 snake_case 행을 camelCase 공개 모델로 바꾸는 작업은 `web/presenters.js`에서만 수행한다. 내부 식별자인 `storage_code`는 공개 read model에 포함하지 않는다.

필드 길이·필수값·날짜·연도 규칙은 `domain/validation.js`가 단일 출처다. UI와 CSV 가져오기는 이 규칙을 공유하고, D1 참조 무결성 검사는 infrastructure adapter를 주입한 application validation 포트를 통해 수행한다.

## 호환성

기존 `db.js`, `documentRules.js`, `data/documentsData.js` export는 호환 facade로 유지한다. 기존 뷰가 사용하는 snake_case 조회 결과도 이번 단계에서는 그대로 유지하며, 신규 공개 read model이 필요한 경계에서 presenter를 명시적으로 호출한다.

## 결과

- infrastructure에는 `FormData` 의존성이 없다.
- SQL과 참조 검증은 infrastructure에 남는다.
- 폼 파싱, 저장 행 표현, 공개 모델 변환 위치가 명시된다.
- route, 권한, 스키마, migration, D1 batch 순서는 바뀌지 않는다.
