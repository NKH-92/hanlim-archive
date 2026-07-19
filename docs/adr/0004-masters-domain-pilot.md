# ADR 0004: masters 도메인 pilot

- 상태: 승인
- 일자: 2026-07-19

## Context

전체 도메인을 이동하기 전에 대분류·태그의 작은 CRUD로 목표 계층, compatibility façade,
감사 batch plan과 테스트 전략이 실제 코드에 적합한지 검증할 필요가 있다.

## Decision

- `domains/masters`를 domain policy, application service, infrastructure repository, web
  form/handler/view와 공개 `index.js`로 구성한다.
- application은 repository port를 주입받고 infrastructure를 import하지 않는다. 도메인 경계의
  `service.js`가 실제 repository adapter를 조립한다.
- 모든 SQL과 D1 호출은 infrastructure repository에만 둔다.
- 생성은 insert → audit, 수정·사용중지는 audit → mutation의 기존 순서를 보존하며 각 2문장을
  이름 있는 BatchPlan으로 표현한다.
- `data/mastersData.js`, `handlers/adminHandlers.js`, `views/adminViews.js`는 기존 공개 import를
  보존하는 façade로 유지하고 신규 router는 masters 공개 API를 사용한다.

## Compatibility

category/tag 목록 정렬, active filter, 입력 정규화, 검증·UNIQUE 메시지, soft delete,
감사 snapshot·guard·statement 순서, redirect와 HTML 출력을 변경하지 않는다. schema와 migration은
변경하지 않는다.

## Review

작은 도메인에 7개 구현 파일과 1개 공개 API만 사용했고 category/tag 중복 코드는 type policy와
repository에서 공유한다. 이후 도메인은 규모에 맞게 같은 계층을 축약할 수 있다.
