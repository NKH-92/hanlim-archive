# Excel Snapshot Integrity Feature Verification Report

## 1. Executive summary

**Overall verification judgment: PARTIAL — core integrity controls are substantially implemented, but five explicit criteria fail and several release-grade verification gates remain unproven.**

The branch implements the major architecture of the improvement plan: a dedicated apply permission and feature mode, strict canonical parsing, UTC date-only conversion, DB/application identity controls, persisted diff/exclusion data, dynamic authorization, set-based movement/disposal logging, excluded-document UI, deterministic canonical hashing, and a read-only audit utility. The supplied local evidence reports `npm run check` PASS and `npm test` **282/282 PASS**.

The most important blocker is not feature breadth but integrity closure: update-tag DELETE/INSERT statements do not share the document `row_version` pre-state guard used by audit and document UPDATE. Other explicit failures are missing collision identifiers in user errors, no checked-in/generated audit result, no 1,000-row test, and risk thresholds that are calculated but not rendered.

### Counted scope and totals

| Scored group | Criteria | PASS | PARTIAL | FAIL |
|---|---:|---:|---:|---:|
| PR-00 through PR-08 completion criteria | 39 | 24 | 13 | 2 |
| Section 34 code-review checklist | 40 | 32 | 5 | 3 |
| Section 35 overall definition of done | 25 | 19 | 6 | 0 |
| Section 29 command gates | 15 | 2 | 13 | 0 |
| **Total** | **119** | **77** | **37** | **5** |

The totals intentionally count each explicit plan criterion even where the plan repeats the same invariant in a PR completion criterion, the code-review checklist, and the final definition of done. PR test bullet lists were used as supporting evidence but were not separately double-counted beyond the explicit completion/checklist/gate rows above.

## 2. Scope, evidence, and scoring method

Evaluation was limited exactly to the attached source-of-truth materials:

- `IMPROVEMENT_PLAN(2).md` — acceptance criteria and gates.
- `feature-branch.patch` — authoritative implementation and test evidence.
- `LOCAL_VERIFICATION.md` — branch/base/HEAD plus local command results.

Evidence integrity hashes used during review:

- Plan SHA-256: `ea4ff9b92d856f1bdb54ed064423bd8d718aa7477fe4356f6fd04d184e319736`
- Patch SHA-256: `dbeb28112e72703da04e57813711fbc097bb7ccf96e3981eb214d2a624eb8145`
- Local verification SHA-256: `1966e244b0c3ab41933cabc2288f93d818052f88a8d7654fe8db71d3d8bbea19`

`PASS` means the patch clearly implements the criterion and, where the plan calls for it, contains credible tests or supplied local evidence. `PARTIAL` means implementation or verification is incomplete/ambiguous after reading the full patch. `FAIL` is reserved for a clearly missing or contradictory requirement. No criterion was downgraded merely because a GitHub PR was not opened, production was not deployed, or a repository checkout beyond the patch was unavailable.

## 3. PR completion criteria

| ID | 기준 | 상태 | patch/source 증거 | 판정 근거 |
|---|---|---|---|---|
| PR-00.1 | baseline 기존 테스트 모두 통과 | **PASS** | `LOCAL_VERIFICATION.md:11-13` | 로컬 증거에 `npm test` 282/282 PASS가 명시되어 있다. |
| PR-00.2 | 새 보안 테스트가 수정 전 실패하고 수정 후 통과 | **PARTIAL** | `cloudflare-app/tests/excelSnapshotIntegrity.test.js:24-50,134-167`; `LOCAL_VERIFICATION.md:11-13` | 권한 우회와 무변경 실패 테스트가 추가되어 현재 통과한다. 다만 패치/로컬 노트만으로 수정 전 red 실행 이력은 확인되지 않는다. |
| PR-00.3 | apply가 최소 Admin-only | **PASS** | `cloudflare-app/wrangler.jsonc:24-27`; `cloudflare-app/src/domains/snapshots/domain/authorization.js:11-18,39-44` | 기본 환경값이 `admin-only`이고 누락값도 Admin-only, 알 수 없는 값은 disabled로 보수 처리한다. |
| PR-00.4 | CI green | **PARTIAL** | `LOCAL_VERIFICATION.md:11-13` | 로컬 syntax check와 전체 test는 green이지만 CI 실행 결과 자체는 첨부되지 않았다. |
| PR-00.5 | production deploy 없음 | **PASS** | `LOCAL_VERIFICATION.md:3-13` | 증거는 feature branch의 로컬 검증과 diff뿐이며 production 배포 수행 증거가 없다. 이 검증 과업에서도 배포는 범위 밖이다. |
| PR-01.1 | 권한 matrix 전부 테스트 | **PARTIAL** | `cloudflare-app/tests/excelSnapshotIntegrity.test.js:24-50,134-167`; `cloudflare-app/src/domains/snapshots/domain/authorization.js:31-86` | manage-only, move, dispose, non-Admin restore, 권한 실패 무변경은 확인된다. Admin 성공·DB 권한 변경 후 기존 세션 재평가·전체 route-level HTTP matrix의 명시 테스트는 부족하다. |
| PR-01.2 | 403/409/400 구분 | **PARTIAL** | `cloudflare-app/src/handlers/snapshotHandlers.js:23-45,76,118-119,121-143,153-169` | 오류 코드→상태 매퍼와 JSON 경로는 구분한다. 그러나 apply 실패에서 403만 상태를 명시하고 409/400은 상세 페이지 Response를 그대로 반환하여 HTTP status가 200으로 소실될 수 있다. |
| PR-01.3 | UI가 필요한 권한과 부족 권한 표시 | **PARTIAL** | `cloudflare-app/src/handlers/snapshotHandlers.js:90-115`; `cloudflare-app/src/views/snapshotViews.js:140-146,150-175`; `cloudflare-app/src/domains/snapshots/domain/authorization.js:31-86` | 필요 권한 문자열과 apply 차단 사유는 표시한다. 권한 실패 객체에는 전체 required/missing 목록이 없고 persisted `required_permissions_json`도 상세 GET에서 사용하지 않아 부족 권한 전체 목록은 불완전하다. |
| PR-01.4 | permission snapshot이 system audit에 기록 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:544-553`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:272-289` | 현재 actor 권한 스냅샷을 versioned apply details와 system audit 양쪽에 저장한다. |
| PR-02.1 | 시스템 추출 파일 무수정 재업로드 시 날짜·필드 diff 0 | **PARTIAL** | `cloudflare-app/src/domains/snapshots/domain/dateOnly.js:3-43`; `cloudflare-app/src/views/clientScript/excelSnapshots.js:12-50,225-229`; `cloudflare-app/tests/excelSnapshotSync.test.js:52-78`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:52-59` | UTC calendar-date 변환과 대규모 재준비에서 다수 unchanged가 확인된다. 하지만 실제 ExcelJS buffer 왕복을 세 timezone에서 수행한 “완전 무수정 0 diff” 테스트는 없다. |
| PR-02.2 | 모든 미지 상태가 오류 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/canonicalRow.js:8-13,37-42,125-126`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:61-89` | 허용 상태를 명시적으로 제한하고 공란·미지값을 구조화 오류로 만든다. |
| PR-02.3 | CSV 기존 동작 회귀 없음 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/canonicalRow.js:68-71`; `cloudflare-app/src/documentCsv.js:39-45,56-62`; `LOCAL_VERIFICATION.md:11-13` | snapshot strict parser가 CSV parser와 분리되었고 CSV 변경은 의도된 대장 포함상태 열 추가에 국한되며 전체 282 테스트가 통과했다. |
| PR-02.4 | generated assets check 통과 | **PARTIAL** | `cloudflare-app/src/views/clientScript/excelSnapshots.js:12-50,63-75,94-100,104-123`; `cloudflare-app/public/assets/app.js:233-272,283-295`; `LOCAL_VERIFICATION.md:11-13` | source와 생성 asset의 대응 변경은 보이지만 `npm run check:browser` 실행 결과는 없다. |
| PR-03.1 | current identity unique index 존재 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:83-89`; `cloudflare-app/tests/migrationChainContracts.test.js:18-24,37-43,49-65,96-102` | `sync_state=current` 범위의 대소문자 무관 partial unique expression index가 신규 migration에 존재하고 replay 계약에 포함된다. |
| PR-03.2 | 모든 충돌이 apply 이전 prepare에서 탐지 | **PARTIAL** | `cloudflare-app/src/domains/snapshots/domain/matchRows.js:73-167`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:91-111` | 파일 identity/key 중복, 외부 key, 동일 문서 이중 매칭, identity 변경 충돌 로직은 prepare에 있다. 다만 current 충돌·excluded 재포함·identity 변경 충돌별 테스트가 모두 갖춰지지는 않았다. |
| PR-03.3 | prepare 이후 경합 충돌도 DB가 최종 차단 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:83-89`; `cloudflare-app/tests/helpers/sqliteD1.js:22-50` | DB unique index가 최종 방어선이며 apply batch는 transaction 실패 시 rollback된다. |
| PR-03.4 | 사용자에게 충돌 문서 식별 정보 제공 | **FAIL** | `cloudflare-app/src/domains/snapshots/domain/matchRows.js:73-80,147-165`; `cloudflare-app/src/domains/snapshots/domain/canonicalRow.js:186-193` | 오류에는 행 번호와 일반 메시지는 있으나 충돌한 문서번호·개정번호·기존 문서 식별정보를 포함하지 않는다. |
| PR-04.1 | export 결과에 영향을 주는 모든 mutation이 version 증가 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:91-202`; `cloudflare-app/tests/migrationChainContracts.test.js:37-43,49-65` | categories, tags, racks, rack_slots, document_tags trigger가 추가되고 기존 documents trigger와 함께 replay 목록에서 검증된다. |
| PR-04.2 | metadata 없는 파일이 현재 version으로 조용히 재기준화되지 않음 | **PASS** | `cloudflare-app/src/views/clientScript/excelSnapshots.js:63-75,107-123,175-190`; `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:84-123` | managed mode는 metadata를 요구하고 metadata 부재는 명시적 bootstrap mode로 전송되며 서버가 Admin/최초 상태를 검사한다. |
| PR-04.3 | stale snapshot 반복 apply 불가 | **PARTIAL** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:538-568,634-644`; `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:403-477` | apply 전/claim 경합 stale은 failed로 terminal 처리한다. 그러나 prepare batch의 마지막 version guard가 실패하면 rows/exclusions가 먼저 갱신된 채 stale 오류만 반환하고 snapshot을 failed로 전환하지 않는다. |
| PR-04.4 | version 단조 증가 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:91-202`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:292-299`; `cloudflare-app/tests/excelSnapshotSync.test.js:90-103` | 각 trigger와 apply가 현재값 기준 `+1`을 사용하고 테스트는 정확한 폭이 아닌 `>`만 확인한다. |
| PR-05.1 | 모든 exclusion이 document ID 기반 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/matchRows.js:225-235`; `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:68-81` | matched document ID 집합의 차집합을 별도 exclusion 테이블에 저장한다. |
| PR-05.2 | UI·audit·UPDATE의 exclusion 집합 동일 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:74-82,396-437`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:56-80,255-270`; `cloudflare-app/src/views/snapshotViews.js:124-136,199-205` | 세 경로가 모두 `document_snapshot_exclusions`를 단일 소스로 사용한다. |
| PR-05.3 | 기존 문서 관리 ID 불필요 변경 없음 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/matchRows.js:157-198`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:156-180` | 기존 문서 매칭 시 existing `excel_row_key`를 effective key로 유지하고 그 값을 update한다. |
| PR-05.4 | snapshot detail에서 exact diff 조회 가능 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:50-66`; `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:59-68`; `cloudflare-app/src/views/snapshotViews.js:99-123` | before/after, changed fields, flags를 영속화·조회·표시한다. |
| PR-06.1 | 위치 변화와 movement log count 일치 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:82-115`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:169-225` | 현재/목표 slot 또는 face가 실제로 다른 update만 set-based INSERT하고 1건 이동→1건 로그를 검증한다. |
| PR-06.2 | 상태 변화와 disposal log count 일치 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:117-135,236-243`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:169-225` | 기존 문서는 status 차이가 있을 때만 disposed/restored를 기록하고 신규 disposed도 별도 처리한다. |
| PR-06.3 | 모든 apply audit에 reason/actor/snapshot 포함 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:29-80,214-234,272-289`; `cloudflare-app/src/domains/snapshots/domain/auditPayload.js:3-44` | document/system audit에 actor columns, snapshotCode, reason, approval reference와 schemaVersion을 저장한다. |
| PR-06.4 | D1 batch atomicity contract test 통과 | **PARTIAL** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:554-570`; `cloudflare-app/tests/helpers/sqliteD1.js:22-50`; `cloudflare-app/tests/excelSnapshotSync.test.js:17-46` | 단일 batch와 SQLite rollback adapter, 300행 적용은 확인된다. 의도적 중간 SQL 실패·동시 claim·unique race rollback 테스트가 없고 tag mutation의 pre-state guard도 불완전하다. |
| PR-07.1 | 사용자가 제외 문서 이름을 반영 전에 볼 수 있음 | **PASS** | `cloudflare-app/src/views/snapshotViews.js:124-136,199-205`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:231-279` | 별도 exclusion 표에 문서번호·개정·문서명·상태·위치를 표시한다. |
| PR-07.2 | 위치·폐기 해제를 즉시 구분 가능 | **PASS** | `cloudflare-app/src/views/snapshotViews.js:155-165,182-190,249-263` | summary metric, filter, flag badge로 MOVE/DISPOSE/RESTORE를 분리한다. |
| PR-07.3 | excluded 문서가 정상 current처럼 보이지 않음 | **PASS** | `cloudflare-app/src/views/documents/detailView.js:18-28,48,61-66`; `cloudflare-app/src/views/setViews.js:48-56,63-74,105-113,116-120` | 상세/세트에 excluded badge·경고를 표시하고 문서 mutation action을 숨기며 rack map 집계에서 제외한다. |
| PR-07.4 | 서버 권한이 UI 상태와 무관하게 최종 차단 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:490-517`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:134-167` | apply service가 현재 actor로 권한을 재검사하고 실패 시 snapshot/document 무변경을 검증한다. |
| PR-08.1 | audit 결과 report 생성 | **FAIL** | `cloudflare-app/scripts/audit-excel-snapshot-data.mjs:33-117`; `cloudflare-app/package.json:20-24`; `LOCAL_VERIFICATION.md:8-13` | read-only report 생성 도구는 추가됐지만 patch에 생성된 report artifact가 없고 로컬 실행 증거에도 audit 명령이 없다. |
| PR-08.2 | 자동 수정 없음 | **PASS** | `cloudflare-app/scripts/audit-excel-snapshot-data.mjs:20-31,33-117` | DB를 `readOnly: true`로 열고 SELECT 결과를 JSON 파일로만 쓴다. |
| PR-08.3 | correction 절차 문서화 | **PASS** | `docs/OPERATIONS.md:91-105` | backup 사본에서 read-only 감사, append-only 로그 유지, correction event/복구 절차가 문서화됐다. |
| PR-08.4 | backup/restore 확인 | **PARTIAL** | `docs/OPERATIONS.md:91-105`; `LOCAL_VERIFICATION.md:11-13` | 절차와 링크는 있으나 실제 backup/restore 확인 결과는 첨부되지 않았다. |
| PR-08.5 | production rollout checklist 승인 | **PARTIAL** | `cloudflare-app/wrangler.jsonc:24-27`; `docs/OPERATIONS.md:83-105` | disabled→admin-only→permissioned 운용 방식은 준비됐으나 승인된 체크리스트/UAT 증거는 없다. production 배포 자체는 평가 범위 밖이다. |
| PR-08.6 | 모든 CI gate green | **PARTIAL** | `LOCAL_VERIFICATION.md:11-13` | `npm run check`와 `npm test`만 실행 증거가 있다. |

## 4. Section 34 code-review checklist reconciliation

| ID | 기준 | 상태 | patch/source 증거 | 판정 근거 |
|---|---|---|---|---|
| CR-PERM-01 | upload와 apply 권한 분리 | **PASS** | `cloudflare-app/src/app/routeRegistry.js:95-98`; `cloudflare-app/src/permissions.js:5-12,18-22` | create/rows/prepare는 manage_documents, apply는 전용 permission을 요구한다. |
| CR-PERM-02 | move/dispose/restore 추가 권한 계산 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/authorization.js:20-29,63-80`; `cloudflare-app/src/domains/snapshots/domain/diff.js:109-126` | diff summary에 따라 이동·폐기 권한과 restore Admin을 합성한다. |
| CR-PERM-03 | apply 시 현재 session으로 재검사 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:490-517`; `cloudflare-app/src/auth/session.js:87-94` | 요청 actor의 최신 session permission을 apply service에서 다시 평가한다. |
| CR-PERM-04 | 권한 부족이 403 | **PASS** | `cloudflare-app/src/handlers/snapshotHandlers.js:23-45,153-159`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:24-50` | 권한 오류 코드는 403으로 매핑되고 apply 경로도 403 error response를 사용한다. |
| CR-PERM-05 | UI 숨김에만 의존하지 않음 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:511-517`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:134-167` | 서버 application service가 독립적으로 차단한다. |
| CR-PERM-06 | bootstrap Admin-only | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:104-112`; `cloudflare-app/src/domains/snapshots/domain/authorization.js:57-61` | 생성 및 apply 양쪽에서 Admin을 요구한다. |
| CR-IN-01 | 중요 필드 공란 오류 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/canonicalRow.js:97-127`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:61-89` | 개정·날짜·폐기년도·문서명·분류·위치·면·상태 공란을 오류 처리한다. |
| CR-IN-02 | unknown status 오류 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/canonicalRow.js:37-42,125-126` | 명시 허용값 외 상태는 실패한다. |
| CR-IN-03 | 날짜 timezone independent | **PARTIAL** | `cloudflare-app/src/domains/snapshots/domain/dateOnly.js:3-43`; `cloudflare-app/src/views/clientScript/excelSnapshots.js:24-50`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:52-59` | UTC 변환은 맞지만 테스트가 timezone/ExcelJS workbook 왕복을 실행하지 않으며 client numeric serial 경로는 workbook 1904 date system을 전달하지 않는다. |
| CR-IN-04 | row key 서버 권위 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/identity.js:16-22`; `cloudflare-app/src/domains/snapshots/domain/matchRows.js:201-222`; `cloudflare-app/src/views/clientScript/excelSnapshots.js:94-100,104-123` | blank 신규 key는 브라우저가 만들지 않고 서버가 생성한다. |
| CR-IN-05 | partial key 상황 명시 처리 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/matchRows.js:100-145`; `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:189-220` | 중복·unknown·기존행 key 누락·신규 blank를 구분한다. |
| CR-IN-06 | schemaVersion 서버 검사 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/hash.js:3`; `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:84-102` | 지원 버전 set과 create-time rejection이 있다. |
| CR-DATA-01 | current identity unique | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:83-89`; `cloudflare-app/src/domains/snapshots/domain/matchRows.js:73-167` | DB와 application 양쪽 방어가 있다. |
| CR-DATA-02 | exclusion document ID 기반 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/matchRows.js:225-235`; `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:68-81` | document ID와 expected row version/key를 저장한다. |
| CR-DATA-03 | before/after에 tags 포함 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/diff.js:36-73,76-82`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:38-47` | canonical payload에 tagIds/tagNames가 포함되고 audit가 persisted JSON을 사용한다. |
| CR-DATA-04 | excluded/current 화면 분리 | **PASS** | `cloudflare-app/src/views/documents/detailView.js:18-28,48,61-66`; `cloudflare-app/src/views/setViews.js:48-56,63-74,105-113,116-120` | badge·경고·action 비활성화·집계 분리를 구현한다. |
| CR-DATA-05 | master data 변경이 version 증가 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:91-202` | category/tag/rack/slot/document_tag trigger가 추가됐다. |
| CR-AUD-01 | 감사 INSERT가 UPDATE보다 먼저 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:29-80,82-154,156-180,255-270` | 기존 update/exclusion의 document audit와 업무 로그가 document mutation보다 앞선다. |
| CR-AUD-02 | 감사·업무이력·상태변경이 동일 pre-state guard 사용 | **FAIL** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:48-54,101-115,128-135,137-154,174-180` | audit/movement/status/document update는 expected row_version을 검사하지만 update 대상 tag DELETE/INSERT는 snapshot/action만 검사한다. 또한 공통 guard는 line 13에서 snapshot ID를 SQL 문자열에 보간한다. |
| CR-AUD-03 | reason/approval reference 저장 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/authorization.js:93-117`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:18-27,38-47,65-72,223-229` | 검증 후 snapshot과 document audit에 동일 값을 저장한다. |
| CR-AUD-04 | movement와 status 업무이력 생성 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:82-135,236-243` | 두 이력을 set-based INSERT한다. |
| CR-AUD-05 | 잘못된 과거 로그를 삭제하지 않음 | **PASS** | `cloudflare-app/scripts/audit-excel-snapshot-data.mjs:33-107`; `docs/OPERATIONS.md:91-105` | 감사 스크립트는 read-only이고 문서는 correction event로 보완하도록 한다. |
| CR-AUD-06 | internal storage code 공개 payload 비노출 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/diff.js:36-82`; `cloudflare-app/src/views/snapshotViews.js:99-136` | 공개 diff/UI shape에 storage_code를 넣지 않는다. |
| CR-ATOM-01 | 하나의 D1 batch | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:554-570` | 전체 apply statements를 단일 `env.DB.batch()`로 실행한다. |
| CR-ATOM-02 | statement ≤40 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:17-308`; `cloudflare-app/tests/excelSnapshotSync.test.js:35-46` | row 수와 무관한 고정 17개 statement이며 300행 테스트가 budget 이내임을 확인한다. |
| CR-ATOM-03 | set-based SQL | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:29-307` | snapshot row/exclusion table을 SELECT source로 사용하고 문서별 statement를 만들지 않는다. |
| CR-ATOM-04 | 1,000건 테스트 존재 | **FAIL** | `cloudflare-app/tests/excelSnapshotSync.test.js:17-46`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:1-335` | 최대 규모 테스트는 300행이며 1,000행 apply 시나리오는 없다. |
| CR-ATOM-05 | stale/concurrent/unique failure rollback 테스트 | **PARTIAL** | `cloudflare-app/tests/excelSnapshotSync.test.js:90-103`; `cloudflare-app/tests/helpers/sqliteD1.js:22-50`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:134-167` | stale create와 권한 무변경, transactional adapter는 있다. concurrent claim·prepare 후 unique race·중간 SQL 오류의 명시 회귀 테스트는 없다. |
| CR-ATOM-06 | completed 재호출 idempotent | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:490-495,563-568` | completed는 즉시 `alreadyApplied`, claim 0 후 completed 재조회도 idempotent success다. |
| CR-UI-01 | 제외 문서 이름을 반영 전에 표시 | **PASS** | `cloudflare-app/src/views/snapshotViews.js:124-136,199-205` | 별도 표에서 명시한다. |
| CR-UI-02 | before/after 표시 | **PASS** | `cloudflare-app/src/views/snapshotViews.js:99-123,266-269` | changed field만 before/after로 표시한다. |
| CR-UI-03 | 위치·폐기·복구 별도 표시 | **PASS** | `cloudflare-app/src/views/snapshotViews.js:155-165,182-190,249-263` | metric/filter/badge가 각각 있다. |
| CR-UI-04 | 위험 임계치 표시 | **FAIL** | `cloudflare-app/src/domains/snapshots/domain/diff.js:157-196`; `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:360-373,465-486`; `cloudflare-app/src/views/snapshotViews.js:87-98,137-146,150-175` | 위험 warning은 계산·prepare 응답/audit에는 있으나 snapshot detail view 인자나 렌더링에 연결되지 않았다. |
| CR-UI-05 | sync_state badge | **PASS** | `cloudflare-app/src/views/documents/detailView.js:18-28`; `cloudflare-app/src/views/setViews.js:105-113,116-120` | 문서 상세와 세트 행 모두 표시한다. |
| CR-UI-06 | HTML escaping과 접근성 유지 | **PASS** | `cloudflare-app/src/views/snapshotViews.js:1-3,106-136,182-205`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:231-279` | 동적 값에 escapeHtml을 사용하고 filter role/aria 및 status 영역을 둔다. |
| CR-DEP-01 | 새 migration만 추가 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:1-202`; `LOCAL_VERIFICATION.md:8-9` | diff는 0031 신규 migration을 추가하며 과거 migration 수정은 보이지 않는다. |
| CR-DEP-02 | route catalog 갱신 | **PASS** | `docs/generated/ROUTE_PERMISSION_CATALOG.md:110-123`; `cloudflare-app/src/app/routeRegistry.js:95-98` | apply 전용 permission이 source와 generated catalog에 일치한다. |
| CR-DEP-03 | browser assets를 build로 갱신 | **PARTIAL** | `cloudflare-app/src/views/clientScript/excelSnapshots.js:12-50`; `cloudflare-app/public/assets/app.js:233-270`; `LOCAL_VERIFICATION.md:11-13` | source와 asset은 함께 갱신됐지만 build/check:browser 실행 증거가 없다. |
| CR-DEP-04 | verify/audit/dry deploy 통과 | **PARTIAL** | `cloudflare-app/package.json:20-25`; `LOCAL_VERIFICATION.md:11-13` | scripts는 존재하나 실행 증거는 check/test뿐이다. |
| CR-DEP-05 | backup/UAT/rollout mode 준비 | **PARTIAL** | `cloudflare-app/wrangler.jsonc:24-27`; `docs/OPERATIONS.md:83-105` | mode와 절차는 준비됐지만 실제 backup/UAT/승인 증거는 없다. |

## 5. Section 35 overall definition of done

| ID | 기준 | 상태 | patch/source 증거 | 판정 근거 |
|---|---|---|---|---|
| DoD-01 | 일반 문서관리 권한만으로 apply 불가 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/authorization.js:45-55`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:24-37` | 전용 권한 없이는 거부한다. |
| DoD-02 | move/dispose/restore 권한 우회 불가 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/authorization.js:63-80`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:39-50` | 각 추가 권한과 restore Admin을 검사한다. |
| DoD-03 | Asia/Seoul 날짜 round-trip 보존 | **PARTIAL** | `cloudflare-app/src/domains/snapshots/domain/dateOnly.js:3-43`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:52-59` | UTC helper는 맞지만 `TZ=Asia/Seoul` + ExcelJS workbook round-trip 실행 증거가 없다. |
| DoD-04 | 공란·오타가 기본값으로 조용히 변하지 않음 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/canonicalRow.js:71-183`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:61-89` | strict parser가 구조화 오류를 반환한다. |
| DoD-05 | current identity가 DB·application 양쪽에서 유일 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:83-89`; `cloudflare-app/src/domains/snapshots/domain/matchRows.js:73-167` | 두 계층 방어가 있다. |
| DoD-06 | 관리 ID 없는 신규 행은 서버가 ID 생성 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/identity.js:16-22`; `cloudflare-app/src/domains/snapshots/domain/matchRows.js:201-222` | serverGeneratedRowKey를 사용한다. |
| DoD-07 | 기존 관리 ID 불필요 변경 없음 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/matchRows.js:182-198` | 기존 key를 effective key로 유지한다. |
| DoD-08 | 기준정보 변경 후 오래된 파일 차단 | **PASS** | `cloudflare-app/migrations/0031_excel_snapshot_integrity.sql:91-202`; `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:114-123,303-311,538-542` | master/tag trigger와 create/prepare/apply version equality 검사가 있다. |
| DoD-09 | metadata 없는 파일은 명시적 bootstrap 외 거부 | **PASS** | `cloudflare-app/src/views/clientScript/excelSnapshots.js:107-123,175-190`; `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:104-123` | metadata 부재는 mode=bootstrap으로 명시되고 서버에서 Admin/최초 상태만 허용한다. |
| DoD-10 | unsupported schemaVersion 거부 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:94-102`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:113-132` | create 전에 거부한다. |
| DoD-11 | exclusion preview·audit·UPDATE 동일 집합 | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:56-80,255-270`; `cloudflare-app/src/views/snapshotViews.js:124-136` | persisted exclusion table을 공유한다. |
| DoD-12 | 실제 제외 없는 false exclusion audit 없음 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/matchRows.js:225-235`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:56-80` | matched document ID 차집합만 audit source가 된다. |
| DoD-13 | before/after와 tags가 감사 근거로 남음 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/diff.js:36-82`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:38-47` | 동일 shape의 persisted JSON에 tags가 포함된다. |
| DoD-14 | 위치 변경마다 movement log | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:82-115`; `cloudflare-app/tests/excelSnapshotIntegrity.test.js:169-225` | 실제 위치 차이에 대해 set-based 기록한다. |
| DoD-15 | 상태 변경마다 disposal/restore log | **PASS** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:117-135`; `cloudflare-app/src/domains/snapshots/domain/authorization.js:75-80` | 상태 차이에 따라 disposed/restored를 기록하고 restore는 Admin을 요구한다. |
| DoD-16 | apply reason 및 필요한 approval reference 저장 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/authorization.js:93-117`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:18-27,38-47` | 길이·조건 검증과 저장이 구현됐다. |
| DoD-17 | excluded 문서가 current처럼 표시되지 않음 | **PASS** | `cloudflare-app/src/views/documents/detailView.js:18-28,61-66`; `cloudflare-app/src/views/setViews.js:48-56,63-74,105-113,116-120` | badge·경고·action 차단·current-only map이 있다. |
| DoD-18 | 1,000건 apply가 ≤40 statements로 원자 처리 | **PARTIAL** | `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:17-308`; `cloudflare-app/tests/excelSnapshotSync.test.js:17-46` | 구조상 고정 17 statements이나 실제 최대 테스트는 300행이고 tag pre-state guard가 완전하지 않다. |
| DoD-19 | stale/권한/중복/DB 오류 시 한 행도 변경 없음 | **PARTIAL** | `cloudflare-app/tests/excelSnapshotIntegrity.test.js:91-111,134-167`; `cloudflare-app/tests/helpers/sqliteD1.js:22-50`; `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:137-154` | 권한·prepare 중복·batch rollback 기반은 있다. 중간 DB 오류/unique race/concurrency 테스트 부재와 tag guard 불일치 때문에 전 범위를 확정할 수 없다. |
| DoD-20 | 최신 export 무수정 재업로드 0 diff | **PARTIAL** | `cloudflare-app/tests/excelSnapshotSync.test.js:52-78`; `cloudflare-app/src/views/clientScript/excelSnapshots.js:225-229` | export→prepare의 298 unchanged 근거는 있으나 실제 XLSX를 무수정 전체 재업로드해 0 diff를 단언하는 테스트는 없다. |
| DoD-21 | OOXML 호환 파일과 rack ID 링크 무회귀 | **PASS** | `cloudflare-app/src/views/clientScript/excelSnapshots.js:77`; `LOCAL_VERIFICATION.md:11-13` | 기존 OOXML compatibility script 연결을 유지하고 전체 282 회귀 테스트가 통과했다. 관련 코드에 rack 문자열 매칭 회귀 변경은 없다. |
| DoD-22 | migration/routes/browser/test/dependency/dry 모두 통과 | **PARTIAL** | `cloudflare-app/package.json:20-25`; `LOCAL_VERIFICATION.md:11-13` | test/check만 증명되고 나머지 gate 실행 결과가 없다. |
| DoD-23 | 데이터 감사 report와 correction 절차 준비 | **PARTIAL** | `cloudflare-app/scripts/audit-excel-snapshot-data.mjs:33-117`; `docs/OPERATIONS.md:91-105` | 도구와 절차는 있으나 실제 report output이 없다. |
| DoD-24 | disabled→admin-only→permissioned rollout 가능 | **PASS** | `cloudflare-app/src/domains/snapshots/domain/authorization.js:5-18,31-44`; `cloudflare-app/wrangler.jsonc:24-27`; `docs/OPERATIONS.md:83-89` | 세 mode와 보수적 fallback이 구현됐다. |
| DoD-25 | 최종 PR 설명에 근거·검증·위험·rollback 포함 | **PASS** | `LOCAL_VERIFICATION.md:3-16`; `docs/OPERATIONS.md:91-105`; `docs/ARCHITECTURE.md:76-84` | GitHub PR 개설 여부는 본 과업 범위 밖이다. 동등한 branch 검증 근거와 운영/rollback 문서는 존재하고, 본 보고서가 남은 위험을 명시한다. |

## 6. Section 29 verification command gates

| ID | 기준 | 상태 | patch/source 증거 | 판정 근거 |
|---|---|---|---|---|
| GATE-01 | npm ci | **PARTIAL** | `LOCAL_VERIFICATION.md:11-13` | 실행 결과가 기재되지 않았다. |
| GATE-02 | npm run check | **PASS** | `LOCAL_VERIFICATION.md:11-13` | PASS (syntax check OK). |
| GATE-03 | npm run typecheck | **PARTIAL** | `LOCAL_VERIFICATION.md:11-13` | 별도 실행 결과가 없다. |
| GATE-04 | npm run lint | **PARTIAL** | `LOCAL_VERIFICATION.md:11-13` | 별도 실행 결과가 없다. |
| GATE-05 | npm run format:check | **PARTIAL** | `LOCAL_VERIFICATION.md:11-13` | 별도 실행 결과가 없다. |
| GATE-06 | npm run check:migrations | **PARTIAL** | `cloudflare-app/tests/migrationChainContracts.test.js:18-24,37-43,49-65,96-102`; `LOCAL_VERIFICATION.md:11-13` | migration tests는 전체 test에 포함되지만 전용 command 결과는 없다. |
| GATE-07 | npm run check:routes | **PARTIAL** | `docs/generated/ROUTE_PERMISSION_CATALOG.md:110-123`; `LOCAL_VERIFICATION.md:11-13` | catalog 일치는 보이나 전용 command 결과가 없다. |
| GATE-08 | npm run check:browser | **PARTIAL** | `cloudflare-app/src/views/clientScript/excelSnapshots.js:12-50`; `cloudflare-app/public/assets/app.js:233-270`; `LOCAL_VERIFICATION.md:11-13` | asset 대응 변경은 있으나 command 결과가 없다. |
| GATE-09 | npm test | **PASS** | `LOCAL_VERIFICATION.md:11-13` | 282 pass / 0 fail. |
| GATE-10 | npm run verify | **PARTIAL** | `cloudflare-app/package.json:20-21`; `LOCAL_VERIFICATION.md:11-13` | verify script는 정의돼 있으나 실행 결과가 없다. |
| GATE-11 | npm run audit:dependencies | **PARTIAL** | `cloudflare-app/package.json:21-24`; `LOCAL_VERIFICATION.md:11-13` | 실행 결과가 없다. |
| GATE-12 | npm run release:evidence | **PARTIAL** | `cloudflare-app/package.json:23-25`; `LOCAL_VERIFICATION.md:11-13` | 실행 결과가 없다. |
| GATE-13 | npm run deploy:dry | **PARTIAL** | `LOCAL_VERIFICATION.md:11-13` | dry-run 결과가 없다. production deploy 미실행 자체는 감점 사유가 아니다. |
| GATE-14 | git diff --check | **PARTIAL** | `LOCAL_VERIFICATION.md:3-13` | 실행 결과가 없다. |
| GATE-15 | git status --short | **PARTIAL** | `LOCAL_VERIFICATION.md:3-13` | 실행 결과가 없다. |

## 7. Remaining actionable gaps

### A. Integrity/atomicity — highest priority

1. **Use bind parameters for every snapshot guard and apply the same document pre-state guard to tag mutations.** `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:12-13` interpolates a numeric snapshot ID into SQL, contrary to the plan’s bind-only invariant. More importantly, tag DELETE/INSERT at `:137-154` checks snapshot/action but not `matched_document_id + expected_row_version + current/excluded pre-state`, unlike audit/movement/status/document UPDATE at `:48-54,101-135,174-180`. Build tag sources from a guarded document join so a stale row cannot lose/rewrite tags while its document UPDATE is skipped.

2. **Make prepare-version race terminal and internally consistent.** In `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:403-477`, row/exclusion persistence precedes the final base-version guarded `ready` transition. If that transition returns no row, the function returns stale without marking the snapshot failed. Add the version guard to all prepare mutations or claim/validate first, and ensure a stale prepare becomes terminal with an audit event.

3. **Preserve apply error HTTP status.** `cloudflare-app/src/handlers/snapshotHandlers.js:153-169` only emits an explicit 403 response. Wrap the rendered detail page with the mapped 400/409 status so clients and monitoring receive the documented status contract.

### B. Test closure

4. Add a true **1,000-row mixed apply** test asserting the exact statement ceiling, final counts, and one-batch behavior; the current large test is 300 rows (`cloudflare-app/tests/excelSnapshotSync.test.js:17-46`).

5. Add fault-injection/competition tests for: middle-statement SQL failure rollback, prepare-after-version-change, concurrent apply claim, prepare-then-unique-index race, completed re-call, restore log, and same-location movement=0. The SQLite adapter can rollback (`cloudflare-app/tests/helpers/sqliteD1.js:22-50`), but these failure modes are not directly exercised.

6. Add real ExcelJS `DB string → workbook → buffer → load → parser` tests under `TZ=UTC`, `TZ=Asia/Seoul`, and `TZ=America/Los_Angeles`; include both 1900 and 1904 workbooks. The domain helper supports `date1904` (`cloudflare-app/src/domains/snapshots/domain/dateOnly.js:31-38`), while the browser numeric path hardcodes the 1900 epoch (`cloudflare-app/src/views/clientScript/excelSnapshots.js:43-50`).

### C. User review and diagnostic quality

7. Render persisted prepare warnings and full required/missing permission sets. Warnings are computed at `cloudflare-app/src/domains/snapshots/domain/diff.js:157-196` and returned/audited at `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:360-373,465-486`, but `cloudflare-app/src/views/snapshotViews.js:87-98,137-146,150-175` has no warning input/rendering.

8. Include the conflicting document number, revision, existing document ID/row key, and both row numbers in structured identity conflict errors. Current messages are generic (`cloudflare-app/src/domains/snapshots/domain/matchRows.js:73-80,147-165`).

9. Complete the exclusion-review contract if required by operations: set count and recent movement/loan warnings are absent from `cloudflare-app/src/views/snapshotViews.js:124-136,199-205`; the patch also does not clearly show a server guard preventing an excluded document from being newly added to a set.

### D. Provenance, bootstrap, and operations

10. Persist and validate export provenance server-side. `exportManifestId` is generated ephemerally at `cloudflare-app/src/domains/snapshots/infrastructure/repository.js:600-607`, while create only checks that either a snapshot ID or arbitrary manifest string is present (`:114-123`). A manifest table/signature or exact currentSnapshotId validation is needed for authoritative provenance.

11. Strengthen bootstrap confirmation. The browser uses a simple `window.confirm()` (`cloudflare-app/src/views/clientScript/excelSnapshots.js:175-177`); no typed confirmation or server-side backup acknowledgment is present.

12. Add file-size and ZIP expansion safety limits before ExcelJS/JSZip processing. The patch enforces row count/chunk size but contains no `sourceSize`/maximum file bytes/zip-bomb guard.

13. Include snapshot provenance in movement/disposal business logs. `cloudflare-app/src/domains/snapshots/infrastructure/applyPlan.js:82-135` stores reason/actor but no snapshot code/details field, reducing direct reconciliation with document audit entries.

14. Execute and retain the required operational evidence: `npm ci`, full `npm run verify`, dependency audit, release evidence, dry deploy, `git diff --check`, `git status --short`, and the read-only data audit report. The supplied evidence currently covers only check and test (`LOCAL_VERIFICATION.md:11-13`).

## 8. Confidence notes

- **High confidence:** permission model, strict parser, DB migration/index/triggers, persisted diff/exclusion design, set-based apply structure, reason/approval persistence, excluded-document UI, and the five explicit FAIL findings. These are directly visible in the patch.
- **Moderate confidence:** regression claims relying on the aggregate 282/282 result, because `LOCAL_VERIFICATION.md` does not enumerate every existing OOXML/rack/CSV test by name.
- **Lower confidence:** operational readiness claims (CI, backup/UAT approval, dependency audit, dry deployment) because the required command outputs and generated audit report were not attached.
- The patch is treated as complete authoritative evidence; no downgrade was made for the absence of an additional repository checkout.

## 9. Final disposition

The feature branch is **substantially aligned but not fully compliant** with the improvement plan. It is suitable for continued review after the integrity guard and HTTP-status defects are corrected. Release readiness additionally requires the missing 1,000-row/fault/TZ tests, rendered risk warnings, generated data-audit evidence, and remaining command gates.
