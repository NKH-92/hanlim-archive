# 개선 구현 기준 메모

## 기준 상태

- 확인일: 2026-07-19
- 배포 대상: `cloudflare-app/`
- `npm run check`: 전체 소스·스크립트 문법 검사
- `npm test`: node:test 전체 통과
- 기준 브랜치: `codex/refactor-phase-13-admin-read-models`

## 유지할 구조

요청은 `src/index.js → handlers → domain public API/readModels/views → platform/shared` 순서로 흐른다.
cross-domain 조회는 `readModels/`에서만 조합하며 삭제된 `db.js`/`html.js`/`utils.js` 전역 façade는
사용하지 않는다. Workers 소스에서는 Node API를 사용하지 않고 SQL은 infrastructure에 둔다.

## 변경 시 불변식

1. `searchCore.js`는 server/browser 공통 ESM이며, `escapeHtml()`만 bootstrap 계약상 자기완결적이어야 한다.
2. HTML은 반드시 `page()`를 거쳐 CSP nonce를 주입한다.
3. 다중 상태 변경은 `env.DB.batch()`에 넣고 감사 INSERT를 UPDATE/DELETE보다 먼저 실행한다.
4. 문서 수정과 위치 이동은 `updated_at`과 단조 증가 `row_version` 낙관적 잠금을 함께 사용한다.
5. migration은 append-only이며 초기 관리자도 migration으로 등록한다. 수동 SQL 절차를 만들지 않는다.
6. 내부 `ARC-*` 보관코드는 사용자 검색·CSV·감사 상세에 노출하지 않는다.
7. 랙 면 표기는 단면 `13`, 양면 `13-1`/`13-2`이며 저장값 A/B는 유지한다.

## 무료티어 기준

내부 예산의 단일 출처는 `src/freeTierBudget.js`다. 일반 문서 목록은 검색어가 없을 때
`COUNT`와 `LIMIT/OFFSET`으로 30행만 읽는다. 대량 폐기와 CSV 가져오기는 진행상태를 D1에
저장하고 브라우저가 여러 요청으로 나누어 호출한다. 반복문 안에서 D1 요청을 실행하지 않고,
반복문은 batch statement를 만드는 용도로만 쓴다.

## 현재 시스템에 맞춘 결정

- 계획서의 정확 보관코드 검색은 기존 내부 식별자 비노출 정책과 충돌하므로 도입하지 않는다.
- 반출·반납, 실사·검증상태, 파일 보관, 전자결재, 외부 알림은 범위에 넣지 않는다.
- 운영 `main` 푸시는 자동 migration·배포를 수행하므로 기능 브랜치에서 검증 후 PR로 병합한다.
