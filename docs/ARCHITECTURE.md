# 아키텍처 및 유지보수 가이드

이 문서는 코드 수정 전에 반드시 읽는다. UI 시각 규칙은 [DESIGN.md](./DESIGN.md), 운영 절차는
[OPERATIONS.md](./OPERATIONS.md), 권한 정책은 [PERMISSIONS.md](./PERMISSIONS.md)를 따른다.

## 의존성 방향

요청은 위에서 아래로만 흐른다.

```text
src/index.js                 공개 경로, 세션, CSRF, 보안 헤더, 전역 오류 경계
  └─ src/handlers/           route registry 결과를 use case와 view에 연결
       ├─ src/domains/<name>/index.js
       │    ├─ domain/       순수 정책, 상태 machine, 값 규칙
       │    ├─ application/  use case와 port
       │    ├─ infrastructure/ D1 query, command, BatchPlan
       │    └─ web/          parser, presenter, 도메인 전용 view
       ├─ src/readModels/    여러 도메인을 조합하는 명시적 read model
       └─ src/views/         공용 shell과 페이지 조립
src/platform/                D1, HTTP, crypto, security, observability 구현
src/shared/                  업무 의미가 없는 text, CSV, pagination, coercion
```

- 다른 도메인은 상대 도메인의 내부 파일 대신 공개 `index.js`만 import한다.
- cross-domain dashboard/report는 `src/readModels/`에서 조합한다.
- `platform/`은 업무 도메인을 import하지 않는다.
- 삭제된 전역 façade `db.js`, `html.js`, `utils.js`를 다시 만들거나 import하지 않는다.
- Workers 배포 소스에서 Node API를 사용하지 않는다.
- 코드 주석은 한국어로 작성한다.

`tests/architectureBoundaries.test.js`와 `tests/publicArchitectureContracts.test.js`가 이 규칙과
전역 façade 소비자 0을 검사한다.

## 주요 소유권

| 위치 | 소유 책임 |
|---|---|
| `src/app/routeRegistry.js` | route id, method, path, auth, permission, POST 보안 정책 |
| `src/domains/documents/` | 문서 검증·폼·조회·명령·낙관적 잠금·BatchPlan |
| `src/domains/disposal/` | 폐기 작업 상태 machine, 동결 snapshot, 재개 처리 |
| `src/domains/imports/` | CSV 작업 상태 machine, staging, 재개 처리 |
| `src/domains/snapshots/` | 엑셀 전체 대장 staging, 검증·diff, 원자 반영, 버전 충돌 방지 |
| `src/domains/identity/` | Actor, 사용자 상태, 비밀번호 policy, capability, 사용자 command/query |
| `src/domains/masters/` | 대분류·태그 query/command/view |
| `src/domains/racks/` | 랙 규격, 면·열 방향, 도면 geometry, slot, query/command |
| `src/domains/search/` | 검색 repository/service/presenter와 browser/server 공통 공개 API |
| `src/domains/sets/` | 세트 query/command, 잠금, 이력, presenter |
| `src/domains/audit/` | 시스템 감사 INSERT, filter query, audit presenter |
| `src/domains/dataQuality/` | 품질 issue catalog, 상세 query, 작업목록 view |
| `src/readModels/adminDashboard.js` | 권한별 사용자·품질·검색 통계를 조합하는 관리자 read model |
| `src/views/layout.js` | 공용 HTML shell, navigation, `page()` |
| `src/platform/web/` | RenderContext, safe embedded JSON, 구조적 HTML 보안 렌더링 |
| `migrations/` | append-only D1 schema 이력 |

## 절대 깨면 안 되는 불변식

1. **검색 단일 출처**: `src/searchCore.js`는 외부 스코프에 의존하지 않는 서버/browser 공통 ESM이다.
   `build:browser`가 `public/assets/search-core.js`를 생성하며 runtime source serialization이나
   `__name` shim을 사용하지 않는다.
2. **escapeHtml 자기완결성**: 클라이언트 bootstrap이 함수 소스를 직렬화하므로
   `src/ui/html/escape.js`의 `escapeHtml()`은 외부 참조 없이 실행되어야 한다.
3. **CSP·CSRF**: 모든 페이지는 `page()`를 거친다. `RenderContext`가 요청별 nonce와 CSRF 값을
   소유하고 `secureHtmlDocument`가 실제 opening tag를 판독해 모든 POST form에 token 하나,
   모든 inline executable script/style에 nonce 하나를 적용한다. 정규식 보안 후처리를 추가하지 않는다.
4. **정적 UI asset**: 전역 CSS/JS는 `src/views/styles.js`, `clientScript.js`에서 build 시 생성한
   `public/assets/app.css`, `app.js`다. ExcelJS와 OOXML 호환 처리용 JSZip도 build 시
   `public/assets/exceljs.min.js`, `jszip.min.js`로 고정하며 `check:browser`가 다섯 asset의 drift를 차단한다.
5. **D1 원자성**: 다중 변경은 `env.DB.batch()` 한 경계에 둔다. 감사·이력 INSERT가 상태
   UPDATE/DELETE보다 먼저 오고, 마지막 mutation guard가 no-op과 경합을 검출해야 한다.
6. **낙관적 잠금**: 문서 수정·이동은 `updated_at`과 단조 증가 `row_version`을 함께 검사한다. 대분류·태그·랙·문서 세트의 수정·상태 변경·구성 변경도 화면에서 받은 `expectedRowVersion`과 DB `row_version`이 일치할 때만 수행한다.
7. **랙 규칙**: 한 면은 7열 × 6선반, 저장 face는 A/B, 표시는 단면 `13`, 양면 `13-1`/`13-2`다.
   열 mirror는 화면 순서만 바꾸며 DB `column_number`는 바꾸지 않는다.
8. **내부 식별자 비노출**: `storage_code`와 `ARC-*`는 검색, CSV, 공개 read model에 노출하지 않는다.
9. **장기 작업 재개성**: disposal/import는 claim token과 terminal 상태를 보존하고 재호출이 중복
   mutation을 만들지 않아야 한다.
10. **migration append-only**: 과거 migration과 checksum은 수정하지 않는다. 스키마 변경은 항상
    다음 번호의 새 migration이며 수동 SQL을 운영 절차로 만들지 않는다. CI는 PR base의 released baseline과
    비교해 과거 SQL·checksum·schema 계약을 함께 바꾸는 우회도 거부한다.
11. **엑셀 대장 전체 동기화**: 사용자가 올리는 한 파일은 현재 대장의 완전한 snapshot이다. 브라우저는
    XLSX를 읽고 만들며 Worker는 정규화된 50행 이하 chunk만 받는다. 검증 실패·권한 부족·버전 경합은
    현재 문서를 한 행도 바꾸지 않고, 빠진 문서는 hard delete 대신 `document_snapshot_exclusions`와
    `sync_state = 'excluded'`로 이력만 보존한다. 최종 반영은 전용 권한과 위치·폐기 권한을 우회하지 않으며,
    날짜는 UTC calendar date로만 왕복한다.
12. **엑셀 행 식별자**: 보이는 13개 한글 열의 순서와 이름은 고정한다. `excel_row_key`는 숨김 14열에만
    기록하며 `storage_code`를 대체 공개하지 않는다. 파일의 `baseVersion`이 현재 버전과 다르면 반영을 막는다.
13. **OOXML 호환성**: 일반 XLSX는 ExcelJS로 바로 읽고, 표준 namespace 접두사와 절대 relationship을 쓰는
    XLSX만 브라우저에서 상대 경로·기본 namespace 형태로 정규화한 뒤 다시 읽는다. 원본 파일 hash는 바꾸지 않는다.
14. **엑셀 출처와 압축 예산**: export API는 DB에 manifest ID·base version·현재 snapshot·canonical export hash를
    먼저 기록하고 XLSX 숨김 metadata에 manifest ID를 넣는다. managed 업로드는 현재 상태와 manifest를 다시 대조한다.
    브라우저는 원본 10MB, ZIP 500항목, 비압축 합계 50MB를 넘는 파일을 workbook 해석 전에 거부하고 서버도 보고된
    원본 크기 상한을 재검사한다.
15. **개별 관리와 개정 경계**: 웹의 문서 추가·정보 수정·개정·위치 이동·폐기는 모두 `sync_state = 'current'`
    대장과 단조 증가 version에 반영되어 다음 Excel export와 인쇄용 시트의 입력이 된다. Excel snapshot은
    `document_revision_links`에 연결된 문서의 문서번호·개정번호를 바꾸거나 자동 폐기된 이전본을 복원할 수 없다.
    prepare 검증과 최종 apply SQL guard가 이 규칙을 각각 검사한다.
16. **세션 즉시 폐기**: signed cookie에는 `sessionEpoch`를 포함하고 매 요청 DB의 `session_epoch`와 비교한다.
    로그아웃·비밀번호 변경·사용중지·재활성화는 epoch를 단조 증가시켜 복사된 cookie도 즉시 무효화한다.
    `security_review_required` 계정은 status·비밀번호와 무관하게 로그인과 기존 session을 모두 거부한다.
17. **검색 cache 단조성**: 즉시 검색 ETag는 초 단위 timestamp만 사용하지 않는다. 문서 변경마다 증가하는
    `document_sync_state.current_version`, current 문서의 `row_version`, 기준정보 변경 신호를 조합해 같은 초의
    수정도 다른 ETag를 만든다.
18. **CSV 수식 비활성화**: 모든 CSV writer는 선행 공백·제어문자 뒤의 `=`, `+`, `-`, `@`까지 검사해
    스프레드시트 수식으로 실행되지 않도록 apostrophe를 붙인 뒤 RFC 4180 quoting을 적용한다.
19. **rollback 호환성**: 신규 migration을 적용하기 전에 현재 rollback 대상 Worker가 신규 schema에서 인증과
    핵심 쓰기 불변식을 지키는지 검증한다. `session_epoch` 최초 도입은 exact pre-release source로 만든
    epoch-aware compatibility Worker를 migration 없이 먼저 배포한 경우에만 진행한다.

## 데이터 무결성 계약

- audit/history INSERT는 상태 UPDATE/DELETE보다 먼저 같은 `env.DB.batch()`에서 실행한다.
- 선행 INSERT도 application 사전조회가 아니라 같은 pre-state SQL guard를 사용한다.
- batch 마지막 mutation의 변경 행 수로 no-op과 낙관적 잠금 경합을 감지한다.
- 모든 SQL 값은 bind parameter로 전달하고 요청당 D1 statement 예산 40, statement당 bind parameter 100개를 넘지 않는다. 최대 200개 ID를 다루는 세트 작업은 JSON 한 bind와 `json_each()`를 사용한다.
- 폐기·CSV 작업은 claim token과 terminal 상태를 보존해 재호출 시 중복 기록을 만들지 않는다.
- 감사·이동·세트 이력은 append-only trigger를 유지하고, 내부 `storage_code`는 DB·감사 내부에서만 사용한다.
- 엑셀 snapshot apply는 claim → 문서별 감사 → set-based diff → 전역 감사 → version 확정을 40문장 이하
  한 `env.DB.batch()`에 두며, 이전 snapshot id와 정규화 행을 보존한다.

상세 route와 permission 대응표는 `npm run docs:routes`로 생성되는
[route catalog](./generated/ROUTE_PERMISSION_CATALOG.md)를 사용한다. 이 파일은 직접 편집하지 않는다.

## 검증 매핑

| 계약 | 대표 테스트 |
|---|---|
| 계층 방향·공개 API | `architectureBoundaries.test.js`, `publicArchitectureContracts.test.js` |
| migration 연속성·schema·FK | `migrationChainContracts.test.js` |
| D1 순서·guard·rollback | `criticalMutationContracts.test.js`, `dataIntegrity.test.js` |
| 인증·권한·CSP·CSRF | `auth.test.js`, `permissions.test.js`, `security.test.js` |
| 폐기·CSV 재개와 예산 | `batchJobs.test.js`, `freeTierBudget.test.js` |
| 엑셀 300건 교체·diff·구버전 차단 | `excelSnapshotSync.test.js` |
| 실제 XLSX export→parse 무수정 0-diff | `excelSnapshotWorkbookE2E.test.js` |
| manifest·bootstrap·ZIP·감사 보강 | `excelSnapshotCompletion.test.js`, `excelOpenXmlCompatibility.test.js` |
| 웹 개별 변경 export 포함·개정 이력 경계 | `documentLedgerIntegration.test.js` |
| 검색 server/browser 일치 | `searchParity.test.js`, `searchBehavior.test.js` |

## 변경 절차

새 route는 `routeRegistry.js` descriptor → 해당 domain 공개 API/handler → view 순서로 연결한다.
화면은 반드시 `page()`를 사용한다. 여러 도메인의 조회를 합치면 handler 안에 임시 SQL을 만들지 말고
이름 있는 `readModels/` 모듈을 추가한다.

스키마 변경은 새 migration을 추가하고 전체 chain replay와 checksum 검사를 통과시킨다. 쓰기 use case는
이름 있는 `BatchPlan`에 step, guard, audit event id, statement budget을 고정한다.

```powershell
cd cloudflare-app
npm run check
npm test
npm run verify
npx wrangler deploy --dry-run
```

`main` 푸시는 GitHub Actions가 운영 migration과 배포를 수행하므로 로컬 작업에서는 명시적 요청 없이
push, 원격 migration, production deploy를 실행하지 않는다.
