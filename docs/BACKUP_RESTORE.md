# D1 백업·복구 절차

운영 백업은 `.github/workflows/d1-backup.yml`이 매주 생성한다. Core와 Search D1 export는 각각 gzip 후 age X25519 recipient로 암호화해 비공개 R2에 올린다. GitHub artifact에는 DB ciphertext가 아니라 R2 object key·SHA-256 checksum·migration replay 결과만 포함한다.

## 준비

- GitHub Actions secret `CLOUDFLARE_D1_BACKUP_API_TOKEN`에는 대상 Core·Search D1 export와 지정 R2 bucket object read/write에 필요한 권한만 허용한다. 배포·migration 토큰과 공유하지 않는다.
- GitHub variable `R2_BACKUP_BUCKET`과 `BACKUP_AGE_RECIPIENT`를 등록한다. age private key는 GitHub에 등록하지 않고 이중 통제 복구 보관소에서 관리한다.
- R2 development URL과 custom public domain을 비활성화하고, `predeploy/`·`scheduled/` prefix에 승인된 lifecycle·object lock을 설정한다.
- D1 전체 export 중에는 데이터베이스의 다른 요청이 차단될 수 있으므로 정기 백업은 저사용 시간에 실행하고, 수동 백업은 점검창을 공지한 뒤 실행한다.
- 백업과 운영 배포는 Actions의 `d1-production-maintenance` 동시성 그룹으로 직렬화하며 백업 작업은 30분 후 자동 종료한다.
- 복구 작업은 운영 DB와 분리된 로컬 임시 디렉터리에서 수행한다.
- Windows에서는 `age`, gzip, `sha256sum`을 제공하는 Git Bash 또는 WSL 사용을 권장한다.

## 로컬 복구 훈련

1. GitHub Actions의 `D1 Backup` receipt에서 승인 대상 R2 object key와 ciphertext SHA-256을 확인한 뒤 격리된 디렉터리로 Core·Search object를 내려받는다.
2. 각 object의 `sha256sum`이 receipt와 같은지 확인한다.
3. 격리된 복구 단말에서 age identity 파일을 지정해 복호화한다. identity 값은 셸 기록에 직접 입력하지 않는다.
   ```bash
   age --decrypt --identity /secure/recovery/hanlim-backup.agekey \
     --output core-restore.sql.gz core-RELEASE_SHA-CHECKSUM.sql.gz.age
   age --decrypt --identity /secure/recovery/hanlim-backup.agekey \
     --output search-restore.sql.gz search-RELEASE_SHA-CHECKSUM.sql.gz.age
   ```
4. 두 파일을 `gzip -dc`로 압축 해제한다.
5. `cloudflare-app/`에서 비어 있는 격리 persistence 디렉터리를 만들고 그 로컬 D1에만 복구한다. 기존 개발용 `.wrangler` 상태를 재사용하지 않는다.
   ```bash
   RESTORE_STATE="$(mktemp -d)"
   npx wrangler d1 execute hanlim-archive --local \
     --persist-to "$RESTORE_STATE" --file ../restore.sql
   ```
6. 같은 격리 경로에서 다음 표의 건수를 백업 시점 기대값과 비교한다.
   ```sql
   SELECT 'documents', COUNT(*) FROM documents
   UNION ALL SELECT 'racks', COUNT(*) FROM racks
   UNION ALL SELECT 'app_users', COUNT(*) FROM app_users
   UNION ALL SELECT 'document_audit_logs', COUNT(*) FROM document_audit_logs
   UNION ALL SELECT 'system_audit_logs', COUNT(*) FROM system_audit_logs;
   ```
   ```bash
   npx wrangler d1 execute hanlim-archive --local --persist-to "$RESTORE_STATE" \
     --command "SELECT 'documents', COUNT(*) FROM documents UNION ALL SELECT 'racks', COUNT(*) FROM racks UNION ALL SELECT 'app_users', COUNT(*) FROM app_users UNION ALL SELECT 'document_audit_logs', COUNT(*) FROM document_audit_logs UNION ALL SELECT 'system_audit_logs', COUNT(*) FROM system_audit_logs;"
   ```
7. `npm run dev -- --persist-to "$RESTORE_STATE"`로 격리 DB를 연결한 뒤 문서번호 검색, 문서 상세, 랙 격자, 최근 감사이력을 표본 확인한다.
8. 원격 복구가 승인되면 작업 직전 `D1 Backup`을 수동 실행해 추가 백업을 만든다. 원격 실행 명령은 두 명이 대상 DB와 파일을 교차 확인한 뒤 수행한다.
9. 복구 후 `/healthz`가 200인지, 검색·상세 화면이 정상인지 확인하고 복구 일시·작업자·검증 건수를 감사 기록에 남긴다.

복구가 끝나면 원문 `restore.sql`, 압축 해제 파일, `$RESTORE_STATE` 격리 디렉터리와 셸 기록을 안전하게 삭제하고 암호 환경변수를 해제한다.

## 운영 사고 복구

이 절차는 데이터 손상 사고에서만 사용한다. 운영 D1에 직접 덮어쓰지 않고 격리 DB에서 먼저 검증한다.

1. incident 책임자와 복구 승인자를 지정하고 쓰기 변경을 중지한다.
2. 대상 release SHA, 손상 시각, Time Travel 가능 시점, pre-deploy·주간 R2 object와 receipt를 기록한다.
3. 암호화 파일의 checksum을 검증하고 age identity는 승인된 격리 복구 단말에서만 사용한다.
4. 새 격리 D1에 복원한 뒤 migration manifest, `PRAGMA foreign_key_check`, 핵심 행 수를 확인한다.
5. 복구 대상 Worker를 격리 DB에 연결해 health, login, read-only 검색과 감사 이력을 검증한다.
6. 누락 범위와 예상 중단 시간을 승인자에게 제출하고 Time Travel 또는 검증된 backup 중 손실이 가장 적은 안을 승인받는다.
7. 운영 복구 직전 현재 상태도 별도 backup으로 보존한다.
8. 복구 후 Worker version, migration 상태, health/login/search, 감사·문서 건수를 다시 확인한다.

원시 dump와 복호화 파일은 보존 정책에 따라 안전하게 파기한다. incident 기록에는 SHA, backup checksum, 승인자, 명령 결과와 검증 결과만 남긴다. 실제 원격 복구 명령은 Cloudflare의 당시 공식 절차를 확인한 뒤 수행한다.
