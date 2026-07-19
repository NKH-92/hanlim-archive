# 배포 및 운영 절차

운영 resource 이름과 binding은 `cloudflare-app/wrangler.jsonc`를 단일 출처로 사용한다. 운영 변경은 GitHub Actions의 `Deploy Production` workflow로만 수행하며, 로컬에서 원격 migration이나 production deploy를 실행하지 않는다.

## 로컬 준비와 실행

Node.js 24와 npm lockfile을 사용한다.

```powershell
cd cloudflare-app
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run check
npm test
npm run dev
```

`.dev.vars`에는 최소 32자의 무작위 `SESSION_SECRET`을 넣고 commit하지 않는다. migration은 로컬에서도 번호 순서대로 전체 적용하며 기존 파일을 수정하지 않는다.

## PR 사전 검증

```powershell
cd cloudflare-app
npm ci
npm run verify
npm run audit:dependencies
npm run release:evidence
npm run deploy:dry
```

`deploy:dry`는 운영 secret이나 원격 D1을 요구하지 않고 실제 배포를 만들지 않는다. PR의 `required / verify`는 같은 검증, dependency audit, migration·schema evidence, Worker bundle report를 보존한다.

## 운영 배포 흐름

`main` 병합 후 production Environment 승인이 있어야 한 SHA에 대해 다음 순서로 진행한다.

1. 같은 SHA를 다시 검증하고 release evidence를 생성한다.
2. 현재 Worker version id를 기록한다.
3. 운영 D1을 export해 암호화한 pre-deploy backup과 checksum을 업로드한다.
4. append-only migration을 적용한다.
5. Worker를 배포한다.
6. `/healthz`, `/login`, `/signup` 404와 승인된 read-only 계정 검색을 smoke-test한다.
7. smoke 실패 시 기록한 이전 Worker version으로 자동 rollback한다.
8. migration·deploy·smoke·rollback 증거와 version 목록을 release artifact로 보존한다.

backup 업로드 전에 migration을 실행하지 않는다. 배포와 주간 백업은 `d1-production-maintenance` concurrency group으로 직렬화한다.

## Migration과 rollback

- additive 변경은 expand migration을 먼저 적용하고 이전 Worker와 함께 동작해야 한다.
- schema 제거는 이전 Worker가 더 이상 사용하지 않는 별도 release의 새 contract migration으로 수행한다.
- destructive migration과 의존하는 application code를 같은 release에 넣지 않는다.
- D1 migration에는 일반적인 down migration이 없다. 애플리케이션 문제이고 migration이 호환될 때만 이전 Worker version으로 rollback한다.
- 데이터 손상이나 비호환 schema 문제는 Worker rollback만으로 완료 처리하지 않고 [백업·복구 절차](./BACKUP_RESTORE.md)를 시작한다.

## 운영 확인

배포 후 아래 항목을 확인한다.

- `/healthz` 200, `/login` 200, `/signup` 404
- 미인증 업무 경로의 로그인 redirect
- 승인 계정의 검색·문서 상세 read-only 표본
- migration pending 0과 release 대상 SHA
- Worker 오류율과 D1 오류, console JavaScript 오류, CSP 위반 부재

장애가 발생하면 변경을 중지하고 release SHA·Worker version·migration 결과·request ID를 확보한다. 애플리케이션 오류인지 데이터 손상인지 구분한 뒤 Worker rollback 또는 복구 절차를 선택한다.

## 월별 무료티어 점검

| 항목 | 확인 위치 | 경고 시 조치 |
|---|---|---|
| Worker 요청·오류율·CPU | Cloudflare Dashboard의 Worker Metrics | request ID와 최근 배포 확인 |
| D1 읽기·쓰기·DB 크기 | Cloudflare Dashboard의 D1 Metrics | 대량 작업 중지, 쿼리·인덱스 검토 |
| Actions 사용량 | GitHub Billing의 Actions | 중복 실행과 불필요한 artifact 정리 |
| 백업 artifact | GitHub Actions의 D1 Backup | 최근 성공과 암호화 파일·checksum만 존재하는지 확인 |
| 검색 index | 앱 관리 화면 | 경고 기준에서 크기 추적, 상한에서 구조 재검토 |

월 1회 `/healthz`와 검색·상세 표본, 데이터 품질 작업목록, 유지관리자·2단계 인증, API token 최소권한을 함께 점검한다. 대량 CSV 전후에는 최근 백업·행 수·중복과 작업 결과를 확인하고, 폐기 캠페인 전후에는 동결 건수·승인 참조·감사로그·결과 CSV를 대조한다.

## 최초·수동 운영 설정

저장소 관리자는 GitHub UI에서 PR 승인, CODEOWNERS, required check `required / verify`, direct/force push 금지와 production Environment reviewer를 설정한다. Actions에는 값이 아니라 다음 secret 이름과 최소 scope만 관리한다.

- 배포용 `CLOUDFLARE_API_TOKEN`: 대상 Worker와 D1 변경에 필요한 최소권한
- 백업용 `CLOUDFLARE_D1_BACKUP_API_TOKEN`: 원격 export에 필요한 대상 D1 Write/Edit 전용, 배포 토큰과 분리
- `D1_BACKUP_PASSPHRASE`: 32자 이상 백업 전용 무작위 값
- `SMOKE_USERNAME`, `SMOKE_PASSWORD`: 변경 권한이 없는 승인된 smoke 계정

secret 값, 기본 비밀번호, 개인 계정 정보는 저장소·로그·issue·PR에 기록하지 않는다. 저장소 visibility, token 회전, 유지관리자 2단계 인증, branch protection은 운영 책임자가 수동으로 확인한다.
