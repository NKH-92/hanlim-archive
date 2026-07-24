# 한림 문서고 관리 시스템

[![CI](https://github.com/NKH-92/hanlim-archive/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NKH-92/hanlim-archive/actions/workflows/ci.yml)

한림 문서고 관리 시스템은 종이 문서의 등록, 검색, 보관 위치, 개정, 폐기와 감사이력을 한곳에서 관리하는
사내 웹 애플리케이션입니다. Cloudflare Workers와 D1을 사용하며 실제 배포 대상은
[`cloudflare-app/`](./cloudflare-app/)입니다.

- 운영 서비스: [한림 문서고](https://hanlim-archive.skarhkdgus7.workers.dev)
- 기본 브랜치: `main`
- 런타임: Cloudflare Workers + D1 + 정적 Assets
- 개발 환경: Node.js 24, 순수 JavaScript ESM
- 배포 방식: GitHub Actions + `production` Environment 승인

공개 회원가입은 제공하지 않습니다. 승인된 계정만 로그인할 수 있으며 초기 비밀번호 또는 관리자가 초기화한
임시 비밀번호로 로그인한 사용자는 새 비밀번호를 설정하기 전까지 업무 화면에 접근할 수 없습니다.
비밀번호는 사내 정책에 따라 최소 6자이며, 새로 저장하는 PBKDF2-SHA256 hash는 600,000회 반복을 사용합니다.
기존 100,000회 hash는 정상 로그인 시 자동으로 현재 형식으로 승격됩니다. Admin은 TOTP 2단계 인증을
등록하기 전에는 계정 보안 화면 외의 업무 화면에 접근할 수 없습니다.

## 주요 업무 흐름

### 문서 검색과 위치 확인

- 문서명, 문서번호, 개정번호, 대분류와 태그를 기준으로 현재 문서를 검색합니다.
- 검색 결과에서 구역, 랙, 면, 열, 선반의 실제 보관 위치를 확인합니다.
- 문서고 도면과 랙의 7열 × 6선반 시각화를 이용해 보관 위치를 확인합니다.
- 내부 식별자인 `storage_code`와 `ARC-*` 값은 검색 결과나 내보내기 파일에 노출하지 않습니다.
- 랙 번호는 구역별로 독립 운영합니다. 예를 들어 1구역 1번 랙과 2구역 1번 랙을 함께 사용할 수 있습니다.

### 문서 등록과 개별 관리

- 신규 문서를 등록하고 문서정보, 보존정보, 대분류, 태그와 위치를 관리합니다.
- 정보 수정, 위치 이동, 문서 개정, 폐기와 복구를 각각의 권한에 따라 수행합니다.
- 문서 수정과 이동은 `updated_at`과 단조 증가하는 `row_version`을 함께 검사해 동시 수정 충돌을 막습니다.
- 문서 개정은 이전본과 현재본의 연결 이력을 보존하고 이전본을 정책에 따라 처리합니다.
- 개별 변경은 즉시 현재 문서대장에 반영되며 다음 엑셀 추출에도 포함됩니다.

### 엑셀 문서대장 전체 동기화

- 현재 대장을 XLSX로 추출하고, 편집한 한 파일을 문서고 전체의 새로운 현재 대장으로 검토합니다.
- 동기화 시작 전에 10~500자의 사유를 필수로 입력하며 snapshot과 감사로그에 저장합니다.
- 신규, 일반정보 변경, 위치 변경, 폐기, 폐기 해제, 유지와 제외 항목을 반영 전에 구분해 보여줍니다.
- 최종 반영 시 저장된 동기화 사유와 최신 대장 버전을 다시 확인합니다.
- 파일에서 빠진 문서는 삭제하지 않고 `excluded` 상태로 전환해 기존 감사·이동·세트 이력을 보존합니다.
- 최종 반영은 전용 권한과 diff에 필요한 추가 권한을 모두 검사하며 D1의 한 batch에서 확정됩니다.

자세한 운영 순서는 [배포 및 운영 절차](./docs/OPERATIONS.md#엑셀-전체-동기화-운영)를 따릅니다.

### 정기폐기 캠페인

- 폐기 예정 연도와 대분류 조건으로 현재 보관 중인 전체 대상을 조회합니다.
- 화면에 표시된 검토 표본과 별개로 필터 결과 전체를 하나의 캠페인 대상으로 선택할 수 있습니다.
- 폐기 사유와 외부 승인 참조를 기록하고, 정확한 총 문서 수를 최종 확인한 뒤 실행합니다.
- 서버는 안전성과 재개 가능성을 위해 25건씩 처리하지만 운영 화면에서는 하나의 캠페인 이력으로 추적합니다.
- 네트워크 중단 후 같은 캠페인에서 재개할 수 있으며, 동결 후 변경된 문서는 자동 폐기하지 않습니다.
- 문서별 불변 감사이력과 캠페인 집계·결과 CSV를 함께 보존합니다.

자세한 절차는 [폐기 캠페인 운영 절차](./docs/DISPOSAL_WORKFLOW.md)를 확인합니다.

### 사용자, 권한과 감사

- Admin과 일반 User를 구분하고 일반 User는 `can_*` 권한을 매 요청 DB에서 다시 확인합니다.
- 사용자 승인, 사용중지, 재활성화, 권한 변경과 비밀번호 초기화는 감사로그에 남습니다.
- 로그아웃, 비밀번호 변경, 사용중지와 재활성화 시 `session_epoch`를 증가시켜 복사된 세션도 무효화합니다.
- MFA 등록·해제는 현재 비밀번호와 현재 session epoch를 다시 확인하고, 등록 만료와 동시 요청을 원자적으로 차단합니다.
- 비밀번호 또는 hash는 감사로그, 저장소, Actions 로그에 기록하지 않습니다.
- 기준정보, 문서, 이동, 세트, 폐기와 대량 작업의 이력을 추적할 수 있습니다.

## 권한 개요

Admin은 모든 권한을 가지며 일반 User는 필요한 업무 권한만 부여받습니다.

| 권한 | 대표 업무 |
|---|---|
| 기본 인증 사용자 | 검색, 문서 조회, 도면과 세트 조회 |
| `can_manage_documents` | 문서 등록·수정, 엑셀 대장 추출·검증, 데이터 품질 관리 |
| `can_move_documents` | 위치 이동과 이동 이력 |
| `can_manage_disposals` | 정기폐기 캠페인과 개별 폐기 |
| `can_manage_sets` | 문서 세트 생성·수정·잠금 |
| `can_manage_masters` | 랙, 대분류와 태그 관리 |
| `can_manage_users` | 계정 상태와 권한 관리 |
| `can_view_audit` | 전역 감사와 검색 리포트 |
| `can_apply_document_snapshots` | 엑셀 전체 대장의 최종 반영 |
| Admin | 비밀번호 초기화, 폐기 해제와 전체 시스템 관리 |

정확한 route별 권한은 [권한 운영 가이드](./docs/PERMISSIONS.md)와 자동 생성되는
[route catalog](./docs/generated/ROUTE_PERMISSION_CATALOG.md)를 사용합니다.

## 아키텍처

요청은 공개 route에서 handler, domain/application, D1 infrastructure와 view 방향으로만 흐릅니다.

```text
src/index.js
  └─ src/handlers/
       ├─ src/domains/<name>/
       │    ├─ domain/
       │    ├─ application/
       │    ├─ infrastructure/
       │    └─ web/
       ├─ src/readModels/
       └─ src/views/
src/platform/
src/shared/
```

주요 설계 원칙은 다음과 같습니다.

- 다른 도메인의 내부 구현 대신 해당 도메인의 공개 `index.js`만 사용합니다.
- 여러 도메인의 조회 조합은 `src/readModels/`에서 수행합니다.
- 모든 다중 쓰기는 감사·이력과 상태 변경을 같은 D1 batch에 둡니다.
- CSP nonce, CSRF token, trusted Origin과 서버 권한 검사를 모든 쓰기 경로에서 유지합니다.
- 검색 로직은 서버와 브라우저가 같은 `src/searchCore.js`를 사용합니다.
- 이미 공개된 migration은 수정하거나 삭제하지 않고 다음 번호의 migration만 추가합니다.

상세한 의존성 방향과 데이터 무결성 계약은 [아키텍처 및 유지보수 가이드](./docs/ARCHITECTURE.md)를
먼저 읽습니다.

## 저장소 구조

| 위치 | 역할 |
|---|---|
| `cloudflare-app/src/` | Worker runtime, domain, handler, view와 platform 코드 |
| `cloudflare-app/public/` | 배포되는 정적 CSS·JavaScript, 로고와 문서고 도면 |
| `cloudflare-app/migrations/` | append-only D1 schema와 released baseline |
| `cloudflare-app/scripts/` | 검증, browser asset build, 배포·migration guard |
| `cloudflare-app/tests/` | Node.js 계약·회귀·통합 테스트 |
| `.github/workflows/ci.yml` | PR 및 `main` 검증 |
| `.github/workflows/deploy.yml` | 승인된 D1 복구 지점·migration·Worker 배포·smoke·rollback |
| `docs/` | 아키텍처, 디자인, 권한, 운영과 복구 절차 |

`public/assets/app.css`, `app.js`, `search-core.js`, `exceljs.min.js`, `jszip.min.js`는 배포 자산입니다.
일부는 소스와 의존성에서 생성되며 `npm run check:browser`가 byte drift를 차단하므로 임의로 삭제하거나 직접
수정하지 않습니다.

## 로컬 개발

### 준비 사항

- Node.js `>=24 <25`
- npm lockfile을 사용하는 npm
- 로컬 D1을 실행할 수 있는 Wrangler

Windows PowerShell 기준:

```powershell
cd .\cloudflare-app
npm ci
Copy-Item .\.dev.vars.example .\.dev.vars
npm run db:migrate:local
npm run dev
```

Bash에서는 `Copy-Item` 대신 다음 명령을 사용합니다.

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars`의 `SESSION_SECRET`, `AUTH_HMAC_SECRET`을 서로 다른 최소 32자의 무작위 값으로,
`MFA_ENCRYPTION_KEY_V1`을 base64url 인코딩한 32바이트 키로 교체합니다. `.dev.vars`와 실제 운영
secret은 commit하지 않습니다. 로컬 기본 주소는 Wrangler가 출력하는 URL을 사용합니다.

## 주요 명령어

명령은 `cloudflare-app/`에서 실행합니다.

| 명령 | 용도 |
|---|---|
| `npm run dev` | 로컬 Worker와 D1 실행 |
| `npm run db:migrate:local` | 로컬 D1에 전체 migration 순차 적용 |
| `npm run check` | Worker와 script JavaScript 문법 검사 |
| `npm run typecheck` | `jsconfig.check.json` 기반 정적 타입 검사 |
| `npm run lint` | ESLint, warning 0 기준 검사 |
| `npm run format:check` | 저장소 형식 규칙 검사 |
| `npm run check:migrations` | migration 순서, checksum, schema와 FK 검사 |
| `npm run check:routes` | route/permission catalog drift 검사 |
| `npm run build:browser` | 브라우저 정적 자산 생성 |
| `npm run check:browser` | 생성된 브라우저 자산과 소스 일치 검사 |
| `npm test` | 전체 Node.js 테스트 실행 |
| `npm run verify` | type, lint, format, migration, route, asset와 테스트 전체 검증 |
| `npm run audit:dependencies` | high 이상 dependency 취약점 검사 |
| `npm run release:evidence` | migration·schema release evidence 생성 |
| `npm run deploy:dry` | 운영 대상과 bundle을 검증하되 실제 배포하지 않음 |

일반 변경의 최종 확인:

```powershell
cd .\cloudflare-app
npm run verify
npm run audit:dependencies
```

## 변경과 PR 규칙

1. 최신 `main`에서 `agent/<짧은-설명>` 기능 브랜치를 만듭니다.
2. 커밋과 PR 제목은 `feat:`, `fix:`, `docs:`, `test:`, `chore:` 중 변경 성격에 맞는 접두사를 사용합니다.
3. migration은 항상 append-only이며 기존 SQL, checksum과 released baseline 이력을 임의로 바꾸지 않습니다.
4. 변경한 소스에 맞춰 테스트, 생성 자산과 운영 문서를 함께 갱신합니다.
5. PR에서 `required / verify`가 통과한 뒤 squash merge합니다.
6. 병합된 작업 브랜치는 삭제하고 PR은 변경·승인·배포 근거로 보존합니다.

PR 작성 시 [pull request template](./.github/pull_request_template.md)의 영향, 보안, migration, 검증과
rollback 항목을 작성합니다. `main`에 직접 push하거나 force push하지 않습니다.

## CI와 운영 배포

PR과 `main`의 변경은 CI에서 다음 항목을 검사합니다.

- released migration 기준선과 과거 migration 불변성
- 문법, 타입, lint, format, route와 browser asset
- 전체 테스트와 dependency audit
- Worker production dry-run과 release evidence

`main`에 병합된 `cloudflare-app/**` 또는 운영 배포 workflow 변경은 `production` Environment 승인을 거쳐
다음 순서로 처리됩니다.

1. release source 재검증과 migration evidence 생성
2. 현재 100% traffic Worker와 독립 Admin 확인
3. Core·Search D1 Time Travel 복구 지점 기록
4. 현재 운영 로그인·검색 smoke
5. append-only migration 적용
6. Worker를 production에 직접 배포
7. 운영 URL의 readiness·asset·로그인·검색·사용자 관리 smoke
8. 실패 시 기록된 이전 Worker version으로 rollback
9. 복구 지점·배포·smoke·rollback evidence 보존

README와 `docs/**`처럼 실행 코드에 영향을 주지 않는 변경만 병합하면 운영 배포는 실행하지 않습니다.
로컬에서 원격 migration 또는 production 배포를 실행하지 않습니다.

## 복구와 장애 대응

- 운영 migration 전에 같은 실행에서 생성한 Core·Search D1 Time Travel bookmark가 반드시 존재해야 합니다.
- Worker 오류이면서 migration이 호환되면 기록된 정확한 이전 Worker version으로 rollback합니다.
- 데이터 손상이나 비호환 schema 문제는 Worker rollback만으로 완료하지 않고 복구 절차를 시작합니다.
- 복구 bookmark, release SHA와 Worker version을 운영 증거로 보존합니다.

상세 절차:

- [배포 및 운영 절차](./docs/OPERATIONS.md)
- [D1 복구 절차](./docs/BACKUP_RESTORE.md)

## 문서

- [아키텍처 및 유지보수 가이드](./docs/ARCHITECTURE.md)
- [UI 디자인 규칙](./docs/DESIGN.md)
- [배포 및 운영 절차](./docs/OPERATIONS.md)
- [D1 백업·복구 절차](./docs/BACKUP_RESTORE.md)
- [권한 운영 가이드](./docs/PERMISSIONS.md)
- [폐기 캠페인 운영 절차](./docs/DISPOSAL_WORKFLOW.md)
- [개선 백로그](./docs/ROADMAP.md)
- [자동 생성 route/permission catalog](./docs/generated/ROUTE_PERMISSION_CATALOG.md)

## 보안 주의사항

- 기본·임시 비밀번호, 실제 계정, token, cookie, D1 export와 `.dev.vars`를 저장소·issue·PR에 기록하지 않습니다.
- 비밀번호 초기화 값은 서버에서만 hash하고 감사로그에는 작업자·대상·세션 상태만 기록합니다.
- 운영 계정은 최소권한과 2단계 인증을 사용하고 승인 사용자·권한을 정기 검토합니다.
- `security_review_required` 계정은 일반 승인으로 복구하지 않고 별도의 보안 검토·credential 재발급 절차를
  사용합니다.
- 저장소가 공개되어 있어도 운영 데이터와 자격증명은 공개 대상이 아닙니다.
