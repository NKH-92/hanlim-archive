# ADR 0010: 폐기 캠페인과 CSV 가져오기 장기 작업

- 상태: 승인
- 날짜: 2026-07-19

## 결정

폐기 캠페인과 CSV 가져오기를 각각 `domains/disposal`, `domains/imports`로 분리한다. 두 도메인은 상태 machine, repository, 이름 있는 BatchPlan과 집계/export query를 독립적으로 소유한다. 공통 queue, 범용 job framework, Durable Object는 도입하지 않는다.

폐기 process는 frozen snapshot 항목만 claim token으로 선점하고 disposal log·document audit이 성공한 문서만 변경한다. 가져오기 process는 staging payload의 pending 항목 하나를 claim하고 문서 생성·항목 완료·집계를 같은 batch에 둔다. terminal 상태의 재호출은 새 mutation을 만들지 않는 기존 idempotency를 유지한다.

## 예산과 불변식

- 요청 전체 D1 예산은 40문장이다.
- 폐기 chunk는 25건이며 집합 statement 10개 이하를 유지한다.
- import process chunk는 1건이며 CSV 생성은 최대 50개 staging 행을 한 statement에 기록한다.
- changed 문서, failure retry, 완료 집계와 failure export shape는 바꾸지 않는다.
- route, permission, schema, migration은 변하지 않는다.

`data/disposalBatchData.js`, `data/importJobData.js`는 compatibility facade다.
