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

## 엑셀 문서대장 운영

1. 관리자 메뉴의 `엑셀 문서대장`에서 먼저 `현재 대장 엑셀 추출`을 실행한다.
2. `문서데이터` 시트의 보이는 13개 한글 열만 편집한다. 숨김 `_엑셀관리ID`, `_시스템정보`,
   `_코드값`은 삭제하거나 복사하지 않는다. 관리 파일에는 `schemaVersion`·`baseVersion`·
   `currentSnapshotId`/`exportManifestId`가 필요하다.
3. 파일 한 건을 선택하면 브라우저가 XLSX를 읽고 50행씩 전송한다. 업로드 도중에는 현재 대장이 바뀌지 않는다.
   Excel 이외의 도구에서 만든 XLSX도 표준 OOXML namespace·relationship 표현이면 호환 정규화 후 읽는다.
4. 신규·일반정보·위치·폐기·폐기 해제·유지·제외 목록과 before/after를 확인한다. 의도하지 않은
   제외·위치 이동이 있으면 반영하지 않고 파일을 수정한다.
5. 반영 사유(필수)와 승인 참조(제외·이동·폐기·대량 변경 시 필수)를 입력하고, 제외 건수를 재확인한 뒤
   `현재 대장으로 반영`을 누른다. 최종 반영은 `can_apply_document_snapshots`와 diff 기반 추가 권한이 필요하다.
6. 반영은 D1의 한 batch에서만 확정된다. 빠진 문서는 삭제하지 않고 제외 상태로 남아 감사·세트·이동 이력을 보존한다.
7. 반영 직후 다시 추출한 파일의 총 건수·대장 버전·canonical hash와 `인쇄용 관리대장`을 확인하고 내부 지류문서로 보관한다.

### 반영 mode 전환

환경 변수 `EXCEL_SNAPSHOT_APPLY_MODE`로 단계적으로 개방한다.

1. `disabled` — prepare까지 가능, apply 차단
2. `admin-only` — Admin만 apply (기본값, 값이 없거나 알 수 없으면 이보다 보수적으로 동작)
3. `permissioned` — `can_apply_document_snapshots` + diff 기반 추가 권한

### 데이터 감사와 정정

production 원본이 아니라 backup/export 사본에서 read-only 감사를 먼저 실행한다.

```powershell
cd cloudflare-app
node scripts/audit-excel-snapshot-data.mjs --db path\to\backup.sqlite --out reports\excel-snapshot-audit.json
```

감사 항목은 current identity 중복, 같은 snapshot의 update+exclude 동시 로그, 날짜 -1일 후보,
세트 내 제외 문서, 장기 staging/ready 작업이다. 자동 UPDATE/DELETE는 하지 않으며, append-only
감사로그는 삭제하지 않고 correction event로 보완한다.

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

배포 smoke 계정은 migration으로 승인된 `User`와 모든 변경 권한 `0`을 고정하고, 평문 비밀번호는 저장소·로그·PR에 남기지 않고 production Environment secret으로만 관리한다. CLI의 stdin으로 secret을 등록할 때는 값 뒤에 줄바꿈을 추가하지 않는다.

secret 값, 기본 비밀번호, 개인 계정 정보는 저장소·로그·issue·PR에 기록하지 않는다. 저장소 visibility, token 회전, 유지관리자 2단계 인증, branch protection은 운영 책임자가 수동으로 확인한다.
