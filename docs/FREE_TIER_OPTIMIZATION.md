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

용량은 단일 D1 후보가 될 만큼 작지만, D1은 DB별로 쿼리를 직렬 처리한다. Search D1을 Core에 합치면
별도 query queue가 사라지므로 검색 부하 중 Excel 반영·정기폐기 경합 증적 없이 합치지 않는다.

다음 게이트를 모두 통과할 때만 additive Core projection migration과 dual comparison release를 시작한다.

- Core + projection + rebuild 여유 30%를 포함한 최대 크기 400MB 이하
- 일반 요청 40 statements 이하, 플랫폼 상한 50 미만
- 일일 70,000 rows written 및 3.5M rows read 이하
- 검색 부하 중 Excel 반영·정기폐기 p95가 기준선보다 10% 이상 악화되지 않고 overload 0건
- golden search의 결과·필터·정렬·cursor·ETag critical mismatch 0건
- projection 전체 삭제 후 12,000건 rebuild 및 최신 문서 overlay 훈련 성공

게이트가 하나라도 실패하면 현재 Search D1, outbox, generation, watermark, tombstone을 유지한다.
Search binding 제거와 물리 DB 삭제는 같은 release에서 수행하지 않는다. 물리 삭제는 별도 승인,
보존기간 종료, 모든 rollback 후보의 Search 무의존 확인 뒤에만 수행한다.

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
