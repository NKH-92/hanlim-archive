# Excel Snapshot Integrity — Final Verification Report

## 1. Executive summary

**Overall verdict: PARTIAL — the feature branch closes all previously identified FAIL items and substantially satisfies the agent-deliverable integrity scope, but it does not yet prove every explicit completion criterion.**

Across the 119 explicit scoring rows used by the prior verification baseline—39 PR completion criteria, 40 Section 34 checklist rows, 25 Section 35 DoD rows, and 15 Section 29 gates—the current evidence scores **107 PASS / 12 PARTIAL / 0 FAIL**. Core code integrity controls are strong: dedicated/dynamic authorization, timezone-safe date handling, strict parsing, DB/application identity protection, document-ID-based exclusions, persisted diff/audit data, shared pre-state guards, set-based atomic apply, movement/disposal history, risk warnings, excluded-document UI, deterministic hashing, 1,000-row testing, fault/concurrency rollback tests, and green local/CI quality gates are all evidenced.

The branch is **not ‘fully satisfies’ yet** under a strict reading. The remaining PARTIAL items are: no retained red-before transcript; incomplete explicit authorization/collision test matrices; no single untouched full-XLSX end-to-end 0-diff test; a read-only audit report that covers 5 of the plan’s 8 required audit categories; missing `git status --short` evidence; a PR description that does not itself include rollback/remaining-risk sections; and production backup/UAT/rollout approvals that are intentionally human-ops-only. No production access or execution is invented.

Production deploy, remote D1 migration, live feature-gate changes, production backup restore drill, and live-data UAT are outside the agent scope. Because preparation documentation/checklists exist, those items are scored **PARTIAL**, not FAIL, exactly as required by the hard-scope note.

## 2. Verification scope and evidence

- Repository/PR: `NKH-92/hanlim-archive` PR #13, `improve/excel-snapshot-integrity` → `main`.
- Base SHA: `245016b6b657ec1af99f62a860b043773af42f9e`; head SHA: `468aa19422826ecdce02a7dcf4e8522e3152cd83`.
- Current PR state at verification: open, mergeable, not merged. [Source: https://github.com/NKH-92/hanlim-archive/pull/13, checked 2026-07-20]
- Current CI: GitHub Actions run `29744543297`, `required / verify`, completed successfully; steps include `npm ci`, verify, dependency audit, migration/schema evidence, and Worker dry-run. [Source: GitHub Actions metadata for PR #13, checked 2026-07-20]
- The attached UTF-16LE patch was normalized only for mechanical inspection; scoring uses the original patch bytes as the authoritative implementation evidence.

### Evidence integrity hashes

| Evidence | SHA-256 |
|---|---|
| `IMPROVEMENT_PLAN.md` | `ea4ff9b92d856f1bdb54ed064423bd8d718aa7477fe4356f6fd04d184e319736` |
| `feature-branch-code.patch` | `a3f275fa957fe257dce90d264a912df2bde8203e6dc3fa3dfe04402ab58e0f0f` |
| `LOCAL_VERIFICATION.md` | `d1aed92ac7b172a4c9d2f2808ccc04a33e5f257b046e7d4e908da07c0c315f7a` |
| `GATE_EVIDENCE.md` | `52d8c10f04f57bad894e8bea6e428b7cb88ecff4dd168b0dfe0407b11ecc8546` |
| `FIXES_AFTER_VERIFY.md` | `55a29fa9a1808f30b96c1c46c8e2c8bb2fe99c7b0dcbc523e55e09d4b0cd8ee8` |
| `local-sample-audit.json` | `423eac3cd9f62f8dd4cc9f2f465d50d15ee202b9f19b22b0f2b2824b8b24e60f` |
| `verify-run.log` | `b0503d14d14933b945c90ef1fd3a7fe513d5d782ff775e9c1329de6dd58539c1` |

### Scoring method

- **PASS**: the patch clearly implements the criterion and required test/process evidence is credible.
- **PARTIAL**: substantial implementation/preparation exists, but an explicit behavior, test, command record, audit category, PR-description element, or production-ops approval remains incomplete.
- **FAIL**: a required code/test/preparation item is clearly absent or contradicted. No row meets that threshold after the supplied fixes.
- The PR-stage count follows the prior report’s stable 119-row denominator: each PR’s explicit **완료 기준** is scored; detailed design/test bullets are supporting evidence and are also surfaced as actionable gaps where incomplete.

## 3. Score summary

| Scored group | Criteria | PASS | PARTIAL | FAIL |
|---|---:|---:|---:|---:|
| PR-00 through PR-08 completion criteria | 39 | 32 | 7 | 0 |
| Section 34 code-review checklist | 40 | 39 | 1 | 0 |
| Section 35 overall definition of done | 25 | 22 | 3 | 0 |
| Section 29 command gates | 15 | 14 | 1 | 0 |
| **Total** | **119** | **107** | **12** | **0** |

### Prior FAIL closure

| Prior FAIL ID | Current status | Closure evidence |
|---|---|---|
| `PR-03.4` conflict diagnostics | **PASS** | `matchRows.js` now carries document/revision/row/ID/key collision data; dedicated test asserts identifiers. |
| `PR-08.1` audit artifact | **PARTIAL** | A real local sample report now exists, so the prior absence is closed; coverage remains 5/8 planned audit categories. |
| `CR-AUD-02` shared pre-state guards | **PASS** | tag DELETE/INSERT now join applying snapshot and expected document pre-state; no snapshot-ID SQL interpolation remains. |
| `CR-ATOM-04` 1,000-row test | **PASS** | 1,000-row apply asserts one batch, 17 statements, final counts, and completed status. |
| `CR-UI-04` warnings rendered | **PASS** | persisted warnings are read/recomputed and rendered in `snapshot-warnings`; view test checks EXCLUSION/LARGE_CHANGE. |

## 4. PR-00 through PR-08 completion criteria

| ID | Criterion | Status | File evidence | Rationale |
|---|---|---|---|---|
| `PR-00.1` | baseline의 기존 테스트 모두 통과 | **PASS** | `verify-run.log`; `LOCAL_VERIFICATION.md`; GitHub Actions `required / verify` | 최종 로컬 `npm run verify`가 291/291 테스트를 통과했고, PR head에 연결된 CI job도 성공했다. |
| `PR-00.2` | 새 보안 테스트가 수정 전 실패하고 수정 후 통과 | **PARTIAL** | `feature-branch-code.patch` → `tests/excelSnapshotIntegrity.test.js`, `tests/excelSnapshotDateRoundTrip.test.js`, `tests/excelSnapshotSync.test.js`; `FIXES_AFTER_VERIFY.md` | 권한·strict parser·날짜·중복·false-exclusion·미리보기 회귀 테스트가 현재 green이다. 다만 수정 전 red 실행 로그나 commit-by-commit red→green 증거는 첨부되지 않았다. |
| `PR-00.3` | apply가 최소 Admin-only | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/authorization.js`, `wrangler.jsonc` | 누락 mode는 `admin-only`, 알 수 없는 mode는 `disabled`로 보수 처리하며 기본 설정도 `admin-only`다. |
| `PR-00.4` | CI green | **PASS** | GitHub Actions run `29744543297` / job `required / verify` | 2026-07-20 현재 PR #13의 CI run이 completed/success이며 npm ci, verify, dependency audit, release evidence, Worker dry-run 단계를 모두 통과했다. |
| `PR-00.5` | production deploy 없음 | **PASS** | `LOCAL_VERIFICATION.md`; `GATE_EVIDENCE.md`; PR #13 본문 | 증거는 로컬/CI non-production 검증과 dry-run에 한정된다. remote D1, live gate, production deploy는 실행하지 않았다고 명시한다. |
| `PR-01.1` | 권한 matrix 전부 테스트 | **PARTIAL** | `feature-branch-code.patch` → `tests/excelSnapshotIntegrity.test.js`, `tests/auth.test.js`, `tests/routingContracts.test.js`, `src/domains/snapshots/domain/authorization.js` | manage-only, move, disposal, non-Admin restore, 권한 실패 무변경과 Admin apply 성공은 확인된다. 다만 각 분기를 실제 route HTTP 호출로 고정한 단일 matrix와 ‘DB 권한 변경 후 기존 session으로 snapshot apply’ 전용 테스트는 명시적으로 완결되지 않았다. |
| `PR-01.2` | 403/409/400 구분 | **PASS** | `feature-branch-code.patch` → `src/handlers/snapshotHandlers.js`, `src/domains/snapshots/domain/errorCodes.js` | 안정적 error code를 403/409/400에 매핑하고 apply 상세 페이지도 매핑된 HTTP status를 `page(..., status)`로 보존한다. |
| `PR-01.3` | UI가 필요한 권한과 부족 권한 표시 | **PASS** | `feature-branch-code.patch` → `src/handlers/snapshotHandlers.js`, `src/views/snapshotViews.js`, `tests/viewContracts.test.js` | 상세 GET/apply 실패 모두 required/missing permission을 구성하며 UI가 필요 권한, 부족 권한, apply 차단 사유를 렌더링한다. |
| `PR-01.4` | permission snapshot이 system audit에 기록 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/auditPayload.js`, `src/domains/snapshots/infrastructure/repository.js`, `applyPlan.js` | 현재 actor의 권한 스냅샷을 versioned apply details와 system audit에 저장한다. |
| `PR-02.1` | 시스템 추출 파일 무수정 재업로드 시 날짜·필드 diff 0 | **PARTIAL** | `feature-branch-code.patch` → `tests/excelSnapshotDateRoundTrip.test.js`, `tests/excelSnapshotSync.test.js`, `src/views/clientScript/excelSnapshots.js` | 세 timezone/1900·1904 ExcelJS buffer round-trip과 export 기반 298 unchanged를 입증한다. 하지만 실제 전체 export XLSX를 한 번도 수정하지 않고 browser parser→stage→prepare까지 통과시켜 create/update/exclude 모두 0임을 단일 end-to-end 테스트로 고정하지는 않았다. |
| `PR-02.2` | 모든 미지 상태가 오류 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/canonicalRow.js`, `tests/excelSnapshotIntegrity.test.js` | 허용값 외 상태와 공란을 구조화 오류로 만들며 오류가 있으면 ready 전환이 불가능하다. |
| `PR-02.3` | CSV 기존 동작 회귀 없음 | **PASS** | `feature-branch-code.patch` → `src/documentCsv.js`, `src/domains/snapshots/domain/canonicalRow.js`; `verify-run.log` | snapshot strict parser를 CSV parser에서 분리했고 전체 회귀 테스트 291건이 통과했다. |
| `PR-02.4` | generated assets check 통과 | **PASS** | `feature-branch-code.patch` → `src/views/clientScript/excelSnapshots.js`, `public/assets/app.js`; `LOCAL_VERIFICATION.md`; CI run | source와 생성 asset이 함께 변경되었고 `npm run check:browser`가 로컬 verify와 CI에서 통과했다. |
| `PR-03.1` | current identity unique index 존재 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql`, `tests/migrationChainContracts.test.js` | `sync_state='current'` 범위에서 `UPPER(document_number), UPPER(revision_number)` partial unique expression index를 추가하고 migration replay로 검증한다. |
| `PR-03.2` | 모든 충돌이 apply 이전 prepare에서 탐지 | **PARTIAL** | `feature-branch-code.patch` → `src/domains/snapshots/domain/matchRows.js`, `tests/excelSnapshotIntegrity.test.js` | 코드는 파일 identity/key 중복, unknown/missing key, 동일 문서 이중 매칭, current identity 변경 충돌, excluded 재포함 key 정책을 prepare에서 처리한다. 다만 계획에 열거된 current 충돌·excluded 재포함 충돌·identity 변경 충돌을 각각 독립 회귀 테스트로 모두 고정한 증거는 부족하다. |
| `PR-03.3` | prepare 이후 경합 충돌도 DB가 최종 차단 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql`, `tests/excelSnapshotIntegrity.test.js` (‘prepare 이후 unique identity 경합’) , `tests/helpers/sqliteD1.js` | prepare 뒤 경쟁 문서를 삽입해 unique index 위반을 유발하고 apply batch 전체가 rollback되는 테스트가 있다. |
| `PR-03.4` | 사용자에게 충돌 문서 식별 정보 제공 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/matchRows.js`, `tests/excelSnapshotIntegrity.test.js` (‘identity 중복 오류…’) ; `FIXES_AFTER_VERIFY.md` | 오류 payload/message에 문서번호, 개정, 충돌 행, 기존 document ID/row key 또는 conflict document ID를 포함한다. |
| `PR-04.1` | export 결과에 영향을 주는 모든 mutation이 version 증가 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql`, `tests/migrationChainContracts.test.js` | categories, tags, racks, rack_slots, document_tags에 version bump trigger를 추가하고 기존 documents 경로와 함께 replay 계약으로 확인한다. |
| `PR-04.2` | metadata 없는 파일이 현재 version으로 조용히 재기준화되지 않음 | **PASS** | `feature-branch-code.patch` → `src/views/clientScript/excelSnapshots.js`, `src/domains/snapshots/infrastructure/repository.js`, `tests/excelSnapshotIntegrity.test.js` | managed mode는 schema/base/provenance metadata를 요구하고 metadata 부재는 명시적 bootstrap으로만 전송되어 Admin·최초 상태 검사를 받는다. |
| `PR-04.3` | stale snapshot 반복 apply 불가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/infrastructure/repository.js`, `tests/excelSnapshotIntegrity.test.js` (‘prepare 중…failed terminal’) ; `FIXES_AFTER_VERIFY.md` | prepare/apply stale을 `failed` terminal 상태로 전환하고 감사 이벤트를 남기며 ready 상태 반복 적용을 막는다. |
| `PR-04.4` | version은 단조 증가 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql`, `src/domains/snapshots/infrastructure/applyPlan.js`, `tests/excelSnapshotSync.test.js` | trigger와 apply가 현재값 기준 `current_version + 1`을 사용하고 테스트는 정확한 증가 폭이 아니라 `>`만 가정한다. |
| `PR-05.1` | 모든 exclusion이 document ID 기반 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/matchRows.js`, `migrations/0031_excel_snapshot_integrity.sql` | matched document ID 집합의 차집합을 `document_snapshot_exclusions`에 document_id/expected row version/key로 저장한다. |
| `PR-05.2` | UI·audit·UPDATE의 exclusion 집합 동일 | **PASS** | `feature-branch-code.patch` → `repository.js`, `applyPlan.js`, `snapshotViews.js`, `tests/excelSnapshotIntegrity.test.js` | 미리보기 조회, exclude 감사 INSERT, 실제 sync_state UPDATE가 모두 동일 exclusion table을 source로 사용하며 count 일치 테스트가 있다. |
| `PR-05.3` | 기존 문서 관리 ID 불필요 변경 없음 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/matchRows.js`, `applyPlan.js`, `tests/excelSnapshotSync.test.js` | 기존 문서 매칭 시 existing `excel_row_key`를 effective key로 유지하고 신규 blank key에만 서버 키를 생성한다. |
| `PR-05.4` | snapshot detail에서 exact diff 조회 가능 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql`, `repository.js`, `snapshotViews.js`, `tests/excelSnapshotIntegrity.test.js` | before/after, changed fields, change flags, tags를 영속화·조회·변경필드 중심 UI로 표시한다. |
| `PR-06.1` | 위치 변화와 movement log count 일치 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/infrastructure/applyPlan.js`, `tests/excelSnapshotIntegrity.test.js` | 실제 slot/face 차이가 있는 update만 set-based movement INSERT하며 move 1→log 1, 동일 위치→log 0을 검증한다. |
| `PR-06.2` | 상태 변화와 disposal log count 일치 | **PASS** | `feature-branch-code.patch` → `applyPlan.js`, `tests/excelSnapshotIntegrity.test.js` | status가 실제로 바뀐 문서만 disposed/restored를 기록하고 dispose·restore 각각의 count를 검증한다. |
| `PR-06.3` | 모든 apply audit에 reason/actor/snapshot 포함 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/auditPayload.js`, `applyPlan.js`, `repository.js` | document/system audit에 actor, snapshotCode, apply reason, approval reference, canonical hash와 권한 스냅샷을 저장한다. |
| `PR-06.4` | D1 batch atomicity contract test 통과 | **PASS** | `feature-branch-code.patch` → `applyPlan.js`, `tests/excelSnapshotIntegrity.test.js`, `tests/excelSnapshotSync.test.js`, `tests/helpers/sqliteD1.js` | 중간 SQL fault injection, concurrent claim, unique-race rollback, completed 재호출, 1,000행 17-statement apply를 직접 테스트한다. |
| `PR-07.1` | 사용자가 제외 문서 이름을 반영 전에 볼 수 있음 | **PASS** | `feature-branch-code.patch` → `src/views/snapshotViews.js`, `tests/excelSnapshotIntegrity.test.js` | 별도 exclusion 표에 문서번호·개정·문서명·상태·현재 위치·제외 사유를 표시한다. |
| `PR-07.2` | 위치·폐기 해제를 즉시 구분 가능 | **PASS** | `feature-branch-code.patch` → `src/views/snapshotViews.js` | summary metric, filter, change flag badge와 상태 변화 열로 MOVE/DISPOSE/RESTORE를 분리한다. |
| `PR-07.3` | excluded 문서가 정상 current처럼 보이지 않음 | **PASS** | `feature-branch-code.patch` → `src/views/documents/detailView.js`, `src/views/setViews.js`, `src/domains/sets/infrastructure/repository.js`, `tests/viewContracts.test.js` | 상세/세트에 excluded badge와 경고를 표시하고 mutation action을 숨기며 rack map 집계는 current만 사용한다. |
| `PR-07.4` | 서버 권한이 UI 상태와 무관하게 최종 차단 | **PASS** | `feature-branch-code.patch` → `repository.js`, `authorization.js`, `tests/excelSnapshotIntegrity.test.js` | apply application service가 현재 actor로 권한을 다시 계산하고 권한 부족 시 snapshot/document 무변경을 검증한다. |
| `PR-08.1` | audit 결과 report 생성 | **PARTIAL** | `feature-branch-code.patch` → `scripts/audit-excel-snapshot-data.mjs`; `local-sample-audit.json`; `GATE_EVIDENCE.md` | 실제 read-only local sample report가 생성되었고 5개 finding은 모두 0이다. 그러나 계획의 8개 감사 항목 중 movement-log 불일치, Excel restore 후보, snapshot count↔actual mutation count 대조가 report에 구현되지 않았다. |
| `PR-08.2` | 자동 수정 없음 | **PASS** | `feature-branch-code.patch` → `scripts/audit-excel-snapshot-data.mjs` | SQLite를 `readOnly: true`로 열고 SELECT 결과를 JSON으로만 쓰며 UPDATE/DELETE를 수행하지 않는다. |
| `PR-08.3` | correction 절차 문서화 | **PASS** | `feature-branch-code.patch` → `docs/OPERATIONS.md`, `scripts/audit-excel-snapshot-data.mjs` | append-only 로그를 삭제하지 않고 correction event/controlled correction snapshot/backup restore로 보완하는 절차를 문서화한다. |
| `PR-08.4` | backup/restore 확인 | **PARTIAL** | `feature-branch-code.patch` → `docs/OPERATIONS.md`; `GATE_EVIDENCE.md` | backup/restore 절차와 human ops 명령은 준비되었으나 production credential/승인이 필요한 실제 restore drill은 수행되지 않았다. 이는 명시된 production-ops-only 범위다. |
| `PR-08.5` | production rollout checklist 승인 | **PARTIAL** | `feature-branch-code.patch` → `docs/OPERATIONS.md`, `wrangler.jsonc`; `GATE_EVIDENCE.md`; PR #13 본문 | disabled→admin-only→permissioned 체크리스트와 운영 절차는 존재하지만 production UAT/승인 서명과 live gate 전환은 수행되지 않았다. |
| `PR-08.6` | 모든 CI gate green | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; GitHub Actions run `29744543297` | 로컬 full verify·dependency audit·release evidence·dry-run이 PASS이고, PR required CI job도 completed/success다. |

## 5. Section 34 code-review checklist

| ID | Criterion | Status | File evidence | Rationale |
|---|---|---|---|---|
| `CR-PERM-01` | upload와 apply 권한이 분리되었는가 | **PASS** | `feature-branch-code.patch` → `src/app/routeRegistry.js`, `src/permissions.js`, `migrations/0031_excel_snapshot_integrity.sql` | create/stage/prepare는 문서관리 권한, apply는 별도 `can_apply_document_snapshots` route policy와 domain guard를 사용한다. |
| `CR-PERM-02` | move/dispose/restore 추가 권한을 계산하는가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/authorization.js`, `diff.js` | persisted diff summary로 move/disposal 권한을 합성하고 restore는 Admin을 요구한다. |
| `CR-PERM-03` | apply 시 현재 session으로 재검사하는가 | **PASS** | `feature-branch-code.patch` → `repository.js`, `src/auth/session.js`; `verify-run.log` | session이 DB 권한을 매 요청 재조회하고 apply 직전 actor 기준 authorization을 다시 수행한다. |
| `CR-PERM-04` | 권한 부족이 403인가 | **PASS** | `feature-branch-code.patch` → `src/handlers/snapshotHandlers.js`, `errorCodes.js`, `tests/excelSnapshotIntegrity.test.js` | apply/move/disposal/restore/bootstrap authorization error가 403으로 매핑된다. |
| `CR-PERM-05` | UI 숨김에만 의존하지 않는가 | **PASS** | `feature-branch-code.patch` → `repository.js`, `authorization.js` | UI 상태와 무관하게 application service가 apply를 거부한다. |
| `CR-PERM-06` | bootstrap이 Admin-only인가 | **PASS** | `feature-branch-code.patch` → `repository.js`, `authorization.js` | snapshot create와 apply 양쪽에서 bootstrap Admin 조건을 검사하고 기존 snapshot이 있으면 재실행을 거부한다. |
| `CR-IN-01` | 중요 필드 공란이 오류인가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/canonicalRow.js`, `tests/excelSnapshotIntegrity.test.js` | 개정·날짜·폐기년도·문서명·분류·랙/열/선반/면·상태 공란을 오류로 처리한다. |
| `CR-IN-02` | unknown status가 오류인가 | **PASS** | `feature-branch-code.patch` → `canonicalRow.js` | 보관중/폐기/active/disposed 이외 값은 `SNAPSHOT_INVALID_FIELD`로 실패한다. |
| `CR-IN-03` | 날짜가 timezone independent인가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/dateOnly.js`, `src/views/clientScript/excelSnapshots.js`, `tests/excelSnapshotDateRoundTrip.test.js` | UTC calendar-date 변환과 1900/1904 serial을 지원하며 UTC/Asia-Seoul/America-Los_Angeles subprocess에서 ExcelJS buffer round-trip을 검증한다. |
| `CR-IN-04` | row key가 서버 권위인가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/identity.js`, `matchRows.js`, `src/views/clientScript/excelSnapshots.js` | 브라우저는 blank key를 유지하고 서버가 신규 문서의 stable key를 생성한다. |
| `CR-IN-05` | partial key 상황이 명시적으로 처리되는가 | **PASS** | `feature-branch-code.patch` → `matchRows.js`, `repository.js` | duplicate, unknown, existing-row key missing, excluded identity, 신규 blank key를 서로 다른 안정적 오류/경로로 처리한다. |
| `CR-IN-06` | schemaVersion을 서버가 검사하는가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/hash.js`, `repository.js`, `tests/excelSnapshotIntegrity.test.js` | 지원 버전 set을 create 시 검사하고 unsupported version을 snapshot 생성 전에 거부한다. |
| `CR-DATA-01` | current identity unique인가 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql`, `matchRows.js` | application prepare 검증과 DB partial unique index를 함께 둔다. |
| `CR-DATA-02` | exclusion이 document ID 기반인가 | **PASS** | `feature-branch-code.patch` → `matchRows.js`, `migrations/0031_excel_snapshot_integrity.sql` | exclusion row에 document_id, row key, expected row_version, before JSON을 저장한다. |
| `CR-DATA-03` | before/after에 tags가 포함되는가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/diff.js`, `applyPlan.js` | 동일 shape의 canonical before/after에 tagIds/tagNames를 정렬해 포함하고 audit가 해당 JSON을 사용한다. |
| `CR-DATA-04` | excluded/current가 화면에서 분리되는가 | **PASS** | `feature-branch-code.patch` → `src/views/documents/detailView.js`, `src/views/setViews.js`, `src/data/documentsData.js` | 문서 상세와 세트에서 별도 badge/경고/집계를 제공하고 mutation action과 current-only map을 분리한다. |
| `CR-DATA-05` | master data 변경이 version을 올리는가 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql` | category/tag/rack/slot/document_tags의 INSERT/UPDATE/DELETE trigger가 version epoch를 증가시킨다. |
| `CR-AUD-01` | 감사 INSERT가 UPDATE보다 먼저인가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/infrastructure/applyPlan.js` | existing update/exclusion의 document audit와 movement/disposal 이력이 document UPDATE/exclusion UPDATE보다 앞선 고정 순서다. |
| `CR-AUD-02` | 동일 guard를 사용하는가 | **PASS** | `feature-branch-code.patch` → `applyPlan.js`; `FIXES_AFTER_VERIFY.md`; `tests/excelSnapshotIntegrity.test.js` | audit, movement/status, tag DELETE/INSERT, document UPDATE가 applying snapshot + matched document + expected row_version + sync_state pre-state를 공유하고 snapshot ID는 bind한다. |
| `CR-AUD-03` | reason/approval reference가 저장되는가 | **PASS** | `feature-branch-code.patch` → `authorization.js`, `auditPayload.js`, `applyPlan.js`, `snapshotViews.js` | 길이/조건부 필수 검증 후 snapshot, document audit, system audit, movement/disposal reason에 normalized 값을 사용한다. |
| `CR-AUD-04` | movement와 status 업무 이력이 생성되는가 | **PASS** | `feature-branch-code.patch` → `applyPlan.js`, `tests/excelSnapshotIntegrity.test.js` | 위치 및 상태 변화만 set-based business log로 기록한다. |
| `CR-AUD-05` | 잘못된 과거 로그를 삭제하지 않는가 | **PASS** | `feature-branch-code.patch` → `scripts/audit-excel-snapshot-data.mjs`, `docs/OPERATIONS.md` | 감사는 read-only이고 과거 append-only 로그는 correction event로 보완하도록 문서화한다. |
| `CR-AUD-06` | 내부 storage code가 공개 payload에 없는가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/diff.js`, `snapshotViews.js`, `documentCsv.js` | 공개 canonical diff/UI/CSV/search shape에 storage_code를 포함하지 않는다. |
| `CR-ATOM-01` | 하나의 D1 batch인가 | **PASS** | `feature-branch-code.patch` → `repository.js`, `applyPlan.js` | 전체 apply statement를 하나의 `env.DB.batch()` 호출로 실행한다. |
| `CR-ATOM-02` | statement ≤40인가 | **PASS** | `feature-branch-code.patch` → `applyPlan.js`, `tests/excelSnapshotSync.test.js`, `src/freeTierBudget.js` | 행 수와 무관한 고정 17 statements이며 1,000행 테스트에서 40 이하를 단언한다. |
| `CR-ATOM-03` | set-based SQL인가 | **PASS** | `feature-branch-code.patch` → `applyPlan.js` | snapshot rows/exclusions와 `json_each`를 source로 사용하며 문서별 statement를 만들지 않는다. |
| `CR-ATOM-04` | 1,000건 테스트가 있는가 | **PASS** | `feature-branch-code.patch` → `tests/excelSnapshotSync.test.js`; `FIXES_AFTER_VERIFY.md` | 1,000 create + 2 exclusions를 실제 apply하고 statementCount=17, completed, final counts를 검증한다. |
| `CR-ATOM-05` | stale/concurrent/unique failure rollback test가 있는가 | **PASS** | `feature-branch-code.patch` → `tests/excelSnapshotIntegrity.test.js`, `tests/helpers/sqliteD1.js` | prepare stale terminal, concurrent claim, mid-batch fault, prepare-after-unique-race, permission no-change를 명시적으로 테스트한다. |
| `CR-ATOM-06` | completed 재호출이 idempotent인가 | **PASS** | `feature-branch-code.patch` → `repository.js`, `tests/excelSnapshotIntegrity.test.js` | completed 상태와 concurrent claim 후 재호출 모두 `alreadyApplied` success를 반환한다. |
| `CR-UI-01` | 제외 문서 이름을 반영 전에 볼 수 있는가 | **PASS** | `feature-branch-code.patch` → `snapshotViews.js`, `tests/excelSnapshotIntegrity.test.js` | 별도 제외 표에 문서 식별·상태·위치를 표시한다. |
| `CR-UI-02` | before/after를 볼 수 있는가 | **PASS** | `feature-branch-code.patch` → `snapshotViews.js` | changedFields만 선택해 변경 전/후 값을 표시한다. |
| `CR-UI-03` | 위치·폐기·복구가 별도 표시되는가 | **PASS** | `feature-branch-code.patch` → `snapshotViews.js` | metric/filter/badge/상태 변화 열로 구분한다. |
| `CR-UI-04` | 위험 임계치가 표시되는가 | **PASS** | `feature-branch-code.patch` → `src/domains/snapshots/domain/diff.js`, `repository.js`, `snapshotHandlers.js`, `snapshotViews.js`, `tests/excelSnapshotIntegrity.test.js`; `FIXES_AFTER_VERIFY.md` | prepare warnings를 영속화하고 상세에서 EXCLUSION/LARGE_CHANGE/MISSING_PERMISSION 등을 시각적 alert로 렌더링한다. |
| `CR-UI-05` | sync_state badge가 있는가 | **PASS** | `feature-branch-code.patch` → `src/views/documents/detailView.js`, `src/views/setViews.js` | excluded badge와 경고를 문서 상세/세트 행에 제공한다. |
| `CR-UI-06` | HTML escaping과 접근성이 유지되는가 | **PASS** | `feature-branch-code.patch` → `snapshotViews.js`, `tests/viewContracts.test.js`; `verify-run.log` | 동적 값을 escape하고 role/aria-live/label을 유지하며 view/security 회귀 테스트가 통과한다. |
| `CR-DEP-01` | 새 migration만 추가했는가 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql`, `migrations/manifest.json`; `check:migrations` | 과거 migration을 수정하지 않고 0031과 manifest entry만 추가했으며 checksum/schema/FK 검사가 통과했다. |
| `CR-DEP-02` | route catalog를 갱신했는가 | **PASS** | `feature-branch-code.patch` → `src/app/routeRegistry.js`, `docs/generated/ROUTE_PERMISSION_CATALOG.md`; `check:routes` | source route와 generated permission catalog가 일치한다. |
| `CR-DEP-03` | browser assets를 build로 갱신했는가 | **PASS** | `feature-branch-code.patch` → `src/views/clientScript/excelSnapshots.js`, `public/assets/app.js`; `check:browser` | source와 generated asset이 대응하며 drift check가 local/CI에서 통과했다. |
| `CR-DEP-04` | verify/audit/dry deploy가 통과했는가 | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; GitHub Actions run `29744543297` | verify 291, dependency audit, release evidence, Worker dry-run이 모두 non-production PASS다. |
| `CR-DEP-05` | backup/UAT/rollout mode가 준비되었는가 | **PARTIAL** | `feature-branch-code.patch` → `docs/OPERATIONS.md`, `wrangler.jsonc`; `GATE_EVIDENCE.md` | mode와 checklist/rollback 문서는 준비됐다. production backup restore drill, live-data UAT sign-off, live gate 승인·전환은 human ops-only로 미실행이다. |

## 6. Section 35 overall definition of done

| ID | Criterion | Status | File evidence | Rationale |
|---|---|---|---|---|
| `DoD-01` | 일반 문서관리 권한만으로 snapshot apply를 할 수 없다 | **PASS** | `feature-branch-code.patch` → `authorization.js`, `tests/excelSnapshotIntegrity.test.js` | 전용 apply 권한이 없으면 거부하고 snapshot/document가 변하지 않는다. |
| `DoD-02` | 위치·폐기·폐기 해제 권한 우회가 불가능하다 | **PASS** | `feature-branch-code.patch` → `authorization.js`, `tests/excelSnapshotIntegrity.test.js` | move/disposal 권한을 추가 요구하며 restore는 Admin만 허용한다. |
| `DoD-03` | Asia/Seoul에서 날짜 round-trip이 보존된다 | **PASS** | `feature-branch-code.patch` → `tests/excelSnapshotDateRoundTrip.test.js`, `dateOnly.js`, `excelSnapshots.js` | Asia/Seoul subprocess에서 ExcelJS workbook→buffer→load를 5개 날짜, 1900/1904 mode로 통과한다. |
| `DoD-04` | 공란·오타가 조용히 기본값으로 변하지 않는다 | **PASS** | `feature-branch-code.patch` → `canonicalRow.js`, `tests/excelSnapshotIntegrity.test.js` | strict validation 오류가 한 건이라도 있으면 failed이며 current documents는 무변경이다. |
| `DoD-05` | 현재 대장 identity가 DB와 애플리케이션 양쪽에서 유일하다 | **PASS** | `feature-branch-code.patch` → `matchRows.js`, `migrations/0031_excel_snapshot_integrity.sql` | prepare 검증과 DB unique index가 이중 방어한다. |
| `DoD-06` | 관리 ID 없는 신규 행은 서버가 ID를 생성한다 | **PASS** | `feature-branch-code.patch` → `identity.js`, `matchRows.js`, `excelSnapshots.js` | 브라우저가 영구 ID를 만들지 않고 서버가 stable key를 발급한다. |
| `DoD-07` | 기존 관리 ID가 불필요하게 바뀌지 않는다 | **PASS** | `feature-branch-code.patch` → `matchRows.js`, `applyPlan.js` | existing key를 유지하고 key 누락은 오류로 처리한다. |
| `DoD-08` | 기준정보 변경 후 오래된 파일이 차단된다 | **PASS** | `feature-branch-code.patch` → `migrations/0031_excel_snapshot_integrity.sql`, `repository.js` | master/tag version trigger와 create/prepare/apply equality guard가 stale을 차단한다. |
| `DoD-09` | metadata 없는 파일은 명시적 bootstrap 외에는 거부된다 | **PASS** | `feature-branch-code.patch` → `excelSnapshots.js`, `repository.js` | metadata 부재는 explicit bootstrap mode로만 처리되고 Admin/first-run 조건을 검사한다. |
| `DoD-10` | unsupported schemaVersion이 거부된다 | **PASS** | `feature-branch-code.patch` → `hash.js`, `repository.js`, `tests/excelSnapshotIntegrity.test.js` | 지원 set 외 schema는 snapshot 생성 전에 실패한다. |
| `DoD-11` | exclusion 미리보기·감사·실제 UPDATE가 같은 문서 집합을 사용한다 | **PASS** | `feature-branch-code.patch` → `repository.js`, `applyPlan.js`, `snapshotViews.js` | 세 경로가 persisted exclusion table을 공유한다. |
| `DoD-12` | 실제 제외 없는 false exclusion 감사로그가 생성되지 않는다 | **PASS** | `feature-branch-code.patch` → `matchRows.js`, `applyPlan.js`, `tests/excelSnapshotSync.test.js` | matched document ID 차집합만 exclusion/audit source로 사용하며 실제 exclusion count와 audit count를 대조한다. |
| `DoD-13` | before/after와 tags가 감사 근거로 남는다 | **PASS** | `feature-branch-code.patch` → `diff.js`, `applyPlan.js`, `migrations/0031_excel_snapshot_integrity.sql` | versioned before/after JSON에 tags와 changed fields/flags가 남는다. |
| `DoD-14` | 위치 변경마다 movement log가 남는다 | **PASS** | `feature-branch-code.patch` → `applyPlan.js`, `tests/excelSnapshotIntegrity.test.js` | 실제 위치 차이마다 정확히 한 건을 기록한다. |
| `DoD-15` | 상태 변경마다 disposal/restore log가 남는다 | **PASS** | `feature-branch-code.patch` → `applyPlan.js`, `tests/excelSnapshotIntegrity.test.js` | active↔disposed 변화만 disposed/restored로 기록한다. |
| `DoD-16` | apply reason과 필요한 approval reference가 남는다 | **PASS** | `feature-branch-code.patch` → `authorization.js`, `snapshotViews.js`, `applyPlan.js` | reason 10–500자와 조건부 approval reference를 검사·저장한다. |
| `DoD-17` | excluded 문서가 current 문서처럼 표시되지 않는다 | **PASS** | `feature-branch-code.patch` → `detailView.js`, `setViews.js`, `sets/infrastructure/repository.js` | badge/경고/action 차단/current-only map으로 구분한다. |
| `DoD-18` | 1,000건 apply가 statement 40 이하로 원자 처리된다 | **PASS** | `feature-branch-code.patch` → `tests/excelSnapshotSync.test.js`, `applyPlan.js` | 1,000행 실적용이 단일 batch, 17 statements, final completed로 검증됐다. |
| `DoD-19` | stale, 권한 오류, 중복, DB 오류 시 한 행도 바뀌지 않는다 | **PASS** | `feature-branch-code.patch` → `tests/excelSnapshotIntegrity.test.js`, `tests/helpers/sqliteD1.js`, `repository.js`, `applyPlan.js` | permission no-change, prepare duplicate/stale, concurrent claim, mid-batch SQL fault, unique race rollback을 직접 검증한다. |
| `DoD-20` | 최신 export 무수정 재업로드가 0 diff다 | **PARTIAL** | `feature-branch-code.patch` → `tests/excelSnapshotSync.test.js`, `tests/excelSnapshotDateRoundTrip.test.js`, `excelSnapshots.js` | export된 300행 중 변경하지 않은 298행이 unchanged이고 날짜 XLSX round-trip도 보존된다. 그러나 ‘전체 최신 XLSX를 완전 무수정 재업로드해 create/update/exclude=0’을 단일 통합 테스트로 증명하지 않았다. |
| `DoD-21` | OOXML 호환 파일과 rack ID 링크가 회귀하지 않는다 | **PASS** | `feature-branch-code.patch` → `src/views/clientScript/excelSnapshots.js`, `excelOpenXmlCompatibility.js` 연결; `verify-run.log` | 기존 OOXML compatibility path를 유지하고 ExcelJS/OOXML 및 exact rack filter 회귀 테스트가 291-suite 내 통과한다. |
| `DoD-22` | migration replay, route catalog, browser drift, 전체 test, dependency audit, dry deploy가 모두 통과한다 | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; GitHub Actions run `29744543297` | 요구된 non-production quality gates가 로컬과 required CI에서 모두 green이다. |
| `DoD-23` | 데이터 감사 report와 correction 절차가 준비되어 있다 | **PARTIAL** | `local-sample-audit.json`; `feature-branch-code.patch` → `scripts/audit-excel-snapshot-data.mjs`, `docs/OPERATIONS.md` | 실제 sample report와 correction 절차는 존재한다. 다만 계획의 8개 감사 범주 중 3개가 report에 빠져 있어 전체 audit scope는 미완성이다. |
| `DoD-24` | production rollout이 disabled → admin-only → permissioned 순으로 수행 가능하다 | **PASS** | `feature-branch-code.patch` → `authorization.js`, `wrangler.jsonc`, `docs/OPERATIONS.md` | 세 mode, 보수적 fallback, 단계별 운영 절차가 구현·문서화되어 있다. 실제 live 전환은 별도 human ops다. |
| `DoD-25` | 최종 PR 설명에 변경 근거, 검증 증거, 남은 위험, rollback 절차가 포함되어 있다 | **PARTIAL** | GitHub PR #13 본문; `feature-branch-code.patch` → `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` | PR 본문은 변경 요약·검증·production blockers를 담고 있으나 명시적 rollback 절과 상세 remaining-risk 절은 없다. rollback 문서는 저장소에 있으나 criterion은 PR 설명 자체를 요구한다. |

## 7. Section 29 verification command gates

| ID | Criterion | Status | File evidence | Rationale |
|---|---|---|---|---|
| `GATE-01` | npm ci | **PASS** | GitHub Actions run `29744543297`, job `required / verify`, step `Run npm ci` | CI step이 completed/success다. |
| `GATE-02` | npm run check | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; CI | syntax check PASS다. |
| `GATE-03` | npm run typecheck | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; CI | TypeScript JS-check PASS다. |
| `GATE-04` | npm run lint | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; CI | ESLint zero warnings PASS다. |
| `GATE-05` | npm run format:check | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; CI | format check PASS다. |
| `GATE-06` | npm run check:migrations | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; CI | 31 migrations checksum/schema/FK 검사가 PASS다. |
| `GATE-07` | npm run check:routes | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; CI | 105 routes catalog/permission matrix check가 PASS다. |
| `GATE-08` | npm run check:browser | **PASS** | `LOCAL_VERIFICATION.md`; `verify-run.log`; CI | browser search/CSS/JS asset drift check가 PASS다. |
| `GATE-09` | npm test | **PASS** | `verify-run.log`; `LOCAL_VERIFICATION.md`; CI | 291 tests, 291 pass, 0 fail이다. |
| `GATE-10` | npm run verify | **PASS** | `verify-run.log`; `LOCAL_VERIFICATION.md`; CI | check/typecheck/lint/format/migrations/routes/browser/test aggregate가 PASS다. |
| `GATE-11` | npm run audit:dependencies | **PASS** | `LOCAL_VERIFICATION.md`; GitHub Actions job step `Dependency audit` | local evidence와 CI가 모두 PASS다. |
| `GATE-12` | npm run release:evidence | **PASS** | `LOCAL_VERIFICATION.md`; GitHub Actions job step `Migration and schema evidence` | release evidence gate가 PASS다. |
| `GATE-13` | npm run deploy:dry | **PASS** | `LOCAL_VERIFICATION.md`; GitHub Actions job step `Worker dry-run and bundle report` | bundle dry-run만 실행했으며 production deploy는 하지 않았다. |
| `GATE-14` | git diff --check | **PASS** | `LOCAL_VERIFICATION.md` | 첨부 최종 검증표에 PASS가 명시되어 있다. |
| `GATE-15` | git status --short | **PARTIAL** | `IMPROVEMENT_PLAN.md` §29; 첨부 evidence set | 요구 command이지만 실제 출력 또는 명시적 PASS 기록이 첨부되지 않았다. CI clean checkout은 working-tree command 실행 증거를 대체하지 않는다. |

## 8. Remaining actionable gaps

### A. Code/test-fixable

1. **Add one true untouched-XLSX zero-diff integration test.** Generate the current ledger workbook with the production browser/export contract, load the buffer, run the same upload parser, stage, and prepare without edits; assert create/update/exclude/move/dispose/restore/tag-change all equal zero and unchanged equals the full row count.
2. **Complete the explicit authorization matrix.** Add route-level tests for Admin success, manage-only, missing move, missing disposal, non-Admin restore, bootstrap non-Admin, and an existing session whose DB permission changes immediately before apply.
3. **Complete the explicit identity-conflict matrix.** Add independent tests for existing-current identity collision, excluded reinclude collision, identity change into another current document, unknown external key, missing key for existing current/excluded row, and case-only variants.
4. **Complete the read-only audit scope.** Add queries/report sections for movement-log mismatch candidates, Excel restore candidates, and snapshot summary counts versus actual mutations. Keep the tool read-only and label heuristic matches as candidates, not proven defects.
5. **Add file/ZIP safety limits.** The patch caps row count/chunk size but does not clearly enforce source byte size or ZIP expansion limits before ExcelJS/JSZip processing.
6. **Strengthen export provenance.** `exportManifestId` is generated for export but is not persisted/validated as an authoritative server manifest; add a manifest table/signature or exact current snapshot provenance check.
7. **Strengthen bootstrap acknowledgment.** Replace simple `window.confirm()` with typed confirmation and a server-validated backup acknowledgment field if the operational SOP requires it.
8. **Finish lower-level review metadata.** Consider snapshot linkage in movement/disposal business logs and the plan’s richer exclusion warnings (set count/recent movement or loan) plus an explicit server guard against adding excluded documents to new sets.

### B. Process/documentation-fixable

1. Retain a red-before/green-after transcript or commit reference for the mandatory P0/P1 regression tests.
2. Capture and attach the actual `git status --short` output after final verification.
3. Update the PR description itself—not only linked docs—with an explicit remaining-risks section and rollback procedure.

### C. Production-operations-only

- Run the audit against an approved production backup/export copy and review findings.
- Complete the production backup/restore drill with authorized credentials and approvals.
- Obtain production UAT sign-off and training/permission approvals.
- Perform the live `disabled → admin-only → permissioned` feature-gate rollout and post-apply reconciliation.

These production steps are deliberately **not** code FAILs; preparation artifacts exist and the user’s scope contract classifies them as PARTIAL until human operations complete them.

## 9. Confidence notes

- **High confidence:** permission model, strict parser, date-only algorithm and timezone/ExcelJS test, identity index, diff/exclusion persistence, shared apply guards, set-based 17-statement plan, rollback/concurrency tests, risk-warning UI, excluded-state UI, and green local/CI gates. These are directly visible in the patch/tests and corroborated by current branch file spot-checks.
- **Moderate confidence:** broad regression claims such as OOXML/rack/CSV continuity rely partly on the aggregate 291-test log rather than every test source being individually re-executed in this sandbox. The CI required job independently passed the same repository checks.
- **Moderate confidence:** the original patch is UTF-16LE and its unified-diff stream is malformed at one hunk boundary for `git apply`; it was inspected by per-file `diff --git` sections and cross-checked against current branch files through GitHub. This affects mechanical checkout convenience, not the identified code evidence.
- **Lower confidence / intentionally unverified:** production data quality, backup restorability, live UAT, live feature-gate state, and production rollout behavior because no production access was provided or claimed.

## 10. Final disposition

The feature branch is **substantially compliant and has no remaining explicit FAIL row in the 119-criterion matrix**, but it does **not fully satisfy** the entire attached plan yet. It is appropriate for continued review/merge consideration only with the 12 PARTIAL findings understood: the most material agent-fixable gaps are the single untouched-XLSX 0-diff proof, complete authorization/identity test matrices, and the three missing audit categories. Production UAT/rollout remains a separate human-operations gate.
