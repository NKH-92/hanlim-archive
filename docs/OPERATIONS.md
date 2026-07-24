# 배포 및 운영 절차

운영 resource 이름과 binding은 `cloudflare-app/wrangler.jsonc`를 단일 출처로 사용한다. 운영 변경은 GitHub Actions의 `Deploy Production` workflow로만 수행하며, 로컬에서 원격 migration이나 production deploy를 실행하지 않는다.

`main`에 병합된 `cloudflare-app/**` 또는 `.github/workflows/deploy.yml` 변경만 자동 운영 배포를 시작한다.
README, `docs/**`, PR template와 Git 관리 파일만 바뀐 문서·저장소 정리 commit은 CI로 검증하되 운영 D1
migration·Worker 배포를 실행하지 않는다. 수동 `workflow_dispatch`는 위 경로와 관계없이 production
Environment 승인 후 실행할 수 있다.

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

`.dev.vars`에는 서로 다른 최소 32자의 무작위 `SESSION_SECRET`, `AUTH_HMAC_SECRET`을 넣고 commit하지 않는다.
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`로 각 값을
별도로 생성할 수 있다. migration은 로컬에서도 번호 순서대로 전체 적용하며 기존 파일을 수정하지 않는다.

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
2. 현재 100% traffic Worker version id와 metadata를 rollback 대상으로 기록한다.
3. 독립 Admin 존재와 현재 Worker의 health·version·session-epoch 호환 marker를 확인한다.
4. Core와 Search D1의 현재 Time Travel bookmark를 각각 기록하고 release SHA·run ID·database ID와 함께
   pre-mutation artifact로 보존한다.
5. append-only migration을 적용하고 독립 Admin 존재를 다시 확인한다.
6. 신규 schema가 적용된 뒤 release run 전용 read-only 계정과 `can_manage_users`만 가진 일반 User 계정을
   무작위 credential로 생성하고, 이전 Worker에서 실제 로그인·검색·`/admin/settings`를 확인한다.
7. release SHA tag·message를 붙여 Worker를 production에 직접 배포한다.
8. `/healthz`, `/readyz`, Worker version, 전송·asset·로그인·검색·사용자 관리 smoke를 실행한다.
9. Worker 배포 또는 smoke 실패 시 기록한 이전 100% traffic version으로 되돌리고 같은 인증 smoke를 실행한다.
10. 성공·실패와 관계없이 release 전용 계정을 제거하고 복구 지점·migration·배포·smoke·rollback 증거를
   release artifact로 보존한다.

배포는 `d1-production-maintenance` concurrency group에서 직렬화한다. D1 Time Travel 복구는 데이터 변경을
되돌리는 파괴적 작업이므로 자동 rollback하지 않고 [D1 복구 절차](./BACKUP_RESTORE.md)에 따라 별도 승인한다.

## Migration과 rollback

- additive 변경은 expand migration을 먼저 적용하고 이전 Worker와 함께 동작해야 한다.
- schema 제거는 이전 Worker가 더 이상 사용하지 않는 별도 release의 새 contract migration으로 수행한다.
- destructive migration과 의존하는 application code를 같은 release에 넣지 않는다.
- 인증·권한 schema는 rollback 대상 Worker도 이해해야 한다. 로그아웃·비밀번호 변경·사용중지·재활성화가
  `session_epoch`를 증가시키는지 migration 전후 smoke로 확인한다.
- 기준정보의 `row_version`과 개정 링크 보호 trigger는 이전 Worker의 쓰기에도 적용되어 rollback 중 stale update, 이전본 복원, linked identity 변경·삭제를 DB에서 차단한다.
- D1 migration에는 일반적인 down migration이 없다. 애플리케이션 문제이고 migration이 호환될 때만 이전 Worker version으로 rollback한다.
- 데이터 손상이나 비호환 schema 문제는 Worker rollback만으로 완료 처리하지 않고 [백업·복구 절차](./BACKUP_RESTORE.md)를 시작한다.

## 운영 확인

배포 후 아래 항목을 확인한다.

- HTTP `/login`의 HTTPS 308 전환, TLS 1.2 미만의 애플리케이션 차단
- `/healthz` 200와 기대한 `workerVersion`·`rollbackCompatibility.sessionEpoch`, `/login` 200, `/signup` 404
- `/assets/app.css`, `/assets/app.js`, 로고의 상태·MIME와 `If-None-Match` 304 재검증
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
2. **문서 등록·개별 관리**: 전역 `+ 문서 등록` 동작에서 신규 문서를 등록하고, `/app` 문서 작업 공간에서 정보 수정·개정·위치 이동·폐기를 시작한다. 이 변경은 즉시 현재 대장에 포함되며 다음 엑셀 추출의 `문서데이터`와 `인쇄용 관리대장`에도 함께 반영된다.

문서 추가나 개별 관리가 한 건이라도 발생하면 이전에 추출한 엑셀의 `baseVersion`은 오래된 상태가 된다. 일괄
동기화를 다시 하려면 최신 대장을 새로 추출한다. 동일 바인더의 개정본 교체는 전용 `문서 개정`으로 처리하고
이전본은 자동 폐기한다. 다른 바인더에 들어오는 개정 문서는 `+ 문서 등록`으로 등록한다.

## 엑셀 전체 동기화 운영

1. 업무 메뉴의 `엑셀 대장 동기화`에서 먼저 `현재 대장 엑셀 추출`을 실행한다.
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

## 최초 10,000건 운영전환

### 배포 전 외부 설정

1. Cloudflare 계정에 Core D1과 별도의 `hanlim-archive-search-10k` D1을 만든다.
2. `wrangler.jsonc`의 `SEARCH_DB` placeholder를 실제 UUID로 바꾸고 GitHub repository/environment variable
   `SEARCH_D1_TARGET_DATABASE_ID`에도 같은 값을 등록한다. placeholder 상태에서는 guarded migrate/deploy가
   fail-closed해야 정상이다.
3. 계정의 D1 database 슬롯과 Cron Trigger 슬롯을 확인한다. Worker는 5분마다 Search outbox를 먼저 최대
   25건 배출하고 이어서 재구축 100건을 처리한다. processor와 행별 lease는 2분 뒤 만료되어 중단된 실행을
   다음 Cron이 회수한다. 개별 문서 등록은 응답 전에 대상 outbox 1건을 먼저 반영하며, Search 장애나
   전체 재구축 중에는 outbox를 유지해 이 Cron이 재처리한다. 엑셀 전체 동기화는 기존 청크 경로를 유지한다.
4. Core와 Search D1의 Time Travel 사용 가능 여부와 7일 보존 기간을 확인한다. 별도 object storage는
   무료티어 운영 범위에 포함하지 않는다.

로컬 schema 검증은 두 migration chain을 모두 적용한다.

```powershell
cd cloudflare-app
npm run db:migrate:local
npm run db:migrate:search:local
npm run check:migrations
```

### 데이터·용량 계약

- 최초 승인 파일은 정확히 10,000행이며 SHA-256, 승인 참조, 검색 정답 표본을 별도 증적으로 보존한다.
- 11,000건은 운영 경고, 12,000건은 기술 상한이다. 12,001번째 등록·재포함·snapshot apply는 DB trigger가
  전체 transaction을 차단한다.
- schema v2 XLSX의 N~P 숨김 열은 관리 ID, 기준 행 버전, 기준 행 SHA-256이다. 전체 membership은 요청당
  1,000행, 실제 변경행은 50행씩 전송한다. 관리 snapshot의 신규+변경+제외 영향은 1,000건 이하여야 한다.
- 초기 적재는 Cloudflare Dashboard의 당일 계정 전체 `rows_written`을 먼저 확인한다. 내부 정지선은
  00:00 UTC 기준 70,000이며 초과 예상 시 다음 UTC 일자로 넘긴다. 임시 Paid 전환은 사용하지 않는다.

### 전환·검색 확인

1. 신규 Core에 migration manifest의 전체 chain(`0001~0043`), Search에
   `search-migrations/0001~0003`을 순서대로 적용한다. Search `0003` 적용 뒤에는 부분 생성된
   무토큰 shadow generation을 폐기하고 active generation을 유지한 채 재구축이 다시 시작되는 것이 정상이다.
2. 승인 파일을 bootstrap으로 검증하고 문서 수, identity, FK, 분류·상태·위치·태그 집계와 canonical hash를 대조한다.
3. Search 재구축 상태가 `ready`, indexed count가 10,000, outbox가 0인지 관리 화면과 `/readyz`에서
   확인한다. `building_generation`, `rebuild_token`, `cutover_generation`은 모두 비어 있어야 하고
   `previous_active_generation`은 직전 정상 generation을 가리켜야 한다.
4. 새로 추출한 schema v2 XLSX를 무수정 재업로드해 update/create/exclude가 모두 0인지 확인한다.
5. 정확 문서번호, 일반 검색, 오래된 문서, 초성·한영 자판 표본, cursor `더보기`, Search 장애 fallback을 시험한다.
6. 병합 전 `npm run verify`, `npm run deploy:dry`, D1 Time Travel 복구 절차와 Search 재구축 훈련을 완료한다.

쓰기 개방 전 rollback은 이전 100% Worker와 이전 Core binding으로 돌아간다. 쓰기 개방 후에는 이전 Core로
되돌리지 않고 신규 Core 호환 Worker로 rollback한다. Search 장애는 Core를 유지한 채 fallback 후 재구축한다.
기존 Worker/Core는 최소 7일과 안정화 승인 중 더 긴 기간까지 삭제하지 않는다.

## 월별 무료티어 점검

현재 기준 Workers Free는 일 100,000 요청, D1 Free는 일 5백만 행 읽기·10만 행 쓰기,
계정 총 5GB·DB당 500MB와 7일 Time Travel을 제공한다. 한도는 변경될 수 있으므로
[Workers 한도](https://developers.cloudflare.com/workers/platform/limits/)와
[D1 한도](https://developers.cloudflare.com/d1/platform/limits/)를 월별 점검 때 함께 확인한다.
5분 Cron은 일 288회로 Worker 요청 한도의 0.3% 미만이며 Search outbox와 재구축 지연을 제한하기 위해 유지한다.

| 항목 | 확인 위치 | 경고 시 조치 |
|---|---|---|
| Worker 요청·오류율·CPU | Cloudflare Dashboard의 Worker Metrics | request ID와 최근 배포 확인 |
| D1 읽기·쓰기·DB 크기 | Cloudflare Dashboard의 D1 Metrics | 대량 작업 중지, 쿼리·인덱스 검토 |
| Actions 사용량 | GitHub Billing의 Actions | 중복 실행과 불필요한 artifact 정리 |
| D1 복구 | Time Travel과 release artifact | Core·Search bookmark, 7일 보존 기간, 복구 승인 절차 확인 |
| 검색 index | 앱 관리 화면 | 경고 기준에서 크기 추적, 상한에서 구조 재검토 |

월 1회 `/healthz`·`/readyz`와 검색·상세 표본, 데이터 품질 작업목록, 유지관리자 접근권한, API token 최소권한을 함께 점검한다. 엑셀 대장 반영 전후에는 최근 백업·대장 버전·행 수·추가/변경/제외와 감사로그를 확인하고, 폐기 캠페인 전후에는 대상 확정 건수·승인 참조·감사로그·결과 CSV를 대조한다.

## 문서 작업 공간 호환 계약

- 대표 문서 주소는 `/app`이다. 기존 `GET /documents`는 검색·필터 쿼리를 보존해 `/app`으로 302 연결하고, `POST /documents` 등록 주소는 유지한다.
- `GET /sets`는 `q`, `status`, `sort`를 받는다. `status`는 `all/editable/locked/disposed/excluded`, `sort`는 `updated/created/name`만 허용한다.
- `POST /sets/:id/add`는 검증된 `expectedRowVersion`과 최대 200개의 `documentIds`를 사용한다. `/app` 복귀 주소만 `returnTo`로 허용한다.
- `GET/POST /sets/:id/clone`은 원본 `row_version`을 다시 검사한 뒤 구성원·세트 이력·시스템 감사를 한 batch에서 기록한다. 새 세트는 잠기지 않은 상태다.
- 폐기 작업 공간은 `/documents/disposal?tab=active|history|documents`를 사용한다. 기존 `/disposal-batches` 목록은 캠페인 이력 탭으로 302 연결하고 상세·생성 주소는 유지한다.
- 이 호환 변경에는 새 테이블·컬럼·migration이 없다. CSRF, Origin, 권한, 행 버전 검사는 기존 서버 경계를 그대로 사용한다.

## 최초·수동 운영 설정

저장소 관리자는 GitHub UI에서 PR 승인, CODEOWNERS, required check `required / verify`, direct/force push 금지와 production Environment reviewer를 설정한다. Actions에는 값이 아니라 다음 secret 이름과 최소 scope만 관리한다.

- repository secret `CLOUDFLARE_API_TOKEN`: 대상 Worker deploy·version 조회·rollback과 Core·Search
  migration·release 전용 계정 생성·삭제에 필요한 권한만 부여한다. workflow는 필요한 step에만 이 값을 전달한다.
- `ADMIN_PROVISION_USERNAME`, `ADMIN_PROVISION_DISPLAY_NAME`, `ADMIN_PROVISION_PASSWORD`: 독립 Admin을 최초 1회 생성할 때만 사용하는 production Environment secret. 시스템 비밀번호 정책에 따라 6자 이상으로 둔다.

Worker 런타임에는 Wrangler의 운영 환경 secret으로 다음 값을 각각 별도 생성해 등록한다.

- `SESSION_SECRET`: 세션 서명용, 최소 32자
- `AUTH_HMAC_SECRET`: 로그인 제한 식별자용, 최소 32자

두 값은 서로 재사용하지 않는다.

배포 smoke 계정은 run마다 무작위 reader와 `can_manage_users`만 가진 일반 User로 생성하고 credential은
runner 임시 파일에만 둔다. 두 계정의 TTL은 45분이며 workflow는 성공·실패와 관계없이 `always()` cleanup을
실행한다. 다음 release의 사전 정리와 Cron janitor도 만료 계정을 제거한다. cleanup 실패는 운영 사고로
취급해 `approved_by = release-smoke:<operation-id>` 계정을 즉시 격리한다.

비밀번호 최소 길이는 6자를 유지하고, 신규 hash는 PBKDF2-SHA256 600,000회 반복을 사용한다.
기존 100,000회 record는 성공 로그인 시 자동 승격한다. 로그인 실패 제한과 session epoch 기반 세션
무효화는 계속 적용한다.

최초 또는 복구 환경에서 독립 Admin이 없으면 production Environment reviewer 승인 후 `Provision Independent Admin` workflow를 한 번 실행한다. 이 workflow는 알려진 bootstrap·smoke 사용자명을 거부하고, 대상 환경·D1 ID를 확인한 뒤 기존 계정을 덮어쓰지 않는 INSERT만 수행한다. 배포 workflow는 migration 전후에 승인된 독립 Admin 존재를 확인하고, 배포 전후 해당 계정으로 `/admin/settings` 접근까지 smoke한다.

운영 migration은 같은 run에서 생성한 Core·Search Time Travel bookmark 증빙의 database ID, run ID,
commit SHA와 production Environment 승인 context가 모두 일치할 때만 guarded wrapper가 실행한다.
GitHub artifact에는 DB 데이터가 아니라 bookmark와 release metadata만 올린다. raw
`wrangler d1 migrations apply`와 unscoped `wrangler deploy`는 운영 절차로 사용하지 않는다.

secret 값, 기본 비밀번호, 개인 계정 정보는 저장소·로그·issue·PR에 기록하지 않는다. 저장소 visibility, token 회전, 유지관리자 접근권한, branch protection은 운영 책임자가 수동으로 확인한다.
