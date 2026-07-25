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
이전 판단은 "D1이 DB별로 쿼리를 직렬 처리하므로 검색 부하가 Core 쓰기와 경합한다"였으나, 통합 전 읽기 경로는
Search DB에서 후보 ID를 얻은 뒤 **항상 Core를 다시 읽어** 권한·상태·필터를 재검증했다
(`data/searchData.js`의 `getCoreCandidateDocuments`). 모든 검색 요청이 이미 Core의 직렬 큐를 통과했으므로
분리로 Core에서 덜어낸 것은 FTS 매칭 스캔뿐이었다.

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
| R2 additive (완료) | migration 0047(reference 변경 범위 제한), 0048(Core projection·FTS·dirty 큐). 쓰기는 양쪽 반영 | additive migration, 읽기 경로 무변경 |
| R3 compare (완료) | 두 읽기 경로의 결과·건수·패싯을 함께 실행해 비교하고 mismatch를 구조화 로그로 남기는 경로 추가 | 플래그 되돌리기 |
| R4 cutover (완료) | 읽기 기본값을 Core projection으로 전환 | 플래그로 복귀 |
| R5 정리 (완료) | `SEARCH_DB` binding, 두 번째 migration 체인, lease·watermark·tombstone·generation·cutover 코드 삭제. 배포·복구 scope=core | 이전 Worker version rollback |
| R6 정리 (완료) | migration 0049로 `search_index_outbox`·`search_event_clock`과 관련 trigger 17개 DROP. `search-migrations/` 삭제 | 이전 Worker version rollback |
| R7a expand (구현 완료·배포 전) | migration 0050으로 cursor generation을 `search_projection_state`에 추가하고 runtime을 전환. 이전 Worker rollback용 `search_index_state`는 dual-write | 이전 Worker가 legacy counter를 계속 사용 가능 |
| R7b contract (별도 승인) | 안정화 관찰 뒤 `search_index_state` DROP, 더 이상 쓰지 않는 물리 Search D1 삭제 | R7a가 충분히 배포·검증된 뒤에만 수행 |
| R8 초기 적재 schema 정리 (구현 완료·배포 전) | migration 0051로 제거된 MFA·legacy bootstrap job 저장소 DROP, 0052로 staging action 보조 index 제거 | 직전 운영 Worker의 runtime 참조 0과 rollback table shape를 보존한 상태에서 적용 |

R2~R5를 한 배포에 합쳤다. 근거: 통합 시점의 운영 대장이 검증용 테스트 문서뿐이어서 검색 열화 구간을
수용할 수 있었다. 배포 직후 projection이 `ready`가 될 때까지 검색은 최근 200건 Core 퍼지로 열화되며,
402건 기준 당시 Cron 5분 주기·chunk 100건으로 약 25분이 걸렸다. migration 0050 이후 실사용 10,000건 초기
적재는 무료 write를 한 UTC 일자에 몰지 않도록 기본 chunk를 10건으로 낮춘다. 5분 Cron만 사용하면 전체 재색인은
1,000회, 최소 약 83시간 20분(약 3.5일)이므로 운영전환 전에 미리 수행한다.

R5는 rollback 폭을 좁히지만 Core의 legacy 테이블은 남겨 이전 Worker version rollback을 유지했다.
R6에서 그 테이블을 DROP한 근거는 배포된 R5 Worker가 `search_index_outbox`·`search_event_clock`을
읽지 않는다는 것이다. 두 테이블에 쓰던 것은 trigger뿐이므로 trigger를 함께 지우면 이전 Worker의 쓰기
경로도 그대로 동작한다. 즉 R6는 rollback 호환을 깨지 않는다.

migration 0050에서 `search_projection_state.generation`을 추가하고 runtime cursor를 이 값으로 전환했다.
문서·태그·기준정보 변경 trigger는 새 generation과 `search_index_state.generation`을 함께 올려 이전 Worker rollback도
유지한다. 따라서 `search_index_state`는 이제 runtime 필수 상태가 아니라 rollback mirror다. 실제 배포 후 충분한
안정화 관찰 기간을 거친 별도 contract release에서만 DROP한다. 배포 workflow의
`Verify rollback Worker against migrated schema`가 이 순서를 강제한다.

### R5 정리 결과

| 대상 | 처리 |
|---|---|
| `wrangler.jsonc` | 세 환경 모두에서 `SEARCH_DB` binding과 `SEARCH_READ_MODE` var 제거 |
| `src/domains/search/infrastructure/indexMaintenance.js` | 파일 삭제(outbox lease, processor lease, watermark, tombstone, shadow generation, cutover, rollback, generation 정리) |
| `src/data/searchData.js` | legacy 색인 읽기 경로와 compare·mismatch 로깅 제거. projection 단일 경로와 Core 퍼지 폴백만 남김 |
| `src/domains/search/index.js` | legacy outbox 계약 재수출 제거. Cron은 dirty 배출과 재색인 chunk만 수행 |
| `src/platform/d1/requestGateway.js` | `SEARCH_DB` 예산 wrapper와 잔여 statement 계산 제거 |
| readiness·관리 화면 | legacy search 상세와 `warnings.searchDatabase`·`searchOperational` 제거. `warnings.searchProjectionSynced` 하나만 유지 |
| 배포·운영 | `SEARCH_D1_TARGET_DATABASE_ID`, `D1_RECOVERY_SCOPE=core-and-search`, Search Time Travel bookmark, `db:migrate:search:local` 제거 |
| `search-migrations/` | R5에서 적용 중단하고 `check-migrations.mjs`의 Search chain 검증 제거, R6에서 파일 삭제 |
| R7a 구현 | cursor generation을 `search_projection_state`로 이관하고 legacy counter dual-write |
| R7b로 이연 | 안정화 뒤 `search_index_state` DROP, 물리 Search D1 삭제 |

### 파생 색인 비용 절감

- reference(대분류·태그·랙·슬롯) 이름 변경이 전체 재색인을 유발하던 `trg_search_rebuild_*`를
  영향 문서만 표시하는 `trg_search_scope_*`로 교체했다. 이름 한 건 변경이 10,000건 재색인을
  요구하지 않는다.
- projection FTS5는 external content(`content_rowid = 'document_id'`)를 사용해 문서 1건 갱신이
  전체 색인 스캔 없이 rowid로 끝난다.
- 재색인은 physical generation 사본을 만들지 않고 in-place upsert로 진행해 문서당 쓰기 행이
  세대 수만큼 늘지 않는다.
- migration 0050은 실제 FTS 실행계획이 `FTS MATCH → projection INTEGER PRIMARY KEY`를 쓰는 것을 확인하고
  사용되지 않는 projection secondary index 4개를 제거했다. documents는 identity·Excel key 무결성, 기본 current 목록 정렬,
  그리고 모든 텍스트 검색 앞에서 실행되는 문서명 완전일치용 NOCASE index만 남긴다. 위치 조회는 최대 12,000건 scan을 허용한다.
  로컬 10,000건 리허설에서 exact-name lookup 0.02ms, 위치 scan 3.46ms였으며 이는 구조 비교용 로컬 수치이지 운영 SLA는 아니다.
  `document_tags`와 snapshot membership은 `WITHOUT ROWID`로 바꿔 초기 적재 write를 줄였다.
- bootstrap은 승인 Excel의 초기 상태이므로 10,000개 `excel_sync_create`/초기 `disposed` 행위를 중복 생성하지 않는다.
  행별 원본은 snapshot row와 `last_snapshot_id`, 전체 출처는 canonical hash와 system apply audit로 보존한다. 신규 문서의
  내부 `ARC-*` 코드도 INSERT 시 바로 확정해 전체 문서를 한 번 더 UPDATE하던 단계를 없앴다.
- D1 gateway는 mutation batch 결과의 `rows_read`·`rows_written`을 `d1.query` 로그에 기록하므로, 최초 적재의 실제
  write amplification은 추정치가 아니라 D1 Metrics와 구조화 로그를 대조해 판정한다.
- migration 0051은 현재 runtime 참조가 0인 `user_mfa`, `user_mfa_recovery_codes`, `bootstrap_runs`, `bootstrap_chunks`를
  제거한다. 0052는 `document_snapshot_rows.id`를 제거하는 안을 rollback 비호환으로 기각하고, 최대 12,000행으로 제한된
  staging에서 불필요한 `idx_document_snapshot_rows_action`만 제거한다. 직전 Worker가 SELECT하는 table shape는 그대로 보존한다.
  `login_throttle`은 현재 비밀번호 초기화·release smoke·legacy fallback이 사용하고,
  `search_index_state`는 직전 Worker rollback mirror이므로 이번 정리 대상에서 제외한다.
- snapshot prepare는 기존 `UPDATE rows FROM json_each(전체 JSON)`이 row마다 JSON virtual table을 다시 스캔하던 구조를
  `MATERIALIZED` change CTE + `(snapshot_id,row_number)` index lookup으로 바꿨다. payload는 1.9MB 이하로 자동 분할하고
  bootstrap은 동일한 `after_json`을 중복 저장하지 않는다. 로컬 10,000건 리허설에서 prepare는 126.20초에서 약 0.57초로
  줄었고 prepare 11문장, apply 28문장으로 모두 40문장 mutation 예산 안에 있다.
- 최종 migration replay 기준 schema는 FTS 내부 table을 포함해 44 tables, named index 37개다. 0050 전의
  48 tables·56 named index에서 업무 기능이나 무결성 trigger를 줄이지 않고 dead storage와 write amplification만 축소했다.

## 변경 후 검증

```powershell
cd cloudflare-app
npm run verify
npm run audit:dependencies
$env:CLOUDFLARE_ENV = "production"
$env:D1_TARGET_DATABASE_ID = "<production Core D1 UUID>"
npm run deploy:dry
```

PR required check가 통과한 뒤 `main` 병합으로 운영 배포한다. 운영에서는 `/healthz`, `/readyz`,
로그인, 읽기 검색, 관리자 설정, 자산 MIME·ETag·304 및 배포 Worker version을 확인한다.
