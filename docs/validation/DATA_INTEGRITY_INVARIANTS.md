# Data Integrity Invariants

기준일 2026-07-19, HEAD `aa076e44f96686994c089d51b977cef024f8c1a0`의 schema와
critical mutation 불변식을 고정한다.

## Migration과 schema manifest

- migration은 `0001`~`0027` 연속 번호이며 append-only다.
- 과거 migration의 수정·삭제·번호 변경을 금지한다.
- 빈 D1 전체 적용 후 `PRAGMA foreign_keys = 1`, `PRAGMA foreign_key_check` 결과는 0행이다.

애플리케이션 테이블 22개:

```text
app_users
categories
disposal_batch_items
disposal_batches
disposal_logs
document_audit_logs
document_import_items
document_import_jobs
document_movements
document_set_items
document_set_logs
document_sets
document_tags
documents
floor_plan_regions
login_throttle
rack_slots
racks
search_clicks
search_logs
system_audit_logs
tags
```

불변성 trigger 9개:

```text
trg_disposal_logs_no_update
trg_document_audit_logs_no_delete
trg_document_audit_logs_no_update
trg_document_movements_no_delete
trg_document_movements_no_update
trg_document_set_logs_no_delete
trg_document_set_logs_no_update
trg_system_audit_logs_no_delete
trg_system_audit_logs_no_update
```

## D1 atomicity 규칙

1. 여러 상태를 함께 바꾸는 command는 한 `env.DB.batch()` 안에 둔다.
2. audit/history INSERT는 UPDATE/DELETE보다 먼저 실행해 pre-state를 기록한다.
3. 선행 INSERT도 같은 pre-state SQL guard를 사용한다. application 사전조회만 믿지 않는다.
4. no-op·낙관적 잠금 실패 시 ghost audit/history가 생기지 않아야 한다.
5. batch 마지막의 상태변경 `changes`를 확인해 경합을 감지한다.
6. 모든 SQL 값은 bind parameter를 사용한다.
7. 요청당 D1 statement 내부 한도는 40이다.

## 문서 lifecycle

| command | 고정 순서 | guard |
|---|---|---|
| create | document → tags → document audit → `ARC-*` 확정 | document number+revision duplicate 없음 |
| update | document audit → tag delete/insert → document UPDATE | active + `updated_at` + `row_version` |
| dispose | disposal log → document audit → status UPDATE | active + `updated_at` + `row_version` |
| restore | disposal log → document audit → system audit → status UPDATE | disposed + `updated_at` + `row_version` |
| move | document audit → movement → system audit → document UPDATE | source/target slot + active + optimistic lock |
| permanent delete | immutable document snapshot → system audit → DELETE | disposed + optimistic lock |

- 문서 수정과 이동은 `updated_at`과 단조 증가 `row_version`을 함께 검사한다.
- 위치 이동은 source와 target rack/slot 존재·활성·면 규칙을 모든 batch step에서 재검사한다.
- 영구삭제 전 태그와 폐기 이력을 FK 없는 immutable audit details에 snapshot한다.
- 내부 `storage_code`/`ARC-*`는 DB와 audit 내부 식별에는 남지만 검색, browser index, CSV,
  일반 화면과 사용자 노출 audit details에는 나타나면 안 된다.

## 폐기 캠페인

- draft → frozen → processing → completed 상태 전이를 유지한다.
- freeze는 문서 id, 위치, `updated_at`, `row_version`을 item snapshot으로 저장한다.
- process는 최대 25건을 token으로 선점하고 8 batch statements로 집합 처리한다.
- disposal log와 document audit가 모두 존재할 때만 문서를 disposed로 바꾼다.
- 동결 뒤 상태·시간·version이 바뀐 문서는 `changed`이며 자동 폐기하지 않는다.
- 같은 token/idempotency key의 재시도는 중복 log를 만들지 않는다.
- 처리 요청은 사전조회 포함 9 statements, 코드 상한 10 이하다.

## CSV import

- 작업당 최대 50행을 한 staging statement로 저장한다.
- processing token으로 pending 1행만 선점한다.
- category/tag/rack slot은 처리 시점에도 다시 검증한다.
- active 행은 8 batch statements, disposed 행은 11 batch statements다.
- 문서 생성·태그·감사·item 완료·보관코드 확정·job 집계를 한 batch에 둔다.
- 알려진 행 제약 오류만 해당 행을 failed로 닫고, 일시적 infrastructure 오류는 throw하여
  rollback된 pending 행부터 재시도한다.

## 세트·기준정보·사용자·랙

- 세트 변경은 history → set touch/state → membership 순서를 유지하고 잠금 guard를 모든 step에 둔다.
- 세트 잠금은 set history → system audit → state UPDATE 순서다.
- category/tag/user/rack 상태 변경은 system audit가 UPDATE보다 먼저다.
- Admin은 세부 permission flag와 무관하게 모든 권한을 유지한다.
- disabled 사용자는 기존 cookie가 남아도 매 요청 DB 재조회에서 즉시 무효다.
- 랙은 면당 7열×6선반이며, 단면은 `13`, 양면은 `13-1`/`13-2`로 표시한다.
- 랙 축소·단면 전환은 사용 중인 slot/면을 제거할 수 없고 batch guard에서 다시 검사한다.

## 검증 매핑

| 불변식 | 자동 검증 |
|---|---|
| migration 연속성, table/trigger manifest, FK | `migrationChainContracts.test.js` |
| 문서 create/move, 폐기 process 순서 | `criticalMutationContracts.test.js` |
| set/rack 원자성, 실제 SQLite rollback | `dataIntegrityRefactor.test.js` |
| document optimistic lock와 상태 전이 | `db.test.js`, `rowVersionSafety.test.js` |
| 폐기/import budget와 재개 | `phase34Jobs.test.js`, `freeTierBudget.test.js` |
| audit immutability와 actor snapshot | `systemAudit.test.js`, `masterAudit.test.js` |
| 내부 storage code 비노출 | `db.test.js`, `documentCsv.test.js`, `searchCore.test.js` |
| session 즉시 재검증 | `auth.test.js`, `firstLoginAuth.test.js` |

## 변경 시 중지 조건

- batch order, guard bind, audit/history 의미가 설명 없이 바뀜
- statement 한도 초과 또는 반복문 안 D1 실행 추가
- migration replay/FK/trigger manifest 실패
- `updated_at` 또는 `row_version` guard 제거
- audit/history UPDATE·DELETE 허용
- 내부 `ARC-*`가 browser/CSV/검색에 노출
- 공개 signup 또는 권한 확대
