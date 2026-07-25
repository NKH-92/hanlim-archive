# 무료 티어 최적화 결정과 운영 계획

## 유지하는 업무 계약

- 정확한 문서명·문서번호·개정·분류·위치·상태·태그 검색과 현재 상태 재검증
- 회사 공식 보관문서인 Excel 대장의 전체 snapshot, manifest/hash, 미리보기, 원자 반영, 제외 이력
- 25건 단위로 재개 가능한 정기폐기 캠페인과 문서별 감사 이력
- 세션 무효화, 로그인 제한, 권한, 감사, 낙관적 잠금, CSV 수식 방어
- 기존 116개 route와 과거 Core/Search migration의 append-only 계약

## 이번 최적화

### 검색 코드 경계

Worker 엔트리포인트는 검색 구현의 outbox·generation·rebuild 함수를 각각 알지 않는다.
다음 세 고수준 계약만 `domains/search/index.js`에서 사용한다.

1. 요청 직후 변경 문서 동기화
2. 대기 문서의 bounded 동기화
3. Cron의 bounded 검색 유지보수

구현이 하나뿐이고 정책이 없던 search service 복사 wrapper는 제거한다. 기존 domain export는
운영 도구와 characterization test의 호환성을 위해 유지한다.

### 정적 자산

`/assets/*`, `/images/*`, `/favicon.ico`는 Cloudflare Static Assets가 Worker 호출 없이 직접 응답한다.
HTML, 로그인, API, XLSX 경로는 계속 Worker를 통과한다. 직접 응답 자산의 보안 헤더는
`public/_headers`가 기존 Worker 공통 헤더 계약을 유지한다.

### 배포 분류

`scripts/classify-release.mjs`는 base와 배포 SHA 사이 파일을 분류하며 알 수 없는 경로는
항상 전체 보호 경로로 닫는다.

| 분류 | 범위 | 배포 경로 |
|---|---|---|
| `asset-only` | `public/`만 변경 | D1 bookmark·migration·임시 계정 없이 공개 자산과 version smoke |
| `runtime-only` | `src/`, `scripts/`, `tests/`, package 파일 | 임시 smoke 계정을 위한 Core bookmark, migration 생략, 인증 smoke |
| `database` | migration, `wrangler.jsonc`, 배포 workflow, 미분류 경로 | Core·Search bookmark, migration, 구 Worker 호환성, 전체 smoke |

모든 분류에서 배포 version 확인과 실패 시 Worker rollback은 유지한다. `runtime-only`는 임시 smoke
계정을 Core에 쓰므로 Core recovery point를 생략하지 않는다.

Static Assets 직접 응답은 ETag를 유지하지만 edge에 따라 `If-None-Match` 요청을 304가 아니라
동일 ETag·동일 MIME의 200으로 반환할 수 있다. 운영 smoke는 304 또는 이 안정된 200 응답을
재검증 성공으로 인정한다. 자산 이름이 content hash를 포함하지 않으므로 캐시는
`max-age=0, must-revalidate`를 유지해 새 Worker와 오래된 JS/CSS의 장기 혼용을 막는다.

## Core/Search D1 결정

2026-07-25 운영 측정은 다음과 같다.

| 항목 | 측정값 |
|---|---:|
| Core D1 크기 | 1,724,416 bytes |
| Search D1 크기 | 1,634,304 bytes |
| 전체 문서 | 402건 |
| 폐기 문서 | 34건 |
| Search outbox | 0건 |
| Search indexed current 문서 | 300건 |

문서당으로 환산하면 Core 약 4.3KB, Search 약 5.4KB다. 목표 규모인 10,000건에서 합산 약 100MB이고
Cloudflare Free의 DB당 상한은 500MB다. 즉 용량은 분리 근거가 되지 않는다.

### 판정: 통합

동시접속 약 10명, 문서 약 10,000건이라는 확정 요구사항에서 물리 분리를 유지할 근거는 확인되지 않았다.
이전 판단은 "D1이 DB별로 쿼리를 직렬 처리하므로 검색 부하가 Core 쓰기와 경합한다"였으나, 실제 읽기 경로는
Search DB에서 후보 ID를 얻은 뒤 **항상 Core를 다시 읽어** 권한·상태·필터를 재검증한다
(`data/searchData.js`의 `getCoreCandidateDocuments`). 모든 검색 요청은 이미 Core의 직렬 큐를 통과하므로
분리로 Core에서 덜어낸 것은 FTS 매칭 스캔뿐이다.

분리가 만들던 비용은 다음과 같고 전부 크로스 DB 트랜잭션이 없다는 사실 하나에서 나왔다.

- outbox lease, processor lease, 문서별 source watermark, 삭제 tombstone
- physical shadow generation, cutover fence, rollback, generation 정리
- 읽기 경로 이중화(Search 실패 시 최근 200건만 읽는 열화 폴백)
- 두 번째 migration 체인·manifest·baseline과 배포 시 두 번째 Time Travel bookmark
- `/readyz`가 파생 색인 동기화까지 요구해 파생 지연이 배포 게이트가 되던 구조

**입증 책임은 뒤집는다.** 이 규모에서는 통합이 기본값이고, 분리를 유지하려면 검색 부하와 대량 작업의
실측 경합 증적을 제시해야 한다.

### 전환 게이트

`npm run measure:search-consolidation -- --input <measurement.json>`이 아래 게이트를 판정한다.
판정 로직은 `scripts/measure-search-consolidation.mjs`, 계약 검증은 `tests/searchProjection.test.js`에 있다.

- Core + projection + 재색인 여유 30%를 포함한 최대 크기 400MB 이하(플랫폼 상한 500MB)
- 일반 요청 48 statements 이하, 원자 mutation batch 40 이하 (Cloudflare Free 상한 50 미만)
- 일일 70,000 rows written 및 3.5M rows read 이하
- 검색 부하 중 Excel 반영·정기폐기 p95가 기준선보다 10% 이상 악화되지 않고 overload 0건
- golden search의 결과·필터·정렬·cursor·ETag critical mismatch 0건
- projection 전체 삭제 후 12,000건 재색인 훈련 성공

### 릴리스 단계

| 단계 | 내용 | 롤백 |
|---|---|---|
| R1 측정 | 운영 용량·일일 rows·검색 p95·요청당 statement 수집 후 게이트 판정 | 코드 변경 없음 |
| R2 additive | migration 0047(reference 변경 범위 제한), 0048(Core projection·FTS·dirty 큐). 쓰기는 양쪽 반영 | additive migration, 읽기 경로 무변경 |
| R3 compare | staging·production `SEARCH_READ_MODE=compare`(현재 값)로 두 경로 결과·건수·패싯 비교, mismatch 로깅 | 변수 되돌리기 |
| R4 cutover | `wrangler.jsonc`의 staging·production `SEARCH_READ_MODE`를 `core`로 올린다. `SEARCH_DB` binding은 롤백용으로 유지 | `compare` 또는 `search-db`로 복귀 |
| R5 정리 | binding 제거, lease·watermark·generation·cutover 코드 삭제, 배포 scope=core | 이전 Worker version rollback |
| R6 별도 승인 | 보존기간 종료 후 물리 DB 삭제 | 불가 |

R2와 R4는 같은 release에 넣지 않는다. `SEARCH_READ_MODE=core`에서도 projection이 `ready`가 아니면
Search D1 → Core 퍼지 순으로 자동 강등하므로 재색인이 끝나기 전에 배포해도 검색은 계속 동작한다.
게이트가 하나라도 실패하면 R4를 진행하지 않고 `compare` 또는 `search-db`에 머문다.
Search binding 제거와 물리 DB 삭제는 같은 release에서 수행하지 않는다. 물리 삭제는 별도 승인,
보존기간 종료, 모든 rollback 후보의 Search 무의존 확인 뒤에만 수행한다.

### R5 정리 범위(다음 release)

R5는 운영에서 `SEARCH_READ_MODE=core`가 안정 확인된 뒤 별도 PR로 수행한다. 이 release가 rollback 경로를
없애므로 R2~R4와 같은 배포에 넣지 않는다. 삭제 대상은 다음과 같다.

| 대상 | 내용 |
|---|---|
| `wrangler.jsonc` | 모든 환경의 `SEARCH_DB` binding, `SEARCH_READ_MODE` var |
| `src/domains/search/infrastructure/indexMaintenance.js` | 파일 전체(outbox lease, processor lease, watermark, tombstone, shadow generation, cutover, rollback, generation 정리) |
| `src/data/searchData.js` | `getIndexedCandidateIds`, `getIndexedViewerPageV2`, `getFuzzyIndexedViewerPageV2`, `getLegacyCandidateIds`, compare 모드와 mismatch 로깅 |
| `src/domains/search/index.js` | legacy outbox 계약 재수출과 Cron statement 예산 분배(projection이 예산 전체 사용) |
| 새 contract migration | `search_index_outbox`, `search_event_clock`, `trg_search_outbox_*`, `trg_search_clock_*` 제거 (과거 migration은 수정하지 않고 새 번호로 DROP) |
| `search-migrations/` | 파일은 이력으로 남기고 적용 중단, `check-migrations.mjs`의 Search chain 검증 제거 |
| 배포·운영 | `SEARCH_D1_TARGET_DATABASE_ID`, `D1_RECOVERY_SCOPE=core-and-search`, Search Time Travel bookmark, `db:migrate:search:local` |
| readiness·관리 화면 | `warnings.searchDatabase`, `warnings.searchOperational`, legacy search 상세 표시 |

R5 시작 전 확인 항목: `SEARCH_READ_MODE=core`에서 7일 이상 무사고 운영, `search.projection-compare`
mismatch 0 유지, projection `reindex_status = 'ready'`와 dirty 큐 0의 정상 상태 관측, R6 물리 삭제까지의
보존기간 합의.

### 파생 색인 비용 절감

- reference(대분류·태그·랙·슬롯) 이름 변경이 전체 재색인을 유발하던 `trg_search_rebuild_*`를
  영향 문서만 표시하는 `trg_search_scope_*`로 교체했다. 이름 한 건 변경이 10,000건 재색인을
  요구하지 않는다.
- projection FTS5는 external content(`content_rowid = 'document_id'`)를 사용해 문서 1건 갱신이
  전체 색인 스캔 없이 rowid로 끝난다.
- 재색인은 physical generation 사본을 만들지 않고 in-place upsert로 진행해 문서당 쓰기 행이
  세대 수만큼 늘지 않는다.

## 변경 후 검증

```powershell
cd cloudflare-app
npm run verify
npm run audit:dependencies
$env:CLOUDFLARE_ENV = "production"
$env:D1_TARGET_DATABASE_ID = "<production Core D1 UUID>"
$env:SEARCH_D1_TARGET_DATABASE_ID = "<production Search D1 UUID>"
npm run deploy:dry
```

PR required check가 통과한 뒤 `main` 병합으로 운영 배포한다. 운영에서는 `/healthz`, `/readyz`,
로그인, 읽기 검색, 관리자 설정, 자산 MIME·ETag·304 및 배포 Worker version을 확인한다.
