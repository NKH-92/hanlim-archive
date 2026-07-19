# ADR 0006: Racks, Location, Floor Plan 도메인 규칙

- 상태: 승인
- 일자: 2026-07-19

## Context

랙 저장 규격, 면 label, 열 방향 mirror, 도면 좌표와 슬롯 표시가 data/view/util에 흩어져
같은 물리 위치를 서로 다르게 해석할 위험이 있었다.

## Decision

- `domains/racks/domain`이 A/B face 정규화·label·location, 7×6 규격, 구역 상한,
  1구역 1번 단면 및 B면의 right-origin mirror, floor-plan geometry를 소유한다.
- `config.js`는 rack 상수를 재수출하는 compatibility 경계이며 실제 값은 `rackConfig.js`가
  단일 출처다.
- slot query는 원시 row만 읽고 label 조합은 web presenter가 담당한다.
- rack query와 command는 `infrastructure/queries.js`, `commands.js` 공개 경계로 분리한다.
  현재 SQL 본체는 `data/racksData.js` compatibility repository에 남아 있으며 이후 문서 도메인
  이동과 cross-domain read model 정리 때 내부로 옮길 수 있다.
- resize는 audit→rack update→범위 밖 slot 비활성→7×6 grid upsert의 4-statement plan,
  create는 3-statement plan, 구역 구성은 4-statement plan으로 고정한다.

## Compatibility

저장 face A/B, 단면/양면 label, 1구역 방향, 열 mirror, 1024×797 도면 좌표, 검색 링크,
문서가 존재하는 열·선반 또는 랙 범위 축소 방지 guard와 batch 순서를 변경하지 않는다.
