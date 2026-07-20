# Hanlim Archive 엑셀 문서대장 개선 실행 계획서
## Cursor Agent 전용 구현 지침

---

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 대상 저장소 | `NKH-92/hanlim-archive` |
| 기준 브랜치 | `main` |
| 검토 기준 커밋 | `245016b6b657ec1af99f62a860b043773af42f9e` |
| 기준일 | 2026-07-20 |
| 주요 대상 | Cloudflare Workers + D1 기반 문서고 시스템의 엑셀 전체 대장 동기화 |
| 주요 코드 위치 | `cloudflare-app/` |
| 대상 독자 | Cursor Agent, 코드 검토자, 시스템 운영 담당자 |
| 문서 목적 | 발견된 권한·데이터·감사 무결성 위험을 재현 가능하고 검증 가능한 방식으로 개선 |
| 최종 목표 | 동일 입력과 동일 상태에서 항상 동일한 결과가 나오며, 권한·감사·버전·복구 근거가 일관되게 보존되는 엑셀 대장 동기화 구현 |

> **중요:** 이 문서는 기준 커밋을 바탕으로 작성되었다. 작업 시작 시 반드시 최신 `main`을 다시 확인한다. 최신 migration 번호, 파일 위치 또는 공개 API가 달라졌다면 현재 구조를 우선하되, 본 문서의 불변식과 승인 기준은 낮추지 않는다.

---

# 1. Cursor Agent 시작 지시문

아래 지시를 전체 작업 동안 최상위 실행 계약으로 적용한다.

```text
당신은 hanlim-archive 저장소의 엑셀 전체 문서대장 동기화 기능을 개선한다.

최우선 목표는 기능 추가가 아니라 권한 분리, 데이터 무결성, 감사 추적성,
재현성, 원자성, 운영 복구 가능성을 확보하는 것이다.

반드시 지킬 규칙:
1. main에 직접 작업하거나 직접 push/deploy하지 않는다.
2. 작업 시작 전 최신 main SHA, working tree, Node 버전, baseline test 결과를 기록한다.
3. 과거 migration 파일은 절대 수정하지 않는다. 새 schema 변경은 다음 번호의 migration으로만 추가한다.
4. public/assets의 생성 파일은 직접 편집하지 않는다. source를 수정하고 기존 build script로 재생성한다.
5. handler나 view에 업무 SQL을 추가하지 않는다. snapshots domain의 공개 API를 통해 처리한다.
6. 다중 데이터 변경은 하나의 env.DB.batch() 경계에서 원자적으로 처리한다.
7. 감사·이력 INSERT는 상태 UPDATE보다 먼저 두며, 동일한 pre-state guard를 사용한다.
8. 요청당 D1 statement 내부 예산 40을 넘지 않는다. 문서 수만큼 statement를 생성하지 않는다.
9. 모든 SQL 입력값은 bind parameter를 사용한다. 숫자 변환만으로 문자열 보간을 정당화하지 않는다.
10. 날짜 전용 값은 YYYY-MM-DD 문자열로 취급하며 현지 시간대 Date 변환에 의존하지 않는다.
11. 엑셀 전체 동기화에서는 공란·오타를 임의 기본값으로 보정하지 않는다.
12. 권한 부족, 구버전, 중복, 잘못된 상태값, 부분 전송은 한 행도 변경하지 않고 실패해야 한다.
13. 새 기능보다 실패 테스트를 먼저 추가한다.
14. 각 PR은 하나의 명확한 위험군만 해결한다.
15. 기존 OOXML 호환성과 랙 ID 링크 수정은 회귀시키지 않는다.
16. 작업 완료 주장에는 실행한 명령, 테스트 결과, 변경 파일, 남은 위험을 반드시 제시한다.
17. production D1 수정, 원격 migration, production deploy는 수행하지 않는다.
18. 오류를 숨기기 위한 catch-all, silent fallback, 검증 완화는 금지한다.
19. 프로젝트의 한국어 주석 규칙과 공개 import 경계를 지킨다.
20. 요구사항이 코드와 충돌하면 보안과 데이터 무결성에 더 보수적인 동작을 선택하고 근거를 보고한다.
```

---

# 2. 개선 배경과 현재 위험

현재 엑셀 동기화는 다음과 같은 좋은 기반을 이미 갖고 있다.

- 업로드한 파일을 현재 대장의 완전한 snapshot으로 취급한다.
- 빠진 문서를 hard delete하지 않고 `sync_state = 'excluded'`로 보존한다.
- staging, prepare, apply 단계를 분리한다.
- 적용 시 D1 batch를 사용한다.
- 현재 대장 버전과 업로드 파일의 기준 버전을 비교한다.
- ExcelJS가 읽지 못하는 일부 표준 OOXML 표현을 JSZip으로 정규화한다.
- 랙 링크가 문자열 검색이 아니라 정확한 rack ID 필터를 사용한다.

그러나 다음 문제는 운영 데이터와 감사 추적성에 직접 영향을 줄 수 있다.

## 2.1 P0 권한 우회

현재 snapshot apply는 문서관리 권한만으로 위치·상태까지 변경할 수 있다. 이로 인해 다음 권한 경계가 우회될 수 있다.

- 위치 변경: `can_move_documents` 없이 가능
- 폐기: `can_manage_disposals` 없이 가능
- 폐기 해제: Admin이 아니어도 가능
- 위치 변경 사유와 `document_movements` 이력 없이 위치 변경 가능

## 2.2 P1 날짜 왜곡

`YYYY-MM-DD`를 현지 자정의 JavaScript `Date`로 만든 뒤 ExcelJS에 전달하면 Asia/Seoul 환경에서 Excel serial이 전날로 기록될 수 있다. 시스템 추출 파일을 수정하지 않고 재업로드해도 제·개정일이 하루 전으로 바뀔 가능성이 있다.

## 2.3 P1 과도한 기본값 보정

전체 대장 동기화가 기존 CSV parser를 재사용하면서 다음과 같은 암묵적 보정을 수행할 수 있다.

- 개정번호 공란 → `Rev.0`
- 열 공란 → 1열
- 선반 공란 → 1선반
- 면 공란 → A
- 알 수 없는 상태 → active

전체 대장은 권위 데이터이므로 이러한 보정은 오류를 숨기고 잘못된 복구·이동을 일으킬 수 있다.

## 2.4 P1 현재 대장 내 중복

파일 내부 또는 기존 데이터와의 조합에서 동일한 문서번호·개정번호가 복수의 `current` 문서로 생성될 수 있다. 애플리케이션 검증뿐 아니라 DB 제약도 필요하다.

## 2.5 P1 불완전한 구버전 차단

- `_시스템정보`가 없는 파일은 서버의 현재 버전을 새 기준으로 사용할 수 있다.
- 대분류·태그·랙·슬롯 변경은 현재 대장 버전을 증가시키지 않을 수 있다.
- `schemaVersion`이 읽히지만 서버 검증에 사용되지 않는다.

## 2.6 P1 잘못된 제외 감사로그

행 관리 ID가 없는 파일에서 기존 문서를 문서번호·개정번호로 매칭한 뒤 새 관리 ID를 부여하면, 실제 문서는 제외되지 않았는데 `excel_sync_exclude` 감사로그가 먼저 생성될 가능성이 있다. 감사로그는 append-only이므로 사후 삭제로 해결해서는 안 된다.

## 2.7 P1 검토 불가능한 미리보기

현재 화면은 제외 건수만 보여주고 어떤 문서가 제외되는지 보여주지 않는다. 변경 행도 before/after가 아니라 문서번호·개정·문서명 정도만 표시한다. 사용자는 의도하지 않은 제외·위치 이동·폐기 해제를 충분히 검토할 수 없다.

## 2.8 P2 제외 문서 표시 불일치

`sync_state = 'excluded'` 문서가 세트 또는 직접 상세 화면에서 정상 보관중 문서처럼 보일 수 있다. 현재 대장 포함 여부는 문서 상태와 별도의 축으로 표시해야 한다.

## 2.9 P2 증거와 해시 의미 불명확

`source_hash`는 브라우저가 계산하여 서버에 전달한 값이다. 서버가 원본 파일을 직접 받거나 다시 계산하지 않으므로, 이를 서버 검증 해시로 표현해서는 안 된다.

---

# 3. 최종 개선 목표

## 3.1 권한 목표

엑셀 동기화는 기존 권한 모델을 우회하지 않아야 한다.

- 업로드·검증과 최종 반영 권한을 분리한다.
- 최종 반영은 전용 권한을 요구한다.
- 위치 변경이 있으면 위치이동 권한을 추가로 요구한다.
- 폐기가 있으면 폐기관리 권한을 추가로 요구한다.
- 폐기 해제가 있으면 Admin을 요구한다.
- 권한은 prepare 시 표시하고 apply 시 현재 session 기준으로 다시 검사한다.
- 권한 부족은 403이며, snapshot이나 문서 상태를 바꾸지 않는다.

## 3.2 데이터 목표

- 날짜는 시간대와 무관하게 동일한 `YYYY-MM-DD`로 왕복한다.
- 전체 대장 parser는 필수값 누락과 미지 상태를 오류로 처리한다.
- 현재 대장 안의 문서번호·개정번호 조합은 유일하다.
- 관리 ID가 없는 신규 행은 서버가 관리 ID를 생성한다.
- 기존 관리 ID는 임의로 교체하지 않는다.
- 파일에서 빠진 문서는 명시적인 exclusion 대상 목록으로 보존한다.

## 3.3 동시성 목표

- 문서뿐 아니라 대장 결과에 영향을 주는 기준정보 변경도 파일을 stale 상태로 만든다.
- prepare와 apply 모두 현재 version을 확인한다.
- apply 중 다른 요청과 경합해도 한 요청만 성공한다.
- stale apply는 문서를 변경하지 않고 재시도 불가능한 명확한 상태와 감사 근거를 남긴다.

## 3.4 감사 목표

각 변경 문서에 대해 다음을 재현할 수 있어야 한다.

- 누가
- 언제
- 어떤 snapshot으로
- 어떤 권한으로
- 어떤 사유와 승인 참조로
- 어떤 필드가
- 무엇에서 무엇으로
- 어떤 업무 이력을 동반하여

변경되었는지 확인할 수 있어야 한다.

## 3.5 사용자 검토 목표

최종 반영 전에 다음을 화면에서 식별할 수 있어야 한다.

- 신규 문서
- 일반정보 변경
- 위치 변경
- 폐기
- 폐기 해제
- 유지
- 대장 제외
- 필요한 추가 권한
- 위험 임계치 경고
- 변경 전/후 값

## 3.6 운영 목표

- 기능을 `disabled → admin-only → permissioned` 순서로 안전하게 개방할 수 있다.
- 모든 migration은 additive하고 이전 Worker와 양립한다.
- 배포 전 backup과 데이터 감사 결과가 존재한다.
- 문제 발생 시 Worker rollback과 데이터 복구 판단 기준이 문서화되어 있다.

---

# 4. 절대 깨지면 안 되는 불변식

아래는 구현 선택보다 우선한다.

1. **현재 대장 완전성**  
   한 snapshot 파일은 현재 대장의 완전한 목록이다. 단, 최종 반영 전 누락 문서를 정확히 보여줘야 한다.

2. **실패 시 무변경**  
   검증 오류, 권한 오류, 버전 경합, 중복, DB 제약 위반 중 하나라도 발생하면 문서·태그·상태·위치·감사로그가 부분 반영되어서는 안 된다.

3. **감사 선행·동일 guard**  
   감사 및 업무 이력 INSERT는 문서 UPDATE보다 먼저 실행한다. INSERT와 UPDATE는 동일한 snapshot 상태, base version, 문서 pre-state를 검사한다.

4. **대장 상태와 문서 상태 분리**  
   `sync_state`와 `status`는 서로 다른 의미다. `excluded + active`는 “대장에는 없으나 과거 보관중 상태였던 문서”이지 현재 보관중 문서가 아니다.

5. **권한 합성**  
   snapshot 전용 권한이 위치이동·폐기·폐기해제 권한을 자동으로 대체하지 않는다.

6. **날짜 전용 값의 시간대 독립성**  
   제·개정일은 현지 자정 timestamp가 아니라 calendar date다.

7. **엄격 parser**  
   전체 대장에서는 잘못된 값을 기본값으로 바꾸지 않는다.

8. **현재 identity 유일성**  
   `sync_state = 'current'` 범위에서 `UPPER(document_number), UPPER(revision_number)`는 유일하다.

9. **관리 ID 안정성**  
   기존 문서의 `excel_row_key`는 재업로드 과정에서 불필요하게 변경되지 않는다.

10. **서버 권위**  
    신규 관리 ID, canonical rows hash, 권한 판정, diff는 서버가 결정한다.

11. **버전은 의미 없는 단조 epoch**  
    version의 정확한 증가 폭에 업무 의미를 부여하지 않는다. 이전 값보다 커지고 equality 비교로 stale을 판정하면 된다.

12. **migration append-only**  
    `0030_excel_snapshot_sync.sql`을 포함한 과거 migration과 checksum을 수정하지 않는다.

13. **D1 statement 예산 40**  
    1,000건이어도 set-based SQL을 사용한다. 문서마다 statement를 하나씩 만들지 않는다.

14. **공개 식별자 정책 유지**  
    `storage_code`, `ARC-*`는 공개 화면·CSV·브라우저 검색 index에 노출하지 않는다.

15. **생성 자산 단일 출처**  
    `public/assets/app.js`, `app.css`, ExcelJS, JSZip 생성물을 직접 수정하지 않는다.

---

# 5. 범위와 비범위

## 5.1 이번 개선 범위

- snapshot apply 권한 재설계
- feature gate
- 날짜 왕복 수정
- snapshot 전용 strict parser
- 관리 ID 정책
- identity 중복 검증과 DB 제약
- 기준정보 포함 version 갱신
- schemaVersion 및 bootstrap 정책
- 명시적인 exclusion 모델
- before/after diff 저장
- 위치·폐기 업무 이력 정합성
- 반영 사유·승인 참조
- 상세 미리보기
- 제외 문서 표시
- 서버 canonical hash
- 데이터 감사 도구와 운영 절차
- 회귀 테스트와 CI gate

## 5.2 이번 개선의 비범위

다음은 별도 요구가 없으면 이번 일괄 개선에 포함하지 않는다.

- 원본 XLSX를 R2에 영구 보관하는 기능
- 전자서명 규정 전체 구현
- 2인 승인 전자결재 workflow
- D1 이외 DB로 이전
- 기존 검색 알고리즘 전면 개편
- 랙 구조 전면 재설계
- 대규모 UI 디자인 개편
- 과거 감사로그 삭제 또는 수정

단, 원본 XLSX 보존이나 2인 승인이 SOP상 필수라면 별도 설계 항목으로 보고한다. 임의로 축소 구현하지 않는다.

---

# 6. 권장 목표 아키텍처

현재 공개 import 경로를 유지하면서 snapshots 내부를 다음 책임으로 분리한다.

```text
src/domains/snapshots/
  index.js                         공개 API만 export
  domain/
    canonicalRow.js               전체 대장 필드 정규화·엄격 검증
    identity.js                   문서번호/개정번호 identity와 관리 ID 정책
    diff.js                       before/after 비교, change flags 계산
    authorization.js              diff 기반 필요 권한 계산
    auditPayload.js               versioned audit JSON 생성
    hash.js                       deterministic canonical serialization
  application/
    createSnapshot.js             create use case
    stageSnapshotRows.js          chunk staging use case
    prepareSnapshot.js            검증·매칭·diff·exclusion 생성
    applySnapshot.js              권한 재검사·원자 반영
  infrastructure/
    repository.js                 D1 조회·저장
    preparePlan.js                prepare BatchPlan
    applyPlan.js                  apply BatchPlan
  web/
    forms.js                      요청 파싱
    presenters.js                 view 전용 read model
```

### 적용 원칙

- 한 PR에서 전체 구조를 먼저 재작성하지 않는다.
- 긴급 보안 패치는 현재 구조에서 최소 변경으로 먼저 적용한다.
- 이후 기능을 건드리는 지점부터 순수 domain 함수를 추출한다.
- `documentCsv.js`는 기존 CSV 기능을 유지한다.
- snapshot은 더 이상 `prepareDocumentImportRows()`에 의존하지 않는다.
- handler는 입력 파싱, permission guard, status mapping만 담당한다.
- view는 이미 준비된 presenter 결과만 렌더링한다.
- SQL은 snapshots infrastructure에만 둔다.

---

# 7. 목표 상태 모델

## 7.1 Snapshot 상태

```text
staging
  ├─ prepare 성공 → ready
  ├─ 검증 실패 → failed
  └─ 사용자 취소 → cancelled

ready
  ├─ apply claim 성공 → applying → completed
  ├─ stale 감지 → failed + stale error summary
  └─ 사용자 취소 → cancelled

completed
  └─ 재호출 시 idempotent success

failed / cancelled
  └─ 재사용 금지, 새 snapshot 생성
```

### 상태 규칙

- `ready`가 된 뒤 row 내용을 다시 stage할 수 없다.
- `applying` 상태는 동일 batch 안에서 `completed`가 되어야 한다.
- batch rollback 시 `applying`도 rollback되어 `ready`가 유지된다.
- 중복 apply 요청은 첫 요청만 claim한다.
- 두 번째 요청은 완료 여부를 재조회하여 `alreadyApplied` 또는 409를 반환한다.
- stale snapshot은 계속 `ready`로 남겨 반복 apply하게 하지 않는다.

## 7.2 행 처리 유형

기존 `create/update/unchanged`만으로는 업무 위험을 표현하기 부족하다. 다음 change flags를 별도로 계산한다.

```text
CREATE
METADATA
MOVE
DISPOSE
RESTORE
TAG_CHANGE
REINCLUDE
UNCHANGED
```

한 행은 여러 flag를 가질 수 있다. 예:

```text
["METADATA", "MOVE", "TAG_CHANGE"]
```

파일에서 빠진 문서는 row action이 아니라 별도 exclusion record로 취급한다.

---

# 8. 권한 설계

## 8.1 신규 전용 권한

다음 권한을 추가하는 방식을 권장한다.

```js
PERMISSIONS.APPLY_DOCUMENT_SNAPSHOTS
// DB column: can_apply_document_snapshots
// 표시명: 엑셀 전체 대장 반영
```

### 기본 부여 정책

- Admin: 기존 정책에 따라 자동 허용
- 일반 User: 기본값 0
- viewer preset: 0
- archive_manager preset: 기본 0
- disposal_manager preset: 0
- operations_admin preset: 0
- custom에서 지정 사용자에게 명시적으로 부여
- release smoke 계정: 0

전체 대장 반영은 일반 문서 수정과 위험도가 다르므로 archive_manager에 자동 부여하지 않는다.

## 8.2 단계별 권한

| 동작 | 요구 권한 |
|---|---|
| snapshot 목록·상세 | `can_manage_documents` |
| 현재 대장 Excel 추출 | `can_manage_documents` |
| snapshot 생성·행 전송·prepare | `can_manage_documents` |
| apply 기본 | `can_manage_documents` + `can_apply_document_snapshots` |
| 위치 변경 포함 | 기본 + `can_move_documents` |
| active → disposed 포함 | 기본 + `can_manage_disposals` |
| disposed → active 포함 | Admin |
| exclusion 포함 | 기본, 별도 명시 확인 |
| bootstrap | Admin + apply 전용 권한 |

## 8.3 권한 판정 시점

1. **prepare 시**  
   필요한 권한 목록과 위험 건수를 계산하여 snapshot에 저장하고 화면에 표시한다.

2. **apply 요청 전**  
   현재 session 권한으로 다시 판정한다. prepare 당시 권한을 신뢰하지 않는다.

3. **apply batch 시작 전**  
   snapshot status와 base version을 SQL로 다시 검사한다.

## 8.4 HTTP 동작

- 권한 부족: 403
- snapshot 없음: 404
- 잘못된 입력: 400
- stale 또는 상태 경합: 409
- payload/행 수 초과: 413 또는 프로젝트 표준에 맞춘 400
- 내부 오류: request ID를 포함한 500, 원시 DB 오류 비노출

응답에는 사람이 읽는 한국어 메시지와 안정적인 code를 함께 둔다.

```json
{
  "ok": false,
  "code": "SNAPSHOT_MOVE_PERMISSION_REQUIRED",
  "message": "위치 변경 12건을 반영하려면 문서 위치 이동 권한이 필요합니다."
}
```

---

# 9. 관리 ID 정책

## 9.1 기본 원칙

- 관리 ID가 있는 기존 행은 해당 ID로만 문서를 식별한다.
- 관리 ID가 없는 행을 브라우저가 임의 영구 ID로 만들지 않는다.
- 신규 행의 영구 관리 ID는 서버가 생성한다.
- 기존 문서의 관리 ID를 다른 값으로 교체하지 않는다.
- 동일 snapshot에서 관리 ID 중복은 즉시 실패한다.
- 관리 ID와 문서번호·개정번호가 서로 다른 기존 문서를 가리키면 실패한다.

## 9.2 업로드 행 분류

### 관리 ID가 있는 행

1. 해당 ID의 문서를 찾는다.
2. 존재하면 그 문서와 매칭한다.
3. 존재하지 않는데 identity가 기존 current 문서와 일치하면 관리 ID 불일치 오류다.
4. 존재하지 않고 identity도 신규이면, managed mode에서는 알 수 없는 외부 ID를 거부한다.
5. 제외 문서의 기존 ID이면 `REINCLUDE` 후보로 처리한다.

### 관리 ID가 없는 행

1. identity가 current 문서와 일치하면 “기존 행의 관리 ID가 삭제됨” 오류다.
2. identity가 excluded 문서와 일치하면 최신 파일에서 원래 관리 ID를 복구하도록 오류 처리한다.
3. identity가 어디에도 없으면 신규 행으로 처리하고 서버가 관리 ID를 생성한다.
4. 같은 파일의 다른 신규 행과 identity가 중복되면 실패한다.

## 9.3 Staging schema 권장

기존 `row_key NOT NULL`과의 호환을 위해 다음 컬럼을 새 migration으로 추가한다.

```sql
ALTER TABLE document_snapshot_rows
ADD COLUMN source_row_key TEXT;

ALTER TABLE document_snapshot_rows
ADD COLUMN before_json TEXT;

ALTER TABLE document_snapshot_rows
ADD COLUMN changed_fields_json TEXT;

ALTER TABLE document_snapshot_rows
ADD COLUMN change_flags_json TEXT;
```

- `source_row_key`: 파일에 실제로 있던 값, 없으면 NULL
- 기존 `row_key`: prepare 이후 서버가 확정한 effective key
- 빈 source key의 staging 동안에는 서버가 snapshot/row 기반 임시 key를 넣는다.
- prepare 성공 전에 임시 key가 current document에 쓰여서는 안 된다.

---

# 10. 날짜 처리 규격

## 10.1 쓰기

다음 패턴은 금지한다.

```js
new Date(dateText + "T00:00:00")
```

다음처럼 UTC calendar date를 생성한다.

```js
export function dateOnlyToUtcDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}
```

## 10.2 읽기

- ExcelJS가 Date를 반환하면 UTC component로 `YYYY-MM-DD`를 만든다.
- 숫자 serial을 직접 처리할 때는 1900/1904 date system 여부를 확인한다.
- 텍스트 날짜는 strict `YYYY-MM-DD`만 허용하거나 명시적으로 지원하는 형식만 허용한다.
- `Invalid Date`를 문자열로 통과시키지 않는다.

## 10.3 필수 테스트

다음 timezone에서 같은 결과를 검증한다.

```text
TZ=UTC
TZ=Asia/Seoul
TZ=America/Los_Angeles
```

대상 날짜:

```text
1900-03-01
2024-02-29
2026-01-01
2026-07-20
2026-12-31
```

각 날짜는 다음 왕복을 통과해야 한다.

```text
DB 문자열
→ ExcelJS workbook 생성
→ buffer
→ ExcelJS load
→ parser
→ 동일 DB 문자열
```

---

# 11. Snapshot 전용 엄격 parser

## 11.1 기존 CSV parser와 분리

새 함수 예시:

```js
prepareCanonicalSnapshotRows(rows, options)
```

반환 계약:

```js
{
  ok: boolean,
  items: [],
  errors: [
    {
      rowNumber: 12,
      field: "status",
      code: "INVALID_STATUS",
      message: "상태는 보관중 또는 폐기만 입력할 수 있습니다."
    }
  ]
}
```

## 11.2 필수 필드

- 문서번호
- 개정번호
- 제·개정일
- 폐기 예정 년도
- 문서명
- 문서종류
- 랙
- 열
- 선반
- 면
- 상태

태그와 비고만 공란을 허용한다.

## 11.3 허용값

### 상태

```text
보관중 → active
폐기   → disposed
active → active
disposed → disposed
```

이외 값과 공란은 오류다. `폐기완료`, `정상`, `사용`, `Y`, `N` 등을 추측하지 않는다.

### 랙 면

```text
단면, 1, 1면, A → A
2, 2면, B → B
```

단면 랙에 B가 들어오면 오류다.

### 숫자

- 랙, 열, 선반, 폐기 예정 년도는 정수만 허용한다.
- `"1.0"`, `"01"` 허용 여부를 명시하고 테스트한다.
- 범위는 실제 활성 기준정보와 대조한다.
- 공란을 1로 바꾸지 않는다.

### 태그

- 구분자는 세미콜론을 canonical로 한다.
- 호환 입력으로 쉼표 또는 `|`를 허용할 수 있으나 export는 항상 세미콜론을 쓴다.
- 존재하지 않는 태그는 오류다.
- 중복 태그는 제거하되 경고가 아니라 deterministic normalize로 처리한다.
- 대소문자 무관 매칭 여부를 기존 기준정보 정책과 동일하게 한다.

## 11.4 오류 표시

- 최대 20건만 문자열로 합치지 않는다.
- 서버는 구조화된 오류 전체 또는 안전한 상한까지 반환한다.
- 화면은 행·필드·메시지를 표로 표시한다.
- 20건 초과 시 “외 N건”과 오류 CSV 내려받기를 제공한다.
- 오류가 한 건이라도 있으면 `ready`가 되지 않는다.

---

# 12. Identity 유일성

## 12.1 애플리케이션 검증

prepare 단계에서 다음을 모두 검사한다.

1. 파일 내부 identity 중복
2. 두 행이 같은 기존 document ID로 매칭되는지
3. 관리 ID가 가리키는 문서와 identity fallback 문서가 다른지
4. identity 변경이 다른 current 문서와 충돌하는지
5. 제외 문서 재포함이 현재 문서와 충돌하는지
6. 대소문자만 다른 identity 중복

Identity 함수는 snapshots와 일반 문서 등록에서 공유 가능한 순수 함수로 둔다.

```js
documentIdentity(number, revision)
// clean + upper + NUL separator
```

## 12.2 DB 제약

데이터 감사에서 중복이 없음을 확인한 뒤 새 migration으로 partial unique expression index를 추가한다.

```sql
CREATE UNIQUE INDEX idx_documents_current_identity
ON documents (
  UPPER(document_number),
  UPPER(revision_number)
)
WHERE sync_state = 'current';
```

### 주의

- 실제 구현 전에 D1/SQLite 버전에서 expression + partial index 지원을 migration replay test로 확인한다.
- 기존 중복이 있으면 migration으로 임의 병합하지 않는다.
- 중복 정리 결과가 승인된 뒤 index를 추가한다.
- index 위반은 사용자에게 문서번호·개정번호 충돌 메시지로 변환한다.
- excluded 문서끼리 또는 excluded와 current의 동일 identity는 허용할 수 있으나 재포함 시 충돌을 검사한다.

---

# 13. Version 모델 개선

## 13.1 version을 증가시켜야 하는 변경

현재 Excel export 또는 import 결과에 영향을 주는 다음 변경은 version을 증가시킨다.

- `documents` INSERT/UPDATE/DELETE
- `document_tags` INSERT/DELETE
- `categories` INSERT/UPDATE/DELETE
- `tags` INSERT/UPDATE/DELETE
- `racks` INSERT/UPDATE/DELETE
- `rack_slots` INSERT/UPDATE/DELETE

## 13.2 구현 원칙

새 migration으로 각 테이블에 trigger를 추가하거나, 모든 mutation command가 공통 version bump statement를 호출하도록 한다.

권장 우선순위:

1. 누락 경로가 생기지 않는 DB trigger 방식
2. snapshot apply 내부에서 발생하는 다수 trigger 증가는 허용
3. version은 정확히 +1이라는 가정을 제거
4. snapshot apply 마지막에 다음처럼 단조 증가시킨다.

```sql
UPDATE document_sync_state
SET current_version = current_version + 1,
    current_snapshot_id = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND EXISTS (...snapshot applying guard...);
```

기존처럼 `base_version + 1`로 덮어쓰지 않는다.

## 13.3 테스트

- 태그만 추가해도 기존 export가 stale
- 대분류 이름 변경 후 기존 export가 stale
- 랙 비활성화 후 기존 export가 stale
- 슬롯 좌표 변경 후 기존 export가 stale
- snapshot apply 후 version이 base보다 큼
- 정확한 증가량에는 의존하지 않음
- rollback된 batch는 version도 되돌아감

---

# 14. schemaVersion과 bootstrap

## 14.1 관리 파일

시스템에서 추출한 관리 파일은 다음 hidden metadata를 가진다.

```text
schemaVersion
baseVersion
currentSnapshotId
exportedAt
rowCount
exportManifestId 또는 sourceExportId
```

업로드 요청에 `schemaVersion`을 반드시 포함한다. 서버는 지원 버전 목록과 비교한다.

```js
const SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = new Set([1]);
```

지원하지 않으면 파일을 읽었더라도 snapshot을 생성하지 않는다.

## 14.2 Bootstrap mode

`_시스템정보`가 없는 파일을 일반 관리 파일처럼 받지 않는다.

Bootstrap은 다음 조건을 모두 만족해야 한다.

- 명시적 `mode=bootstrap`
- Admin
- snapshot apply 전용 권한
- `current_snapshot_id IS NULL`
- 운영 backup 확인
- 화면의 명시적 경고와 typed confirmation
- 시스템 감사로그 기록
- 최초 성공 후 재실행 금지

이미 관리 snapshot이 존재하면 metadata 없는 파일은 무조건 거부한다.

## 14.3 Managed mode

- metadata 필수
- baseVersion 필수
- schemaVersion 필수
- currentSnapshotId 또는 export provenance 필수
- 일부 metadata만 있는 파일은 오류
- 숫자 변환 실패를 0으로 처리하지 않음

---

# 15. Exclusion 모델

## 15.1 별도 테이블

파일에서 빠진 문서는 업로드 row가 아니므로 별도 테이블을 사용한다.

```sql
CREATE TABLE document_snapshot_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  excel_row_key TEXT NOT NULL,
  expected_row_version INTEGER NOT NULL,
  before_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id)
    REFERENCES document_snapshots(id)
    ON DELETE CASCADE,
  UNIQUE (snapshot_id, document_id)
);
```

문서 FK는 영구삭제와 이력 보존 요구를 검토하여 `ON DELETE SET NULL` 또는 FK 생략을 선택한다. snapshot history가 문서 hard delete 때문에 사라지면 안 된다.

## 15.2 Prepare

- current 문서 중 matched document ID 집합에 없는 문서를 exclusion으로 저장한다.
- `excel_row_key` 문자열 비교만으로 제외를 판정하지 않는다.
- prepare 시점의 `row_version`과 before JSON을 보존한다.
- before JSON에는 다음을 포함한다.
  - document number
  - revision
  - revision date
  - disposal due year
  - document name
  - category
  - rack/slot/face
  - status
  - sync state
  - tags
- exclusion count는 이 테이블 행 수에서 계산한다.

## 15.3 Apply

감사 INSERT와 실제 exclusion UPDATE가 같은 exclusion 테이블을 사용한다.

```text
document_snapshot_exclusions
→ excel_sync_exclude 감사 INSERT
→ documents.sync_state='excluded' UPDATE
```

두 문장은 동일한 조건을 검사한다.

- snapshot status applying
- document ID
- sync_state current
- expected row_version
- expected excel_row_key

## 15.4 잘못된 과거 로그 처리

append-only 감사로그를 삭제하거나 수정하지 않는다. 잘못된 제외 로그가 확인되면 별도 correction event를 추가한다.

```json
{
  "action": "audit_correction",
  "originalAuditLogId": 123,
  "snapshotCode": "SNP-2026-0012",
  "reason": "관리 ID 없는 bootstrap 매칭 과정에서 실제 제외 없이 제외 로그가 생성됨",
  "reviewedBy": "...",
  "reviewedAt": "..."
}
```

---

# 16. Diff 저장 규격

## 16.1 before/after

각 create/update row에 다음을 보존한다.

```json
{
  "schemaVersion": 1,
  "rowKey": "HLM-...",
  "values": {
    "documentNumber": "...",
    "revisionNumber": "...",
    "revisionDate": "YYYY-MM-DD",
    "disposalDueYear": 2031,
    "documentName": "...",
    "categoryId": 1,
    "categoryName": "...",
    "rackSlotId": 123,
    "rackCode": "1-02",
    "rackColumn": 3,
    "shelfNumber": 2,
    "rackFace": "A",
    "tagIds": [1, 3],
    "tagNames": ["원본보관", "중요문서"],
    "note": "...",
    "status": "active",
    "syncState": "current"
  }
}
```

- before와 after의 shape를 동일하게 한다.
- 배열은 정렬한다.
- 내부 storage code는 포함하지 않는다.
- hash와 audit에 쓰는 JSON schema를 versioning한다.

## 16.2 changed fields

```json
[
  "documentName",
  "rackSlotId",
  "rackFace",
  "tagIds",
  "status"
]
```

UI와 권한 계산은 문자열 추측이 아니라 changed fields와 flags를 사용한다.

## 16.3 분류

```text
MOVE: rackSlotId 또는 rackFace 변경
DISPOSE: active → disposed
RESTORE: disposed → active
TAG_CHANGE: tagIds 집합 변경
METADATA: 문서번호, 개정, 날짜, 폐기년도, 문서명, 분류, 비고 변경
REINCLUDE: excluded → current
```

---

# 17. 반영 사유와 승인 참조

## 17.1 입력

모든 apply에 다음을 요구한다.

- `applyReason`: 필수, 10~500자
- `approvalReference`: 조건부 필수, 최대 200자

## 17.2 승인 참조 필수 조건

다음 중 하나라도 있으면 필수다.

- exclusion > 0
- move > 0
- dispose > 0
- restore > 0
- current 문서 identity 변경 > 0
- 대량 변경 경고 임계치 초과

## 17.3 저장

- snapshot record
- system audit details
- document audit details
- movement reason
- disposal/restore reason

같은 문자열을 각 로그에서 다르게 조립하지 않는다. prepare/apply application service가 normalized reason object를 만들고 infrastructure에 전달한다.

---

# 18. 위치·폐기 업무 이력 정합성

## 18.1 위치 변경

위치가 바뀐 각 문서에 대해 set-based SQL로 `document_movements`를 생성한다.

필수 값:

- document ID
- document number snapshot
- from slot/face
- to slot/face
- from location snapshot
- to location snapshot
- apply reason
- actor ID/username/display name
- snapshot code 또는 details field

문서 수만큼 D1 statement를 만들지 않는다. snapshot row table을 SELECT source로 사용해 한 INSERT statement로 처리한다.

## 18.2 폐기·폐기 해제

상태가 바뀐 문서만 `disposal_logs`에 기록한다.

- active → disposed: `disposed`
- disposed → active: `restored`
- unchanged status: 로그 없음
- reason은 apply reason
- restore는 Admin 확인 후에만 가능

## 18.3 문서 감사로그

- create: `excel_sync_create`
- update: `excel_sync_update`
- exclude: `excel_sync_exclude`
- reinclude가 별도 의미가 필요하면 `excel_sync_reinclude`
- before/after에 tags 포함
- changed fields, snapshot code, reason, approval reference 포함
- 기존 공개 화면에서 내부 storage code는 계속 숨김

---

# 19. Apply 원자성 설계

권장 batch 순서:

```text
01. ready → applying claim
02. update 대상 document audit INSERT
03. exclusion document audit INSERT
04. movement logs INSERT
05. disposal/restore logs INSERT
06. update 대상 tags DELETE
07. create/update 대상 tags INSERT
08. existing document UPDATE
09. new document INSERT
10. 신규 storage code 확정
11. 신규 문서 audit INSERT
12. exclusion document UPDATE
13. system snapshot apply audit INSERT
14. document_sync_state version/current_snapshot 갱신
15. snapshot completed UPDATE RETURNING
```

### 필수 조건

- 40 statements 이하
- 각 statement는 applying snapshot guard 사용
- update/exclusion은 expected row version 사용
- 신규 identity unique index 위반 시 전체 rollback
- 마지막 snapshot completed 결과가 없으면 성공으로 처리하지 않음
- 첫 claim changes=0이면 현재 snapshot을 재조회
- completed면 idempotent success
- ready지만 baseVersion mismatch면 stale 처리
- 다른 상태면 409

---

# 20. 미리보기 UI

## 20.1 요약 카드

다음을 별도 표시한다.

- 전체
- 신규
- 일반정보 변경
- 위치 변경
- 태그 변경
- 폐기
- 폐기 해제
- 유지
- 대장 제외
- 재포함

## 20.2 행별 표

필터:

```text
전체 / 신규 / 변경 / 위치 / 폐기 / 폐기 해제 / 유지 / 제외 / 오류
```

표시:

- Excel 행
- 처리 유형
- 문서번호
- 개정
- 문서명
- 변경 필드
- before
- after
- 현재 위치
- 변경 위치
- 상태 변화

before/after는 모든 필드를 한 줄에 나열하지 않고 변경된 필드만 표시한다.

## 20.3 제외 목록

별도 section으로 다음을 표시한다.

- 문서번호
- 개정
- 문서명
- 현재 상태
- 현재 위치
- 포함된 세트 수
- 최근 이동/대여 여부가 있다면 경고
- 제외 사유: “업로드 파일에 행 없음”

## 20.4 위험 경고

다음 조건에서 눈에 띄는 경고를 표시한다.

- exclusion > 0
- restore > 0
- 전체 current 문서의 10% 이상 변경
- 전체 current 문서의 5% 이상 제외
- identity 변경
- 기준 버전이 오래됨
- 관리 ID 누락 신규 행 존재
- 권한 부족

임계치는 상수로 두고 테스트한다.

## 20.5 Apply form

- 사유
- 승인 참조
- 제외 예상 건수 재확인
- 최종 버튼
- 필요한 권한 표시

exclusion이 있으면 사용자가 정확한 건수를 입력하거나 확인 checkbox를 명시적으로 선택하게 한다. 단순 `confirm()`만으로 끝내지 않는다.

---

# 21. 제외 문서 UI와 세트 정합성

## 21.1 문서 상세

`getDocument()` read model에 `sync_state`와 `last_snapshot_id`를 포함한다.

제외 문서 상세:

- “현재 대장 제외” 배지
- 제외된 snapshot 링크
- 마지막 current 정보
- 일반 수정·이동·폐기 버튼 비활성화
- “최신 대장 파일에 다시 포함하여 재등록” 안내
- 직접 URL 접근은 허용하되 상태를 숨기지 않음

## 21.2 세트

세트 조회에 다음 집계를 추가한다.

- total linked count
- current count
- excluded count
- disposed count

세트 상세:

- 제외 문서 행에 별도 class와 badge
- rackCount와 map hit는 current 문서만 사용
- “대장 제외 N건” 경고
- CSV에 `대장 포함 상태` 열 추가
- 제외 문서를 새 세트에 추가할 수 없음
- 기존 연결은 감사 근거로 보존

## 21.3 검색·랙·품질

기존처럼 current만 조회해야 한다. 회귀 테스트를 유지한다.

---

# 22. 해시와 출처 증거

## 22.1 client source hash

기존 `source_hash`는 의미를 다음처럼 명확히 한다.

```text
브라우저가 보고한 원본 XLSX SHA-256
```

이 값만으로 서버가 원본과 staged rows의 일치를 증명한다고 표현하지 않는다.

## 22.2 canonical rows hash

prepare 시 서버가 다음을 수행한다.

1. row number 순서로 정렬
2. stable key order로 canonical JSON 생성
3. tags 등 집합 배열 정렬
4. UTF-8 bytes
5. SHA-256 계산
6. snapshot에 저장

```text
canonical_rows_hash
```

이 hash는 서버가 검증하고 적용한 normalized dataset의 증거다.

## 22.3 Export provenance

권장:

- export API가 `exportManifestId`를 발급
- baseVersion, currentSnapshotId, schemaVersion, canonical export hash를 서버에 저장
- XLSX hidden metadata에 manifest ID 기록
- 업로드 시 존재·버전·사용자 정책 확인
- visible row 편집은 허용하므로 original export hash와 edited canonical hash를 구분

원본 파일 보존이 필요하면 R2 설계를 별도 PR로 제안한다.

---

# 23. Feature gate

다음 환경 값을 권장한다.

```text
EXCEL_SNAPSHOT_APPLY_MODE
  disabled
  admin-only
  permissioned
```

## 동작

- 누락 또는 알 수 없는 값: `admin-only` 또는 더 보수적인 `disabled`
- `disabled`: prepare까지 가능, apply 버튼과 endpoint 차단
- `admin-only`: Admin만 apply
- `permissioned`: 전용 권한 + diff 기반 추가 권한

## 전환 순서

1. 긴급 패치 배포: `disabled`
2. 데이터 감사와 UAT 완료: `admin-only`
3. 지정 사용자 교육·권한 부여 후: `permissioned`

화면에 현재 mode를 일반 사용자에게 노출할 필요는 없지만, apply 불가 이유는 명확히 표시한다.

---

# 24. PR 및 구현 순서

각 PR은 이전 PR의 승인 기준을 통과한 뒤 진행한다.

---

## PR-00. Baseline 고정과 안전 게이트

### 목적

현재 동작과 테스트 결과를 고정하고, 개선 도중 기존 기능 회귀 여부를 판정할 수 있게 한다.

### 개선 방향

- 최신 main 확인
- baseline verify
- 기존 위험을 재현하는 실패 테스트 추가
- apply mode를 최소 `admin-only`로 제한하거나 임시 차단
- production 변경 없이 코드와 테스트만 준비

### 상세 방법

1. 새 branch 생성
2. `cloudflare-app`에서 `npm ci`
3. 아래 명령 실행 결과 기록
4. 기존 테스트 수와 CI 상태 기록
5. P0/P1 재현 테스트를 먼저 추가
6. feature gate 또는 Admin-only guard 추가
7. generated route catalog 갱신

### 필수 재현 테스트

- 문서관리 권한만 가진 User의 apply 거부
- Seoul timezone 날짜 왕복 실패 재현
- 잘못된 상태가 active로 바뀌는 현재 동작 재현
- 파일 내부 identity 중복 재현
- no-key 기존 문서에서 false exclusion audit 재현
- exclusion 목록이 UI에 없음을 contract test로 고정

### 완료 기준

- baseline의 기존 테스트 모두 통과
- 새 보안 테스트가 수정 전 실패하고 수정 후 통과
- apply가 최소 Admin-only
- CI green
- production deploy 없음

### Rollback

Worker 이전 버전 rollback 가능. schema 변경은 이 PR에 넣지 않는 것을 권장한다.

---

## PR-01. 전용 권한과 동적 권한 판정

### 목적

전체 대장 반영이 기존 위치·폐기 권한을 우회하지 못하게 한다.

### 개선 방향

- apply 전용 permission 추가
- route policy와 handler guard 분리
- prepare diff에서 required permissions 계산
- apply 시 현재 권한 재검사
- bootstrap은 Admin 전용

### 주요 파일

- `src/permissions.js`
- 사용자 권한 관련 domain/infrastructure
- `src/app/routeRegistry.js`
- `src/handlers/permissionGuards.js`
- `src/handlers/snapshotHandlers.js`
- `src/domains/snapshots/domain/authorization.js`
- 다음 번호 migration
- 권한·route·audit tests
- `docs/PERMISSIONS.md`
- generated route catalog

### migration

- `app_users.can_apply_document_snapshots`
- default 0
- CHECK 0/1
- release smoke user 0 유지
- 과거 migration 수정 금지

### 테스트

- Admin success
- 일반 User + manage documents만: 403
- apply permission은 있으나 move permission 없음: 403
- dispose permission 없음: 403
- restore 포함 non-Admin: 403
- 권한 부족 시 snapshot status와 DB 모두 무변경
- 권한 변경 후 기존 session도 현재 DB 기준으로 반영
- route catalog의 permission/policy 일치

### 완료 기준

- 권한 matrix 전부 테스트
- 403/409/400 구분
- UI가 필요한 권한과 부족 권한 표시
- permission snapshot이 system audit에 기록

---

## PR-02. 날짜와 Strict Canonical Parser

### 목적

시간대·공란·오타 때문에 대장 내용이 조용히 바뀌는 것을 방지한다.

### 개선 방향

- 날짜를 UTC calendar date로 작성
- timezone round-trip test
- snapshot 전용 parser 분리
- 모든 중요 필드 strict validation
- 상태 fallback 제거
- client에서 임의 영구 row key 생성 제거

### 주요 파일

- `src/views/clientScript/excelSnapshots.js`
- snapshots domain canonical row module
- `src/documentCsv.js` 의 snapshot 의존 제거
- parser tests
- browser asset build 결과
- 운영 문서

### 테스트

- Seoul/UTC/Los Angeles 날짜 왕복
- leap day
- 빈 개정번호 오류
- 빈 날짜 오류
- 빈 폐기년도 오류
- 빈 위치 오류
- 알 수 없는 상태 오류
- 단면 랙 B 오류
- inactive reference 정책
- OOXML compatibility 회귀
- browser asset drift check

### 완료 기준

- 시스템에서 추출한 파일을 무수정 재업로드하면 날짜와 필드 diff 0
- 모든 미지 상태가 오류
- CSV 기존 동작 회귀 없음
- generated assets check 통과

---

## PR-03. Identity 검증과 DB 유일성

### 목적

현재 대장에 같은 문서번호·개정번호가 복수 생성되지 않게 한다.

### 개선 방향

- 파일 내부 중복 검사
- 관리 ID/identity 교차 검증
- partial unique index
- 친화적 충돌 메시지
- 기존 데이터 사전 감사

### 작업 순서

1. read-only duplicate report 작성
2. local migration replay에서 중복 상태의 실패 확인
3. 데이터 clean 조건 확인
4. 새 migration 추가
5. prepare/apply conflict mapping
6. tests

### 테스트

- 파일 내부 exact duplicate
- case-only duplicate
- 기존 current 충돌
- excluded 재포함 충돌
- identity 변경 충돌
- DB index 직접 위반
- batch rollback
- 일반 문서 등록과 snapshot의 동일 정책

### 완료 기준

- current identity unique index 존재
- 모든 충돌이 apply 이전 prepare에서 탐지
- 경합으로 prepare 이후 충돌해도 DB가 최종 차단
- 사용자에게 충돌 문서 식별 정보 제공

---

## PR-04. Version, schemaVersion, Bootstrap

### 목적

오래된 파일과 오래된 기준정보로 현재 대장을 덮어쓰는 것을 막는다.

### 개선 방향

- 기준정보와 document tags도 version bump
- version +1 정확성 가정 제거
- schemaVersion server validation
- metadata 없는 파일 일반 업로드 차단
- explicit one-time bootstrap
- stale snapshot terminal 처리

### 주요 파일

- 다음 migration
- snapshot create/prepare/apply application
- master/rack/tag mutations 또는 triggers
- client metadata reader
- views
- version tests
- operations docs

### 테스트

- tag add/delete stale
- category rename stale
- rack update stale
- slot update stale
- unsupported schema version
- missing metadata in managed mode
- bootstrap non-Admin 거부
- bootstrap 두 번째 실행 거부
- prepare 후 version 변경 시 apply 409 및 무변경
- stale 상태 감사로그

### 완료 기준

- export 결과에 영향을 주는 모든 mutation이 version을 증가
- metadata 없는 파일이 조용히 현재 version으로 재기준화되지 않음
- stale snapshot 반복 apply 불가
- version은 단조 증가

---

## PR-05. Persisted Diff와 Exclusion 정합성

### 목적

미리보기, 감사로그, 실제 변경이 같은 데이터 집합을 사용하게 한다.

### 개선 방향

- exclusion table
- before/after JSON
- changed fields와 flags
- server-generated row key
- false exclusion audit 제거
- tags 포함 감사 snapshot
- deterministic canonical hash

### 주요 파일

- snapshots domain diff/identity/hash
- snapshots repository와 BatchPlan
- 다음 migration
- snapshot views/presenters
- tests

### 테스트

- no-key bootstrap 기존 문서 매칭 시 row key 보존
- 신규 blank key는 server key 생성
- false exclusion audit 0
- 실제 exclusion만 audit
- exclusion count와 table 행 수 일치
- before/after tags 보존
- canonical hash deterministic
- 배열 순서가 달라도 같은 hash
- row 순서 정책에 따른 hash 일관성

### 완료 기준

- 모든 exclusion이 문서 ID 기반
- UI·audit·UPDATE의 exclusion 집합 동일
- 기존 문서 관리 ID 불필요 변경 없음
- snapshot detail에서 exact diff 조회 가능

---

## PR-06. 위치·폐기 이력과 반영 사유

### 목적

Excel 반영이 전용 이동·폐기 경로와 동일한 감사 수준을 갖게 한다.

### 개선 방향

- apply reason 필수
- 조건부 approval reference
- movement log set-based insert
- disposal/restore log set-based insert
- permission과 change flag 연결
- audit JSON schema versioning

### 테스트

- move 1건 → movement 1건
- 동일 위치 → movement 0건
- dispose → disposed log
- restore → restored log + Admin only
- mixed change
- reason/approval 누락
- 1,000건에서도 statement budget ≤40
- 중간 SQL 오류 전체 rollback
- audit before 상태가 실제 pre-state
- internal storage code 공개 payload 비노출

### 완료 기준

- 위치 변화와 movement log count 일치
- 상태 변화와 disposal log count 일치
- 모든 apply audit에 reason/actor/snapshot 포함
- D1 batch atomicity contract test 통과

---

## PR-07. 검토 UI와 제외 문서 표시

### 목적

운영자가 잘못된 반영을 적용 전에 발견하고, 과거 제외 문서를 현재 문서로 오인하지 않게 한다.

### 개선 방향

- 상세 요약과 필터
- before/after diff
- exclusion 상세
- 위험 경고
- sync_state badge
- 세트 제외 집계
- apply confirmation 강화
- pagination 또는 안전한 표시 상한

### 테스트

- 각 summary count
- exclusion 상세 표시
- changed fields만 강조
- 권한 부족 버튼 비활성화와 서버 재검사
- excluded detail badge
- excluded actions 미노출
- set excluded count
- map hit current only
- set CSV ledger state
- HTML escape
- 접근성 label
- print view 회귀

### 완료 기준

- 사용자가 제외 문서 이름을 반영 전에 볼 수 있음
- 위치·폐기 해제를 즉시 구분 가능
- excluded 문서가 정상 current처럼 보이지 않음
- 서버 권한이 UI 상태와 무관하게 최종 차단

---

## PR-08. 운영 증거, 데이터 감사, 정리

### 목적

코드 수정뿐 아니라 기존 데이터 이상을 식별하고 안전하게 운영 전환한다.

### 개선 방향

- read-only audit script
- correction event 절차
- source hash 의미 정리
- canonical hash 표시
- abandoned staging cleanup
- file size/zip safety limit
- operations and recovery docs
- final UAT

### 감사 항목

- current identity duplicates
- 같은 snapshot/document의 update + exclude 동시 로그
- 날짜 정확히 -1일 변경 후보
- excluded 문서가 포함된 세트
- 위치 변화 audit가 있으나 movement log 없는 후보
- Excel restore 발생 후보
- snapshot count와 actual mutation count 차이
- staging/ready 장기 방치 작업

### 완료 기준

- audit 결과 report 생성
- 자동 수정 없음
- correction 절차 문서화
- backup/restore 확인
- production rollout checklist 승인
- 모든 CI gate green

---

# 25. 파일별 변경 지침

| 위치 | 변경 지침 |
|---|---|
| `src/permissions.js` | snapshot apply 전용 권한과 label 추가. Admin 하위 호환 유지 |
| 권한 DB adapter | 새 flag 읽기·저장·snapshot 포함 |
| `src/app/routeRegistry.js` | apply route에 전용 policy. 생성/prepare와 분리 |
| `src/handlers/snapshotHandlers.js` | 구조화 입력 파싱, 403/409 mapping, reason/ref 처리. 업무 판단 금지 |
| `src/domains/snapshots/index.js` | 공개 API만 export. 내부 파일 직접 import 금지 |
| snapshots domain | strict parser, identity, diff, auth, audit payload, hash |
| snapshots application | create/stage/prepare/apply orchestration |
| snapshots infrastructure | D1 SQL, exclusion, BatchPlan, set-based log/mutation |
| `src/views/clientScript/excelSnapshots.js` | UTC date, metadata strict read, row key 자동 영구생성 제거, file safety |
| `src/views/snapshotViews.js` | summary, diff, exclusion, reason, permission, warning |
| `src/documentCsv.js` | CSV 기능 유지. snapshot strict parser 의존 제거 |
| `src/data/documentsData.js` | detail에 sync_state/last_snapshot_id 추가 |
| sets repository/view | excluded count와 표시, current-only rack map |
| `src/freeTierBudget.js` | 필요 시 max file bytes, preview page size, threshold 상수 |
| migrations | 다음 번호만 추가. 기존 checksum 변경 금지 |
| tests | unit/integration/security/migration/browser/timezone/UAT contract |
| docs | ARCHITECTURE, OPERATIONS, PERMISSIONS, route catalog |

---

# 26. API 계약 권장안

## 26.1 Create

```text
POST /document-snapshots
```

입력:

```json
{
  "sourceName": "한림_문서고_관리대장_2026-07-20.xlsx",
  "clientSourceHash": "...64 hex...",
  "sourceSize": 123456,
  "totalCount": 300,
  "schemaVersion": 1,
  "baseVersion": 27,
  "currentSnapshotId": 14,
  "exportManifestId": "EXP-...",
  "mode": "managed",
  "rowKeyMode": "mixed"
}
```

서버 검증:

- 확장자
- 이름 길이
- hash format
- row count
- schemaVersion
- mode
- bootstrap 조건
- baseVersion
- metadata completeness

## 26.2 Stage rows

```text
POST /document-snapshots/:id/rows
```

입력:

```json
{
  "rows": [
    {
      "rowNumber": 2,
      "sourceRowKey": "HLM-...",
      "source": {
        "documentNumber": "...",
        "revisionNumber": "...",
        "revisionDate": "2026-07-20",
        "disposalDueYear": "2031",
        "documentName": "...",
        "category": "PV",
        "rackNumber": "2",
        "rackColumn": "1",
        "shelfNumber": "1",
        "rackFace": "1면",
        "tags": "원본보관;중요문서",
        "note": "",
        "status": "보관중"
      }
    }
  ]
}
```

- chunk ≤50
- snapshot status staging
- row number unique
- source key duplicate 검증
- row count 초과 방지
- stage 자체는 업무 필드 최종 검증을 하지 않아도 되지만 구조·크기는 검증

## 26.3 Prepare

```text
POST /document-snapshots/:id/prepare
```

결과:

```json
{
  "ok": true,
  "snapshot": {
    "status": "ready",
    "createCount": 3,
    "metadataCount": 4,
    "moveCount": 2,
    "disposeCount": 1,
    "restoreCount": 0,
    "unchangedCount": 289,
    "excludeCount": 1,
    "requiredPermissions": [
      "can_manage_documents",
      "can_apply_document_snapshots",
      "can_move_documents",
      "can_manage_disposals"
    ],
    "canonicalRowsHash": "..."
  }
}
```

## 26.4 Apply

```text
POST /document-snapshots/:id/apply
```

입력:

```json
{
  "applyReason": "2026년 문서고 정기 대장 현행화",
  "approvalReference": "CC-2026-0142",
  "confirmedExcludeCount": 1
}
```

- confirmed count와 현재 exclusion count 불일치 시 409
- 권한 재검사
- current version 재검사
- single batch
- redirect 또는 JSON은 기존 UI 계약에 맞추되 error code 보존

---

# 27. 구조화 오류 코드

최소 다음 code를 정의한다.

```text
SNAPSHOT_NOT_FOUND
SNAPSHOT_INVALID_STATE
SNAPSHOT_STALE
SNAPSHOT_SCHEMA_UNSUPPORTED
SNAPSHOT_METADATA_REQUIRED
SNAPSHOT_BOOTSTRAP_FORBIDDEN
SNAPSHOT_ROW_COUNT_MISMATCH
SNAPSHOT_ROW_DUPLICATE
SNAPSHOT_ROW_KEY_DUPLICATE
SNAPSHOT_ROW_KEY_UNKNOWN
SNAPSHOT_ROW_KEY_MISSING_FOR_EXISTING
SNAPSHOT_IDENTITY_DUPLICATE
SNAPSHOT_IDENTITY_CONFLICT
SNAPSHOT_INVALID_FIELD
SNAPSHOT_APPLY_PERMISSION_REQUIRED
SNAPSHOT_MOVE_PERMISSION_REQUIRED
SNAPSHOT_DISPOSAL_PERMISSION_REQUIRED
SNAPSHOT_RESTORE_ADMIN_REQUIRED
SNAPSHOT_REASON_REQUIRED
SNAPSHOT_APPROVAL_REFERENCE_REQUIRED
SNAPSHOT_EXCLUSION_CONFIRMATION_MISMATCH
SNAPSHOT_APPLY_DISABLED
SNAPSHOT_CONCURRENT_APPLY
```

문자열 정규식으로 DB 오류를 구분하는 비율을 줄인다. 필요한 경우 infrastructure error를 domain error로 명시적으로 변환한다.

---

# 28. 테스트 전략

## 28.1 테스트 계층

### 순수 unit

- date-only 변환
- status normalize
- strict field validation
- identity
- row key policy
- diff
- change flags
- required permissions
- stable serialization/hash
- threshold warning

### D1 integration

- migration replay
- unique index
- version triggers
- staging upsert
- prepare
- exclusion persistence
- apply batch
- rollback
- idempotency
- concurrent claim

### Route/security

- role/permission matrix
- CSRF
- trusted origin
- HTTP status
- error body
- forced password policy 회귀

### View contract

- summary
- exclusions
- diff
- HTML escaping
- disabled controls
- badges
- CSV columns
- print view

### Browser/Excel

- timezone round-trip
- standard ExcelJS workbook
- prefixed OOXML
- absolute relationship
- new row blank management ID
- hidden metadata
- generated asset drift

## 28.2 필수 시나리오 matrix

| 번호 | 시나리오 | 기대 결과 |
|---:|---|---|
| 1 | 최신 export 무수정 재업로드 | create/update/exclude 0, unchanged 전체 |
| 2 | 서울 timezone 날짜 왕복 | 날짜 동일 |
| 3 | 신규 blank 관리 ID 행 | 서버 ID 생성, create 1 |
| 4 | 기존 행 관리 ID 삭제 | prepare 실패 |
| 5 | 관리 ID 복제 | prepare 실패 |
| 6 | 같은 identity 두 행 | prepare 실패 |
| 7 | identity case-only 중복 | prepare 실패 |
| 8 | unknown status | prepare 실패 |
| 9 | 공란 위치 | prepare 실패 |
| 10 | 단면 랙 B | prepare 실패 |
| 11 | stale baseVersion | 문서 무변경, 409 |
| 12 | tag 변경 후 오래된 파일 | stale |
| 13 | move 권한 없음 | 403, 무변경 |
| 14 | dispose 권한 없음 | 403, 무변경 |
| 15 | non-Admin restore | 403, 무변경 |
| 16 | 실제 move | movement log 정확히 1 |
| 17 | 실제 dispose | disposal log 정확히 1 |
| 18 | actual exclusion | exclusion audit와 update 동일 문서 |
| 19 | no-key identity match | false exclusion audit 없음 |
| 20 | unique race | 전체 batch rollback |
| 21 | 두 apply 동시 호출 | 한 번만 완료 |
| 22 | completed 재호출 | alreadyApplied |
| 23 | unsupported schema | create 거부 |
| 24 | metadata 없는 managed file | create 거부 |
| 25 | bootstrap 두 번째 실행 | 거부 |
| 26 | excluded 문서 직접 상세 | 제외 badge, mutation action 없음 |
| 27 | excluded 문서 세트 포함 | 제외 count와 경고 |
| 28 | 1,000행 mixed diff | statement budget ≤40 |
| 29 | 1,001행 | 명확한 제한 오류 |
| 30 | OOXML 호환 파일 | 정상 parse |
| 31 | rack map 링크 | 정확한 rack ID filter |
| 32 | hash 입력 순서 변화 | canonical 규칙에 따른 deterministic 결과 |

## 28.3 품질 기준

- 새 domain pure functions: line/branch coverage 목표 90% 이상
- 보안·원자성 경로: 성공/실패/경합 모두 테스트
- 테스트 수를 줄여 green을 만들지 않는다.
- flaky time dependency 금지
- `new Date()`가 필요한 view test는 fixed clock 주입
- locale/timezone 의존 테스트는 명시적으로 환경 설정

---

# 29. 작업 명령과 검증 게이트

각 PR에서 최소 다음을 실행한다.

```powershell
cd cloudflare-app
npm ci
npm run check
npm run typecheck
npm run lint
npm run format:check
npm run check:migrations
npm run check:routes
npm run check:browser
npm test
npm run verify
npm run audit:dependencies
npm run release:evidence
npm run deploy:dry
```

추가:

```powershell
git diff --check
git status --short
```

### 금지

```text
npm install로 lockfile을 이유 없이 재생성
과거 migration checksum 변경
public/assets 직접 편집
wrangler d1 migrations apply --remote
wrangler deploy
main push
production secret 조회
```

---

# 30. 데이터 감사와 정정 계획

## 30.1 실행 원칙

- production 원본이 아니라 D1 export 또는 최신 backup 사본에서 먼저 실행한다.
- read-only query와 report generation만 수행한다.
- 자동 UPDATE/DELETE를 만들지 않는다.
- 모든 정정은 승인된 별도 작업으로 수행한다.
- append-only 감사로그는 correction event로 보완한다.

## 30.2 필수 감사 SQL

### 현재 identity 중복

```sql
SELECT
  UPPER(document_number) AS document_number_key,
  UPPER(revision_number) AS revision_key,
  COUNT(*) AS current_count,
  GROUP_CONCAT(id) AS document_ids
FROM documents
WHERE sync_state = 'current'
GROUP BY
  UPPER(document_number),
  UPPER(revision_number)
HAVING COUNT(*) > 1;
```

### 같은 snapshot에서 update와 exclude가 동시에 기록된 문서

```sql
WITH sync_logs AS (
  SELECT
    id,
    document_id,
    action,
    json_extract(details, '$.snapshotCode') AS snapshot_code
  FROM document_audit_logs
  WHERE action IN ('excel_sync_update', 'excel_sync_exclude')
)
SELECT
  snapshot_code,
  document_id,
  GROUP_CONCAT(id) AS audit_log_ids
FROM sync_logs
WHERE snapshot_code IS NOT NULL
GROUP BY snapshot_code, document_id
HAVING COUNT(DISTINCT action) = 2;
```

### 날짜가 정확히 하루 전으로 변경된 후보

```sql
SELECT
  id AS audit_id,
  document_id,
  document_number,
  json_extract(details, '$.snapshotCode') AS snapshot_code,
  json_extract(details, '$.before.revisionDate') AS before_date,
  json_extract(details, '$.after.values.revisionDate') AS after_date
FROM document_audit_logs
WHERE action = 'excel_sync_update'
  AND julianday(json_extract(details, '$.before.revisionDate'))
      - julianday(json_extract(details, '$.after.values.revisionDate')) = 1;
```

### 세트 내 제외 문서

```sql
SELECT
  s.id AS set_id,
  s.name AS set_name,
  d.id AS document_id,
  d.document_number,
  d.revision_number,
  d.status,
  d.last_snapshot_id
FROM document_set_items i
JOIN document_sets s ON s.id = i.set_id
JOIN documents d ON d.id = i.document_id
WHERE d.sync_state = 'excluded'
ORDER BY s.id, d.document_number, d.revision_number;
```

### Excel 위치 변경 감사와 movement log 불일치 후보

snapshot audit JSON의 before/after rack 정보가 존재하도록 개선한 뒤 다음 성격의 report를 만든다.

```text
excel_sync_update 중 rackSlotId/rackFace 변경
MINUS
같은 document/snapshot에 대응하는 document_movements
```

현재 로그 구조상 snapshot code가 movement table에 없다면 시간·actor·document 기준으로 보조 대조하고, 결과를 확정 오류로 단정하지 않는다.

## 30.3 정정 분류

| 유형 | 정정 원칙 |
|---|---|
| 중복 current 문서 | canonical 문서 선정 후 다른 문서를 approved snapshot으로 제외 |
| 날짜 -1일 | 원본 문서 근거 확인 후 controlled correction snapshot |
| false exclusion audit | 감사로그 삭제 금지, correction event 추가 |
| movement log 누락 | 소급 사실 확인 후 system audit correction. 원본 이동 이력 위조 금지 |
| 세트 내 excluded | 연결 보존, 화면 경고. 업무상 불필요 시 승인된 세트 변경으로 제외 |
| 잘못된 restore | 상태 근거 확인 후 정상 폐기/복구 절차 수행 |

---

# 31. 배포와 운영 전환

## 31.1 사전 조건

- 최신 production backup 성공
- migration replay 성공
- 데이터 감사 report 검토
- identity duplicate 0 또는 승인된 정리 완료
- UAT 환경에서 실제 운영 데이터 사본 검증
- CI green
- dependency audit green
- dry deploy green
- 담당자 교육 완료
- 신규 권한 부여 대상 승인

## 31.2 단계적 전환

### 단계 A: disabled

- 새 코드 배포
- snapshot 생성/검토 가능
- apply 불가
- 데이터 감사와 UAT 수행

### 단계 B: admin-only

- 지정 Admin만 실제 반영
- 첫 반영 전후 export 비교
- counts, version, audit, movement, disposal logs 대조
- 오류율과 request ID 모니터링

### 단계 C: permissioned

- `can_apply_document_snapshots` 지정 사용자에게만 부여
- 분기 권한 검토 대상에 포함
- move/disposal 권한 조합 확인
- 교육 기록 및 SOP 반영

## 31.3 첫 운영 반영 확인

- 전체 행 수
- create/update/move/dispose/restore/exclude counts
- 예상 exclusion 문서 목록
- baseVersion과 완료 후 version
- canonical rows hash
- actor와 reason
- approval reference
- document audit count
- movement log count
- disposal log count
- 재추출 파일 무수정 prepare 결과 0 diff

---

# 32. Rollback과 복구

## 32.1 애플리케이션 오류

migration이 additive하고 이전 Worker가 새 컬럼을 무시할 수 있으면 이전 Worker version으로 rollback한다.

## 32.2 데이터 오류

Worker rollback만으로 이미 반영된 데이터가 되돌아가지 않는다.

다음 순서:

1. 추가 apply 중지
2. release SHA, request ID, snapshot code 확보
3. 최신 backup 보호
4. 잘못된 snapshot의 before/exclusion records 검토
5. 승인된 correction snapshot 작성
6. 데이터 손상이 광범위하면 backup restore 절차
7. correction system audit 기록
8. 원인과 예방조치 문서화

## 32.3 migration 오류

- down migration을 즉석 작성하지 않는다.
- 새 corrective migration을 추가한다.
- destructive schema 변경은 별도 release로 분리한다.

---

# 33. Cursor Agent 작업 방식

## 33.1 각 PR 시작 보고 형식

```markdown
## 작업 시작 보고
- 기준 SHA:
- branch:
- 대상 PR 단계:
- 해결할 위험:
- 변경 예정 파일:
- 추가할 실패 테스트:
- schema 변경 여부:
- 권한 변경 여부:
- D1 statement 예상:
- 회귀 위험:
```

## 33.2 구현 중 원칙

- 한 번에 큰 파일 전체를 재작성하지 않는다.
- 먼저 테스트로 문제를 재현한다.
- pure policy를 domain 함수로 분리한다.
- SQL과 UI 문자열에 같은 업무 규칙을 중복 구현하지 않는다.
- 숫자, Boolean, date coercion은 명시적으로 한다.
- `SELECT *`를 감사/반영 핵심 경로에서 사용하지 않는다.
- JSON shape에 schemaVersion을 둔다.
- error code를 테스트한다.
- 새로운 fallback은 반드시 실패 모드보다 안전해야 한다.
- 생성 파일 diff가 비정상적으로 크면 build source와 dependency lock을 확인한다.
- package dependency 추가는 필요성과 browser/Worker bundle 영향을 보고한다.

## 33.3 각 PR 완료 보고 형식

```markdown
## 완료 보고
### 해결한 위험
- ...

### 변경 파일
- path: 변경 이유

### DB/Migration
- 새 migration:
- 과거 migration 변경 여부: 없음
- replay 결과:

### 권한
- route:
- 요구 권한:
- 실패 status:

### 원자성
- batch statement 수:
- guard:
- rollback test:

### 테스트
- 명령:
- 결과:
- 신규 test 목록:

### 수동 확인
- ...

### 남은 위험
- ...

### Rollback
- ...
```

## 33.4 중지 및 보고 조건

다음 상황에서는 추측으로 진행하지 않고 현재 상태와 선택지를 보고한다.

- baseline verify가 기존 main에서 실패
- 현재 migration 번호가 계획과 충돌
- production 사본에 current identity 중복 존재
- D1이 제안한 index/SQL 문법을 지원하지 않음
- statement 수가 40 초과
- 권한 DB 구조가 문서와 다름
- 과거 migration 수정 없이는 구현이 불가능해 보임
- 원본 감사로그 schema로 correction 근거를 만들 수 없음
- UI 요구를 충족하려면 공개 식별자 노출이 필요해 보임
- production 데이터 자동 수정이 필요해 보임

보고 시 더 안전한 대안을 우선 제시한다.

---

# 34. 코드리뷰 체크리스트

## 권한

- [ ] upload와 apply 권한이 분리되었는가
- [ ] move/dispose/restore 추가 권한을 계산하는가
- [ ] apply 시 현재 session으로 재검사하는가
- [ ] 권한 부족이 403인가
- [ ] UI 숨김에만 의존하지 않는가
- [ ] bootstrap이 Admin-only인가

## 입력

- [ ] 중요 필드 공란이 오류인가
- [ ] unknown status가 오류인가
- [ ] 날짜가 timezone independent인가
- [ ] row key가 서버 권위인가
- [ ] partial key 상황이 명시적으로 처리되는가
- [ ] schemaVersion을 서버가 검사하는가

## 데이터

- [ ] current identity unique인가
- [ ] exclusion이 document ID 기반인가
- [ ] before/after에 tags가 포함되는가
- [ ] excluded/current가 화면에서 분리되는가
- [ ] master data 변경이 version을 올리는가

## 감사

- [ ] 감사 INSERT가 UPDATE보다 먼저인가
- [ ] 동일 guard를 사용하는가
- [ ] reason/approval reference가 저장되는가
- [ ] movement와 status 업무 이력이 생성되는가
- [ ] 잘못된 과거 로그를 삭제하지 않는가
- [ ] 내부 storage code가 공개 payload에 없는가

## 원자성·성능

- [ ] 하나의 D1 batch인가
- [ ] statement ≤40인가
- [ ] set-based SQL인가
- [ ] 1,000건 테스트가 있는가
- [ ] stale/concurrent/unique failure rollback test가 있는가
- [ ] completed 재호출이 idempotent인가

## UI

- [ ] 제외 문서 이름을 반영 전에 볼 수 있는가
- [ ] before/after를 볼 수 있는가
- [ ] 위치·폐기·복구가 별도 표시되는가
- [ ] 위험 임계치가 표시되는가
- [ ] sync_state badge가 있는가
- [ ] HTML escaping과 접근성이 유지되는가

## 배포

- [ ] 새 migration만 추가했는가
- [ ] route catalog를 갱신했는가
- [ ] browser assets를 build로 갱신했는가
- [ ] verify/audit/dry deploy가 통과했는가
- [ ] backup/UAT/rollout mode가 준비되었는가

---

# 35. 전체 완료 정의

다음 조건을 모두 만족해야 개선 완료로 판단한다.

1. 일반 문서관리 권한만으로 snapshot apply를 할 수 없다.
2. 위치·폐기·폐기 해제 권한 우회가 불가능하다.
3. Asia/Seoul에서 날짜 round-trip이 보존된다.
4. 공란·오타가 조용히 기본값으로 변하지 않는다.
5. 현재 대장 identity가 DB와 애플리케이션 양쪽에서 유일하다.
6. 관리 ID 없는 신규 행은 서버가 ID를 생성한다.
7. 기존 관리 ID가 불필요하게 바뀌지 않는다.
8. 기준정보 변경 후 오래된 파일이 차단된다.
9. metadata 없는 파일은 명시적 bootstrap 외에는 거부된다.
10. unsupported schemaVersion이 거부된다.
11. exclusion 미리보기·감사·실제 UPDATE가 같은 문서 집합을 사용한다.
12. 실제 제외 없는 false exclusion 감사로그가 생성되지 않는다.
13. before/after와 tags가 감사 근거로 남는다.
14. 위치 변경마다 movement log가 남는다.
15. 상태 변경마다 disposal/restore log가 남는다.
16. apply reason과 필요한 approval reference가 남는다.
17. excluded 문서가 current 문서처럼 표시되지 않는다.
18. 1,000건 apply가 statement 40 이하로 원자 처리된다.
19. stale, 권한 오류, 중복, DB 오류 시 한 행도 바뀌지 않는다.
20. 최신 export 무수정 재업로드가 0 diff다.
21. OOXML 호환 파일과 rack ID 링크가 회귀하지 않는다.
22. migration replay, route catalog, browser drift, 전체 test, dependency audit, dry deploy가 모두 통과한다.
23. 데이터 감사 report와 correction 절차가 준비되어 있다.
24. production rollout이 disabled → admin-only → permissioned 순으로 수행 가능하다.
25. 최종 PR 설명에 변경 근거, 검증 증거, 남은 위험, rollback 절차가 포함되어 있다.

---

# 36. 최종 PR 설명 템플릿

```markdown
## 목적
엑셀 전체 문서대장 동기화의 권한 분리, 날짜·identity 무결성,
감사 추적성 및 미리보기 정확성을 개선합니다.

## 해결한 위험
- [ ] 권한 우회
- [ ] 날짜 하루 차이
- [ ] strict validation
- [ ] identity 중복
- [ ] stale 기준정보
- [ ] false exclusion audit
- [ ] exclusion 미리보기
- [ ] movement/disposal 이력
- [ ] excluded 문서 표시
- [ ] canonical evidence

## 주요 변경
- ...

## Migration
- 신규 migration:
- additive 여부:
- replay 결과:
- 과거 migration 수정: 없음

## 권한 영향
- 신규 권한:
- 기본 부여:
- route 정책:
- 동적 추가 권한:

## 데이터 영향
- 기존 데이터 자동 수정: 없음
- 사전 감사:
- correction 필요 여부:

## 검증
- npm run verify:
- npm run audit:dependencies:
- npm run release:evidence:
- npm run deploy:dry:
- 총 테스트:
- 신규 회귀 테스트:

## 수동 UAT
- 최신 export 무수정 왕복:
- 신규 행:
- 위치 변경:
- 폐기:
- 폐기 해제 차단:
- 제외:
- stale:
- OOXML:
- excluded 세트 표시:

## 운영
- apply mode:
- backup:
- rollout:
- monitor:
- rollback:

## 남은 위험
- ...
```

---

# 37. 최종 지시

Cursor Agent는 이 계획을 “한 번에 모든 파일을 바꾸는 요청”으로 해석하지 않는다.

반드시 다음 순서를 지킨다.

```text
Baseline과 긴급 차단
→ 권한
→ 날짜/strict parser
→ identity/DB 제약
→ version/schema/bootstrap
→ diff/exclusion/audit
→ movement/status logs
→ UI/sync_state
→ 데이터 감사/운영 전환
```

각 단계는 독립적으로 검토 가능해야 하며, 이전 단계의 테스트와 불변식을 다음 단계에서 그대로 유지한다. 기능이 동작하는 것만으로 완료 처리하지 않는다. 실패 시 무변경, 권한 분리, 감사 재현성, 운영 복구 가능성까지 증명되어야 한다.
