# Cloudflare 운영 배포 가이드

운영 대상은 Worker `hanlim-archive`, D1 `hanlim-archive`, URL은
`https://hanlim-archive.skarhkdgus7.workers.dev`다. 운영 변경은 GitHub Actions의
`Deploy Production` workflow만 사용한다. 로컬에서 원격 migration이나 production deploy를 실행하지 않는다.

## 최초 GitHub 설정

저장소 관리자가 GitHub UI에서 다음 보호 설정을 한 번 적용한다.

1. `main` branch protection/ruleset
   - pull request 필수, 최소 1인 승인
   - stale approval 해제, CODEOWNERS 승인 필수
   - required status check: `required / verify`
   - direct push와 force push 금지
2. `production` Environment
   - required reviewer 최소 1인
   - 가능하면 self-review 금지
   - deployment branch는 protected `main`만 허용
3. `production` Environment secrets
   - `CLOUDFLARE_API_TOKEN`: 대상 계정에 한정한 Workers Scripts Edit + D1 Edit 토큰
   - `D1_BACKUP_PASSPHRASE`: 32자 이상 백업 전용 무작위 암호
   - `SMOKE_USERNAME`, `SMOKE_PASSWORD`: Admin이 아닌 승인된 읽기 전용 smoke 계정
4. 주간 `D1 Backup`용 repository secrets
   - `CLOUDFLARE_D1_BACKUP_API_TOKEN`: D1 Read 전용 토큰
   - `D1_BACKUP_PASSPHRASE`: production Environment와 같은 복구 관리 정책의 값

secret 값은 저장소 파일, 로그, issue, PR에 기록하지 않는다. smoke 계정은 최초 비밀번호 변경을 완료하고
문서 변경 권한을 부여하지 않는다.

## PR과 배포 흐름

PR의 `required / verify`는 다음을 모두 통과해야 한다.

- `npm ci`, `npm run verify`
- high 이상 dependency audit
- Worker `--dry-run`과 bundle size report
- migration checksum·table·trigger schema manifest
- CI evidence artifact 업로드

`main` 병합 후 production Environment 승인이 있어야 배포 job이 시작한다. job은 한 SHA에 대해 다음 순서를
고정한다.

1. 같은 SHA를 다시 verify하고 release evidence 생성
2. 현재 Worker version id 기록
3. 운영 D1 전체를 export하고 AES-256으로 암호화한 pre-deploy backup 업로드
4. append-only migration 적용
5. Worker deploy
6. `/healthz`, `/login`, `/signup` 404, 전용 계정 read-only 검색 smoke
7. smoke 실패 시 기록한 이전 Worker version으로 자동 rollback
8. migration/deploy/smoke/rollback 로그와 version 목록을 release artifact로 90일 보존

backup 업로드가 완료되기 전에는 migration이 실행되지 않는다. 배포와 주간 백업은 같은 concurrency group으로
직렬화한다.

## Migration 정책

- **Expand**: nullable column, 새 table/index처럼 이전 Worker와 함께 동작하는 additive migration을 먼저 배포한다.
- compatible Worker를 배포하고 backfill/운영 확인을 별도 단계로 수행한다.
- **Contract**: 과거 Worker가 더 이상 읽지 않는 schema 제거는 별도 release의 새 migration으로 수행한다.
- destructive migration과 해당 app code를 같은 release에 넣지 않는다.
- D1 migration에는 일반적인 down/revert가 없다. DB 복구는 승인된 Time Travel 또는 암호화 backup restore 절차다.

## 장애와 rollback

애플리케이션 문제이고 새 migration이 additive라면 release artifact의 `versions-before.json`에 기록된 id로
Worker만 되돌린다.

```powershell
cd cloudflare-app
npx wrangler rollback <previous-version-id> --yes --message "approved incident rollback"
```

DB 데이터 손상이나 비호환 schema 문제라면 Worker rollback만으로 해결됐다고 선언하지 않는다. 변경을 중지하고
[복구 runbook](./docs/operations/D1_RESTORE_RUNBOOK.md)에 따라 별도 D1로 복원 검증 후 승인된 운영 복구를 수행한다.
모든 수동 조치는 incident 기록과 release evidence에 명령 결과·담당자·시간을 남긴다.

## 로컬 release 사전검증

```powershell
cd cloudflare-app
npm ci
npm run verify
npm run audit:dependencies
npm run release:evidence
npm run deploy:dry
```

이 명령은 운영 secret이나 원격 DB를 요구하지 않으며 실제 배포를 만들지 않는다.
