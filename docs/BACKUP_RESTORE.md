# D1 복구 절차

운영 데이터는 Cloudflare D1 Time Travel을 복구 수단으로 사용한다. 별도 R2 또는 SQL export 백업은
무료티어 운영 범위에 포함하지 않는다. Workers Free의 Time Travel 보존 기간은 7일이므로 사고 발견 즉시
복구 가능 시점을 확인한다.

## 배포 전 복구 지점

`Deploy Production` workflow는 migration 전에 Core와 Search D1의 현재 bookmark를 각각 조회한다.
`release-evidence/d1-recovery.json`에는 다음 비민감 정보만 기록한다.

- release SHA와 GitHub run ID
- 환경 이름
- Core·Search database 이름과 ID
- 각 database의 Time Travel bookmark

guarded migration은 이 파일이 현재 run, SHA, environment와 두 D1 ID에 정확히 일치할 때만 실행된다.
복구 지점 artifact는 8일간 남지만 실제 복구 가능 기간은 Cloudflare의 7일 보존 기간을 따른다.

## 사고 판단

1. 쓰기 변경과 추가 배포를 중지한다.
2. 애플리케이션 오류인지 데이터 손상 또는 비호환 schema인지 구분한다.
3. 애플리케이션 문제이고 DB schema가 호환되면 이전 100% traffic Worker version으로 rollback한다.
4. 데이터 복구가 필요하면 Core와 Search 중 영향받은 DB, 손상 시각, 목표 시점, 예상 데이터 손실 범위를 기록한다.
5. production Environment 승인권자에게 복구 대상 DB와 bookmark 또는 timestamp를 확인받는다.

D1 restore는 대상 DB의 현재 상태를 되돌리는 파괴적 작업이다. 자동화된 배포 workflow에서 실행하지 않는다.

## 복구 가능 시점 확인

`cloudflare-app/`에서 최소 권한 D1 token을 사용해 읽기 전용으로 확인한다.

```powershell
npx wrangler d1 time-travel info hanlim-archive --env production --json
npx wrangler d1 time-travel info hanlim-archive-search-10k --env production --json
```

배포 직전 상태로 복구할 때는 해당 release artifact의 bookmark를 사용한다. 특정 장애 시각으로 복구할 때는
Cloudflare가 반환하는 보존 범위 안인지 먼저 확인한다. 7일을 넘긴 시점은 현재 무료티어 절차로 복구할 수 없다.

## 승인된 원격 복구

한 번에 하나의 D1만 복구하고 각 단계 결과를 확인한다.

```powershell
npx wrangler d1 time-travel restore hanlim-archive --env production --bookmark "<CORE_BOOKMARK>"
npx wrangler d1 time-travel restore hanlim-archive-search-10k --env production --bookmark "<SEARCH_BOOKMARK>"
```

두 DB가 모두 영향을 받은 경우 Core를 먼저 복구하고 Search를 복구한다. Search만 손상된 경우 Core는
건드리지 않고 Search를 복구하거나 파생 인덱스를 재구축한다. 명령 실행 직전 database 이름, ID, bookmark,
승인 기록을 다시 대조한다.

## 복구 후 검증

1. Core와 Search migration 상태가 예상 시점과 일치하는지 확인한다.
2. `/healthz`와 `/readyz`가 200인지 확인한다.
3. 승인 계정 로그인, 문서 검색·상세, 랙 위치와 최근 감사이력을 표본 확인한다.
4. 독립 Admin의 `/admin/settings` 접근과 사용자 관리 marker를 확인한다.
5. Search outbox와 rebuild 상태를 확인하고 필요하면 재구축한다.
6. incident 기록에 release SHA, Worker version, 복구 DB·bookmark, 승인자, 명령 결과와 검증 결과를 남긴다.

7일보다 긴 복구 보존이 실제 업무 요건이 되면 그 시점에 유료 D1 또는 별도 외부 백업의 비용·암호화·복구
훈련을 별도 승인한다. 현재 운영에는 사용하지 않는다.
