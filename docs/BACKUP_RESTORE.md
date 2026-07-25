# D1 및 공식 Excel 대장 복구 절차

이 시스템은 보조 위치검색 시스템이며 공식 원본은 업무 책임자가 서명해 보관하는 Excel 문서대장이다.
운영 데이터의 1차 단기 복구 수단은 Cloudflare D1 Time Travel이고, Workers Free의 보존 기간은 7일이다.
7일을 넘긴 복구 또는 D1 시점 복구가 부적합한 경우 마지막 서명 Excel 대장을 빈 Core D1의
bootstrap/snapshot 경로에 재적재하고 검색 projection을 재색인하는 것이 최종 복구 경로다. 검색 projection은
같은 Core D1 안의 파생 테이블이므로 별도로 복구 시점을 맞추지 않는다. 별도 R2 또는 SQL export 장기 백업은
현재 무료티어 운영 범위에 포함하지 않는다.

매월 1회와 대량·중요 변경 직후 현재 대장을 추출해 문서 수·대장 version·canonical hash·인쇄용 관리대장을
대조하고, 업무 책임자가 서명한 파일과 승인 기록을 접근 통제된 사내 보관 위치에 보존한다. 비밀번호 최소
6자와 `workers.dev` 공개 주소, Cloudflare Access 미적용은 2026-07-25 문서대장 업무 소유자와 production
Environment 승인자가 기존 업무 정책·무료 운영 범위를 근거로 수용한 결정이며 PR/Environment 승인 기록을
증거로 사용한다.

### Break-glass

1. Cloudflare Dashboard에서 운영 Worker에 Access를 적용한다.
2. release smoke에 production secret으로 관리하는 service token 헤더를 추가한다.
3. 검증된 커스텀 도메인으로 전환하고 `workers.dev` 직접 접근을 차단한다.

Access 정책·token·주소 변경은 복구 자체와 분리해 incident 승인을 받고, token 값은 문서나 artifact에 남기지
않는다. 사고 발견 즉시 Time Travel 가능 시점을 먼저 확인한다.

## 배포 전 복구 지점

`Deploy Production` workflow는 migration 전에 Core D1의 현재 bookmark를 조회한다.
`release-evidence/d1-recovery.json`에는 다음 비민감 정보만 기록한다.

- release SHA와 GitHub run ID
- 환경 이름
- Core database 이름과 ID
- Core database의 Time Travel bookmark

guarded migration은 이 파일이 현재 run, SHA, environment와 Core D1 ID에 정확히 일치할 때만 실행된다.
복구 지점 artifact는 8일간 남지만 실제 복구 가능 기간은 Cloudflare의 7일 보존 기간을 따른다.

## 사고 판단

1. 쓰기 변경과 추가 배포를 중지한다.
2. 애플리케이션 오류인지 데이터 손상 또는 비호환 schema인지 구분한다.
3. 애플리케이션 문제이고 DB schema가 호환되면 이전 100% traffic Worker version으로 rollback한다.
4. 데이터 복구가 필요하면 손상 시각, 목표 시점, 예상 데이터 손실 범위를 기록한다. 검색 결과만 이상하고
   문서 상세가 정상이면 데이터 손상이 아니라 projection 색인 지연이므로 복구 대상이 아니다.
5. production Environment 승인권자에게 복구 대상 DB와 bookmark 또는 timestamp를 확인받는다.

D1 restore는 대상 DB의 현재 상태를 되돌리는 파괴적 작업이다. 자동화된 배포 workflow에서 실행하지 않는다.

## 복구 가능 시점 확인

`cloudflare-app/`에서 최소 권한 D1 token을 사용해 읽기 전용으로 확인한다.

```powershell
npx wrangler d1 time-travel info hanlim-archive --env production --json
```

배포 직전 상태로 복구할 때는 해당 release artifact의 bookmark를 사용한다. 특정 장애 시각으로 복구할 때는
Cloudflare가 반환하는 보존 범위 안인지 먼저 확인한다. 7일을 넘긴 시점은 현재 무료티어 절차로 복구할 수 없다.

## 승인된 원격 복구

복구 대상은 Core D1 하나이며 실행 후 결과를 확인한다.

```powershell
npx wrangler d1 time-travel restore hanlim-archive --env production --bookmark "<CORE_BOOKMARK>"
```

복구는 같은 DB의 검색 projection도 그 시점으로 되돌린다. 복구 시점의 projection이 복구된 문서와 어긋날 수
있으므로 복구 직후 재색인을 예약한다(`search_projection_state.reindex_status = 'pending'`). 명령 실행 직전
database 이름, ID, bookmark, 승인 기록을 다시 대조한다.

## 복구 후 검증

1. Core migration 상태가 예상 시점과 일치하는지 확인한다.
2. `/healthz`와 `/readyz`가 200인지 확인한다. `/readyz`는 파생 색인 지연으로 닫히지 않는다.
3. 승인 계정 로그인, 문서 검색·상세, 랙 위치와 최근 감사이력을 표본 확인한다.
4. 독립 Admin의 `/admin/settings` 접근과 사용자 관리 marker를 확인한다.
5. 관리자 화면에서 projection이 `ready`, 색인 건수가 current 문서 수와 같고 dirty 큐가 0인지 확인한다.
   어긋나면 재색인을 `pending`으로 되돌리고 Cron이 `ready`까지 전진하는지 관측한다.
6. incident 기록에 release SHA, Worker version, 복구 DB·bookmark, 승인자, 명령 결과와 검증 결과를 남긴다.

7일보다 긴 복구 보존이 실제 업무 요건이 되면 그 시점에 유료 D1 또는 별도 외부 백업의 비용·암호화·복구
훈련을 별도 승인한다. 현재 운영에는 사용하지 않는다.

## 빈 DB에서 Excel 대장 복구 리허설

아래 절차는 **격리된 로컬 DB에서만** 수행한다. 명령에 `--remote`, `--env production`을 추가하거나
운영 binding·database ID를 사용하지 않는다. 리허설 중에는 D1 Time Travel restore, 원격 migration, Worker
배포를 실행하지 않는다. 2026-07-25 리허설도 `:memory:` SQLite와 메모리에서 생성한 XLSX만 사용했으며
**운영·원격 Core D1은 변경하지 않았다.**

### 재현 순서

1. 서명 Excel의 파일명, 파일 SHA-256, 승인 참조, 문서 수, 대장 `baseVersion`과
   `canonicalExportHash`, 검색·위치 정답 표본을 복구 기록에 먼저 고정한다. XLSX 파일 byte hash와 행을
   정규화한 canonical hash는 서로 다른 값이므로 바꿔 쓰지 않는다.
2. 새 로컬 Core DB에 migration을 번호순으로 전부 적용한다. 검색 projection은 같은 chain의
   `0048`에 포함되므로 두 번째 migration 경로가 없다. 자동 리허설은 `tests/helpers/migratedDatabase.js`가
   빈 `:memory:` DB에 Core migration 전체를 적용한다. Wrangler의 지속 로컬 DB로 확인할 때만 다음
   `--local` script를 사용한다.

   ```powershell
   cd cloudflare-app
   npm run db:migrate:local
   ```

   Core migration은 bootstrap 교체 여부를 검증하기 위한 기본 문서 2건을 만든다. 이것은 운영 대장이 아니며,
   bootstrap apply가 정확한 초기 seed인지 다시 확인한 뒤 같은 transaction에서 교체한다.
3. 최초 서명 Excel은 로컬 앱의 `엑셀 대장 동기화`에서 bootstrap으로 선택한다. backup 확인을 체크하고
   확인문구 `BOOTSTRAP`을 정확히 입력한 뒤 먼저 prepare한다. 구조·identity 중복·기준정보·위치·태그·날짜와
   create/update/exclude 수가 승인 기록과 다르면 apply하지 않는다. 현재 snapshot이 이미 있거나 초기 seed가
   달라졌으면 bootstrap을 강행하지 말고 새 빈 로컬 DB부터 다시 시작한다.
4. apply 뒤 아래 집계를 로컬 Core DB에서 대조한다. 각 query는
   `npx wrangler d1 execute hanlim-archive --local --command "<SQL>"` 형식으로 실행할 수 있다.
   `--remote`는 사용하지 않는다.

   ```sql
   SELECT sync_state, status, COUNT(*) AS count
   FROM documents GROUP BY sync_state, status ORDER BY sync_state, status;

   SELECT UPPER(document_number) AS document_number,
          UPPER(revision_number) AS revision_number, COUNT(*) AS count
   FROM documents WHERE sync_state = 'current'
   GROUP BY UPPER(document_number), UPPER(revision_number)
   HAVING COUNT(*) > 1;

   SELECT c.name, COUNT(*) AS count
   FROM documents d JOIN categories c ON c.id = d.category_id
   WHERE d.sync_state = 'current' GROUP BY c.id, c.name ORDER BY c.name;

   SELECT r.zone_number, r.rack_number, d.rack_face,
          rs.column_number, rs.shelf_number, COUNT(*) AS count
   FROM documents d
   JOIN rack_slots rs ON rs.id = d.rack_slot_id
   JOIN racks r ON r.id = rs.rack_id
   WHERE d.sync_state = 'current'
   GROUP BY r.zone_number, r.rack_number, d.rack_face,
            rs.column_number, rs.shelf_number
   ORDER BY r.zone_number, r.rack_number, d.rack_face,
            rs.column_number, rs.shelf_number;

   SELECT t.name, COUNT(*) AS count
   FROM document_tags dt
   JOIN documents d ON d.id = dt.document_id
   JOIN tags t ON t.id = dt.tag_id
   WHERE d.sync_state = 'current'
   GROUP BY t.id, t.name ORDER BY t.name;

   SELECT manifest_id, base_version, current_snapshot_id,
          canonical_export_hash, document_count, status
   FROM document_snapshot_export_manifests
   ORDER BY created_at DESC LIMIT 1;
   ```

   identity 중복 query는 0행이어야 한다. 새로 추출한 XLSX의 `_시스템정보`에 있는 `baseVersion`,
   `currentSnapshotId`, `exportManifestId`, `canonicalExportHash`를 위 최신 completed manifest 및 승인 기록과
   대조하고, `문서데이터`와 `인쇄용 관리대장`의 총 건수·집계를 함께 확인한다.
5. 승인 표본의 정확 문서번호·일반 검색·태그 검색을 실행하고 검색 결과의 문서 identity와 Core 상세의
   구역/랙 면/열/선반을 서명 Excel과 대조한다. 위치 화면에서도 같은 랙·면·열·선반을 열어 문서가 표시되는지
   확인한다. 내부 `storage_code`는 대조 항목이나 사용자 증적에 기록하지 않는다.
6. bootstrap은 같은 batch에서 `search_projection_state.reindex_status = 'pending'`을 예약하고 bootstrap 중
   파생 trigger를 억제한다. 유지보수 작업(`runBoundedSearchMaintenance`)을 반복 실행해 dirty 배출과 chunk
   재색인을 끝낸다. 완료 기준은 `reindex_status = 'ready'`, `indexed_document_count = current 문서 수`,
   `search_projection_dirty` 0건이다. 재색인은 in-place upsert이므로 shadow generation과 cutover 확인 항목이
   없다. 자동 경로는 `searchProjection.test.js`가 같은 함수를 빈 메모리 Core DB에서 실행한다.
7. 재색인 뒤 5단계의 검색·위치 표본을 다시 실행한다. 실패하면 Core를 다시 bootstrap하지 말고
   `search_projection_documents`와 dirty 큐를 비운 뒤 `reindex_status`를 `pending`으로 되돌려 재색인만
   반복한다. 모든 결과, 시간, 입력 hash와 승인자를 복구 기록에 남긴 뒤에만 복구 환경의 쓰기를 개방한다.

### 자동 로컬 리허설 명령과 2026-07-26 결과

```powershell
cd cloudflare-app
node --test tests/excelSnapshotSync.test.js
node --test tests/excelSnapshotWorkbookE2E.test.js
node --test tests/searchProjection.test.js
node --test tests/tenThousandTransition.test.js
node --test tests/racksDomain.test.js
npm run rehearse:initial-load -- --count=10000
```

| 입력·경로 | 테스트가 실제 확인한 값 | 결과·전체 시간 |
|---|---|---|
| 생성한 300행 JS snapshot fixture → 빈 migrated Core → bootstrap/apply | ready의 create 300/update 0/unchanged 0/exclude 0, apply 뒤 current 300/excluded 0/disposed 30, current tag 연결 600, 초기 seed 0. export 문서 300과 모든 row key 존재, canonical hash는 소문자 64자리이며 잘못된 hash는 거부. 두 번째 snapshot은 update 1/unchanged 298/exclude 1, apply 뒤 current 299/excluded 1. 같은 파일의 1,000행은 current 1,000 및 28 statements를 확인 | 회귀 테스트 통과 |
| 생성한 10,000행 초기 List → 전체 migration 52개 → 실제 snapshot bootstrap 경로 | 50행×200 staging, prepare 11문장, apply 28문장, current 10,000/disposed 1,000/tag 연결 20,000, bootstrap membership/create audit/초기 disposal log 각 0. prepare JSON 재스캔 병목 수정 뒤 126.20초 → 약 0.57초, 전체 약 1.42초. 최종 Core 구조 비교 조회는 기본 목록 0.04ms, 문서번호 0.03ms, 문서명 0.02ms, 위치 scan 3.46ms | 로컬 구조 리허설 통과. Cloudflare SLA·실제 rows_written 측정은 아님 |
| migration seed 2건을 서버 export → 메모리 실제 XLSX 생성 → ExcelJS 재파싱 → managed prepare | 보이는 13개 열과 숨김 14열, 날짜·분류·랙/열/선반/면·태그를 왕복한 뒤 create/update/exclude/identity change 각 0, unchanged 2 | 1/1 통과, 554.7382 ms |
| 빈 migrated Core 메모리 DB의 projection dirty·재색인·검색 fixture | reference·랙 이름 변경이 전체 재구축 대신 영향 문서만 dirty로 표시, in-place 재색인이 current 아닌 문서를 정리, 배출이 projection 쓰기와 큐 삭제를 한 batch로 처리, 경합 시 오래된 내용이 최신 projection을 덮어쓰지 않음. 200건 초과 결과의 페이지·전체 합계·패싯, 등록·개정·CSV 경로의 응답 직후 검색 API 반영, Cron 유지보수가 예산 안에서 `ready`까지 전진 | 11/11 통과, 1,111.5411 ms |
| 용량 정책·membership fixture | 11,000 경고와 12,000 하드 상한, 상한 다음 current 문서의 원자 차단, 무변경 12,000행 경로의 source JSON 미재전송 | 3/3 통과, 341.5783 ms |
| rack/location 순수 fixture | `1구역 / 13-2번 랙 / 7열 / 6선반`, slot label `1구역 / 2번랙 / 7열 / 6선반 / 단면`, 7열×6선반과 A/B·mirror 표시 규칙 | 4/4 통과, 107.6642 ms |

이번 fixture의 300행은 6개 분류와 25개 랙 면을 순환하고 각 행에 `중요문서;원본보관`을 넣지만,
테스트가 분류별·위치별 기대 건수를 직접 assertion하지는 않는다. 따라서 분류별 집계, 위치별 집계, current
identity 중복 query 결과, 검색 결과와 bootstrap 문서 위치의 end-to-end 일치, 승인된 고정 canonical hash,
정확히 10,000건의 **synthetic bootstrap/apply는 측정 완료**했다. 다만 실제 승인 Excel의 분류별·위치별 집계,
Cloudflare `rows_written`, projection indexed count 10,000, `/readyz`와 관리 화면 확인은 **미측정/운영 서명 Excel 필요**다.
실제 XLSX 테스트도 migration seed를 managed 0-diff로 왕복한 것이며, 생성 XLSX bytes를 300행 bootstrap에
직접 apply한 단일 통합 E2E는 아니다. 운영 복구 승인 전에 위 3~7단계를 실제 서명 Excel 사본으로 다시
수행한다.

### 개정 링크와 version 경합 주의

`document_revision_links`에 연결된 문서는 Excel snapshot으로 문서번호·개정번호를 바꿀 수 없고, 개정으로
자동 폐기된 이전본을 복원할 수도 없다. prepare 검증과 최종 apply guard 중 하나라도 충돌하면 전체 반영을
중단하고, identity 변경은 전용 `문서 개정` 절차로 처리한다. Excel을 추출한 뒤 문서 등록·수정·이동·폐기,
분류·태그·랙 변경이 발생하면 현재 version이 증가해 파일의 `baseVersion`이 stale해진다. apply 직전까지
version을 다시 확인하고 충돌 시 파일을 억지로 재사용하지 말고 최신 대장을 다시 추출해 승인·hash·집계를
새로 대조한다.
