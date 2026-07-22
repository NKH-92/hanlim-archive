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
$env:CLOUDFLARE_ENV = "production"
$env:D1_TARGET_DATABASE_ID = "1262ca00-b431-490c-aad2-539d77d4f73f"
npm run deploy:dry
```

`deploy:dry`는 운영 secret이나 원격 D1을 요구하지 않고 실제 배포를 만들지 않지만, 의도한 Wrangler environment와 D1 ID를 명시해야 한다. PR의 `required / verify`는 같은 검증, dependency audit, migration·schema evidence, Worker bundle report를 보존한다. CI는 PR base SHA의 `released-baseline.json`과 비교해 이미 공개된 migration SQL·checksum·schema 기준선의 동시 수정을 차단한다.

## 운영 배포 흐름

`main` 병합 후 production Environment 승인이 있어야 한 SHA에 대해 다음 순서로 진행한다.

1. 같은 SHA를 다시 검증하고 release evidence를 생성한다.
2. 현재 100% traffic Worker version id와 metadata를 기록하고, 독립 read-only 계정과 독립 Admin으로 실제 로그인·검색·`/admin/settings`를 확인한다.
3. `/healthz`의 `rollbackCompatibility.sessionEpoch`를 확인한다. 최초 도입 release에서 marker가 없으면 migration 전에 정확한 직전 운영 소스에서 session-epoch 호환 Worker를 만들고, 구 schema와 신규 schema 양쪽 실행 검증과 dry-run을 통과시킨 뒤 **migration 없이 먼저 배포**한다. 이 version을 rollback 대상으로 기록한다.
4. 운영 D1을 export하고 upgrade readiness를 검사한다. 현재 문서 identity 중복이나 FK 위반이 있어 readiness가 실패해도 먼저 암호화 backup과 checksum을 업로드한 뒤 release를 차단한다.
5. append-only migration을 적용하고 독립 Admin 존재를 다시 확인한다.
6. release SHA tag·message가 붙은 Worker를 배포하고 새 100% traffic version id를 기록한다.
7. `/healthz`의 compatibility marker와 `workerVersion`, `/login`, `/signup` 404, 승인된 read-only 검색, 독립 Admin의 `/admin/settings`를 smoke-test한다.
8. smoke 실패 시 기록한 epoch-aware rollback version으로 되돌리고, 100% traffic version id와 동일한지 확인한 뒤 같은 smoke를 다시 실행한다.
9. source·migration·backup·deploy·smoke·rollback·version 증거를 release artifact로 보존한다.

backup 업로드 전에 migration을 실행하지 않는다. 최초 compatibility Worker도 migration 전에만 배포하며, 실패하면 원래 Worker version으로 되돌린 뒤 release를 중단한다. 배포와 주간 백업은 `d1-production-maintenance` concurrency group으로 직렬화한다.

### 최초 session-epoch 호환 release

호환 marker가 아직 없는 운영 환경에서는 일반 `workflow_dispatch`가 아니라 정확한 `main` push run만 사용한다. 해당 push는 `github.event.before`가 release commit의 첫 번째 parent와 같은 단일 release 경계여야 한다. 운영 담당자는 현재 100% traffic Worker의 검증된 빌드·배포 증거에서 source SHA를 확인해 production Environment variable `PRODUCTION_SOURCE_SHA`에 기록한다. 값이 `github.event.before`와 다르거나 provenance를 입증할 수 없으면 추정하지 말고 release를 중단한다.

workflow는 그 SHA를 detached worktree로 checkout하고, 허용된 인증·health·Wrangler 설정 파일만 exact transform한다. 변환 결과의 파일 목록·hash, dual-schema 실행 검증, bundle dry-run, 배포 version을 증거로 남긴다. compatibility marker가 확인된 뒤에는 이 bootstrap 경로를 다시 실행하지 않는다.

## Migration과 rollback

- additive 변경은 expand migration을 먼저 적용하고 이전 Worker와 함께 동작해야 한다.
- schema 제거는 이전 Worker가 더 이상 사용하지 않는 별도 release의 새 contract migration으로 수행한다.
- destructive migration과 의존하는 application code를 같은 release에 넣지 않는다.
- 인증·권한 schema는 rollback 대상 Worker도 이해해야 한다. `session_epoch` 최초 도입은 위 compatibility Worker를 먼저 배포하고, 이후 로그아웃·비밀번호 변경·사용중지·재활성화가 epoch를 증가시키는지 확인한다.
- 기준정보의 `row_version`과 개정 링크 보호 trigger는 이전 Worker의 쓰기에도 적용되어 rollback 중 stale update, 이전본 복원, linked identity 변경·삭제를 DB에서 차단한다.
- D1 migration에는 일반적인 down migration이 없다. 애플리케이션 문제이고 migration이 호환될 때만 이전 Worker version으로 rollback한다.
- 데이터 손상이나 비호환 schema 문제는 Worker rollback만으로 완료 처리하지 않고 [백업·복구 절차](./BACKUP_RESTORE.md)를 시작한다.

## 운영 확인

배포 후 아래 항목을 확인한다.

- `/healthz` 200와 기대한 `workerVersion`·`rollbackCompatibility.sessionEpoch`, `/login` 200, `/signup` 404
- 미인증 업무 경로의 로그인 redirect
- 승인 계정의 검색·문서 상세 read-only 표본
- 독립 Admin의 `/admin/settings` 200과 실제 사용자 관리 marker
- migration pending 0과 release 대상 SHA
- Worker 오류율과 D1 오류, console JavaScript 오류, CSP 위반 부재

장애가 발생하면 변경을 중지하고 release SHA·Worker version·migration 결과·request ID를 확보한다. 애플리케이션 오류인지 데이터 손상인지 구분한 뒤 Worker rollback 또는 복구 절차를 선택한다.

## 문서 리스트 반영 방식

문서대장에는 다음 두 방식으로 기록을 반영한다.

1. **엑셀 전체 동기화**: 업로드한 한 파일을 문서고의 완전한 현재 대장으로 간주한다. 엑셀에 없는 문서는
   hard delete하지 않고 `excluded`로 전환한다. 정기 일괄 현행화에만 사용한다.
2. **문서 추가·개별 관리**: 별도 `문서 추가` 탭에서 신규 문서를 등록하고, `문서 관리`에서 정보 수정·개정·위치 이동·폐기를 건별로 처리한다. 이 변경은 즉시 현재 대장에 포함되며 다음 엑셀 추출의 `문서데이터`와 `인쇄용 관리대장`에도 함께 반영된다.

문서 추가나 개별 관리가 한 건이라도 발생하면 이전에 추출한 엑셀의 `baseVersion`은 오래된 상태가 된다. 일괄
동기화를 다시 하려면 최신 대장을 새로 추출한다. 동일 바인더의 개정본 교체는 전용 `문서 개정`으로 처리하고
이전본은 자동 폐기한다. 다른 바인더에 들어오는 개정 문서는 `문서 추가`로 등록한다.

## 엑셀 전체 동기화 운영

1. 관리자 메뉴의 `리스트 동기화`에서 먼저 `현재 대장 엑셀 추출`을 실행한다.
2. `문서데이터` 시트의 보이는 13개 한글 열만 편집한다. 숨김 `_엑셀관리ID`, `_시스템정보`,
   `_코드값`은 삭제하거나 복사하지 않는다. 관리 파일에는 `schemaVersion`·`baseVersion`·
   `currentSnapshotId`/서버 발급 `exportManifestId`가 필요하다. manifest는 발급 당시 버전·현재 snapshot·작업자 정책과
   일치할 때만 사용할 수 있다.
3. 파일 한 건을 선택하면 브라우저가 XLSX를 읽고 50행씩 전송한다. 원본 파일은 10MB, ZIP 비압축 합계는 50MB,
   ZIP 항목은 500개가 상한이다. 업로드 도중에는 현재 대장이 바뀌지 않는다.
   Excel 이외의 도구에서 만든 XLSX도 표준 OOXML namespace·relationship 표현이면 호환 정규화 후 읽는다.
4. 신규·일반정보·위치·폐기·폐기 해제·유지·제외 목록과 before/after를 확인한다. 의도하지 않은
   제외·위치 이동이 있으면 반영하지 않고 파일을 수정한다.
   검증 오류는 앞의 20건을 화면에서 확인하고 전체 오류 CSV를 내려받을 수 있다.
   개정 이력에 연결된 문서번호·개정번호 변경과 개정으로 자동 폐기된 이전본의 폐기 해제는 거부되므로
   각각 `문서 개정` 또는 현재 개정본 확인 절차를 사용한다.
5. 반영 사유(필수)와 승인 참조(제외·이동·폐기·폐기 해제·identity 변경·대량 변경 시 필수)를 입력하고, 제외 건수를 재확인한 뒤
   `현재 대장으로 반영`을 누른다. 최종 반영은 `can_apply_document_snapshots`와 diff 기반 추가 권한이 필요하다.
6. 반영은 D1의 한 batch에서만 확정된다. 빠진 문서는 삭제하지 않고 제외 상태로 남아 감사·세트·이동 이력을 보존한다.
7. 반영 직후 다시 추출한 파일의 총 건수·대장 버전·canonical hash와 `인쇄용 관리대장`을 확인하고 내부 지류문서로 보관한다.

시스템 정보가 없는 최초 파일은 예외적인 bootstrap 경로다. Admin이 운영 backup과 복구 가능 여부를 확인한 뒤
`BOOTSTRAP` 문구를 정확히 입력해야 하며, 서버가 이 두 확인값을 다시 검증하고 감사로그에 남긴다. 이미 현재 snapshot이
있으면 두 번째 bootstrap은 거부한다.

### 반영 mode 전환

환경 변수 `EXCEL_SNAPSHOT_APPLY_MODE`로 단계적으로 개방한다.

1. `disabled` — prepare까지 가능, apply 차단
2. `admin-only` — Admin만 apply (기본값, 값이 없거나 알 수 없으면 이보다 보수적으로 동작)
3. `permissioned` — `can_apply_document_snapshots` + diff 기반 추가 권한

### 데이터 감사와 정정

production 원본이 아니라 backup/export 사본에서 read-only 감사를 먼저 실행한다.

```powershell
cd cloudflare-app
node scripts/audit-excel-snapshot-data.mjs --db path\to\backup.sqlite --out reports\excel-snapshot-audit.json --abandoned-days 7
```

감사 항목은 current identity 중복, 필수 날짜·폐기년도 누락, 같은 snapshot의 update+exclude 동시 로그,
현재·legacy 감사 payload의 날짜 -1일 후보, 세트 내 제외 문서, 장기 staging/ready 작업, snapshot 기준 movement 누락 후보,
폐기 해제 후보와 완료 snapshot count 불일치다. 자동 UPDATE/DELETE는 하지 않으며, append-only
감사로그는 삭제하지 않고 correction event로 보완한다.

감사에서 확인한 장기 `staging`/`ready` 작업은 상세 화면의 `반영 전 작업 취소`로 정리한다. 이 작업은 문서·태그·위치에
손대지 않고 snapshot만 `cancelled`로 바꾸며, 상태 변경 전에 system audit를 남긴다. 완료·반영 중·실패 작업은 취소할 수 없다.

추출 뒤 다른 사용자가 문서·태그·대분류·랙을 바꾸면 기존 파일은 오래된 버전이 된다. 오래된 파일은
서버가 반영하지 않으므로 최신 대장을 다시 추출해 편집한다. 반영 오류는 D1 batch rollback 대상이며
기존 대장은 유지된다. 잘못된 내용을 확인 후 반영한 경우 이전 스냅샷 before/exclusion과 운영 백업을
근거로 복구 파일을 만들고, 데이터 손상이 의심되면 [백업·복구 절차](./BACKUP_RESTORE.md)를 시작한다.

## 월별 무료티어 점검

| 항목 | 확인 위치 | 경고 시 조치 |
|---|---|---|
| Worker 요청·오류율·CPU | Cloudflare Dashboard의 Worker Metrics | request ID와 최근 배포 확인 |
| D1 읽기·쓰기·DB 크기 | Cloudflare Dashboard의 D1 Metrics | 대량 작업 중지, 쿼리·인덱스 검토 |
| Actions 사용량 | GitHub Billing의 Actions | 중복 실행과 불필요한 artifact 정리 |
| 백업 artifact | GitHub Actions의 D1 Backup | 최근 성공과 암호화 파일·checksum만 존재하는지 확인 |
| 검색 index | 앱 관리 화면 | 경고 기준에서 크기 추적, 상한에서 구조 재검토 |

월 1회 `/healthz`와 검색·상세 표본, 데이터 품질 작업목록, 유지관리자·2단계 인증, API token 최소권한을 함께 점검한다. 엑셀 대장 반영 전후에는 최근 백업·대장 버전·행 수·추가/변경/제외와 감사로그를 확인하고, 폐기 캠페인 전후에는 동결 건수·승인 참조·감사로그·결과 CSV를 대조한다.

## 최초·수동 운영 설정

저장소 관리자는 GitHub UI에서 PR 승인, CODEOWNERS, required check `required / verify`, direct/force push 금지와 production Environment reviewer를 설정한다. Actions에는 값이 아니라 다음 secret 이름과 최소 scope만 관리한다.

- 배포용 `CLOUDFLARE_API_TOKEN`: 대상 Worker와 D1 변경에 필요한 최소권한
- 백업용 `CLOUDFLARE_D1_BACKUP_API_TOKEN`: 원격 export에 필요한 대상 D1 Write/Edit 전용, 배포 토큰과 분리
- `D1_BACKUP_PASSPHRASE`: 32자 이상 백업 전용 무작위 값
- `SMOKE_USERNAME`, `SMOKE_PASSWORD`: 변경 권한이 없는 승인된 smoke 계정
- `SMOKE_ADMIN_USERNAME`, `SMOKE_ADMIN_PASSWORD`: 알려진 bootstrap 사용자명과 다른 승인된 독립 Admin 계정
- `ADMIN_PROVISION_USERNAME`, `ADMIN_PROVISION_DISPLAY_NAME`, `ADMIN_PROVISION_PASSWORD`: 독립 Admin을 최초 1회 생성할 때만 사용하는 production Environment secret. 비밀번호는 16자 이상으로 둔다.

최초 session-epoch compatibility release에만 production Environment variable `PRODUCTION_SOURCE_SHA`를 사용한다. 현재 100% traffic Worker의 source provenance로 확인한 40자 Git SHA만 기록하며 secret 값으로 취급하거나 임의의 직전 commit으로 추정하지 않는다.

배포 smoke 계정은 migration으로 승인된 `User`와 모든 변경 권한 `0`을 고정하고, 평문 비밀번호는 저장소·로그·PR에 남기지 않고 production Environment secret으로만 관리한다. CLI의 stdin으로 secret을 등록할 때는 값 뒤에 줄바꿈을 추가하지 않는다.

최초 또는 복구 환경에서 독립 Admin이 없으면 production Environment reviewer 승인 후 `Provision Independent Admin` workflow를 한 번 실행한다. 이 workflow는 알려진 bootstrap·smoke 사용자명을 거부하고, 대상 환경·D1 ID를 확인한 뒤 기존 계정을 덮어쓰지 않는 INSERT만 수행한다. 배포 workflow는 migration 전후에 승인된 독립 Admin 존재를 확인하고, 배포 전후 해당 계정으로 `/admin/settings` 접근까지 smoke한다.

운영 migration은 같은 job에서 생성·업로드한 암호화 backup artifact의 ID와 digest, 현재 run ID와 commit SHA, production Environment 승인 context가 모두 일치할 때만 guarded wrapper가 실행한다. raw `wrangler d1 migrations apply`와 unscoped `wrangler deploy`는 운영 절차로 사용하지 않는다.

secret 값, 기본 비밀번호, 개인 계정 정보는 저장소·로그·issue·PR에 기록하지 않는다. 저장소 visibility, token 회전, 유지관리자 2단계 인증, branch protection은 운영 책임자가 수동으로 확인한다.
