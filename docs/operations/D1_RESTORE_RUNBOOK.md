# D1 Backup Restore Runbook

이 절차는 데이터 손상 사고에서만 사용한다. 운영 D1에 직접 덮어쓰지 않고 항상 격리된 복구 DB에서 먼저 검증한다.

## 승인과 자료 확인

1. incident 책임자와 복구 승인자를 지정하고 쓰기 변경을 중지한다.
2. 대상 release SHA, 손상 시각, Cloudflare Time Travel 가능 시점, pre-deploy/주간 backup artifact를 기록한다.
3. 암호화 파일의 `.sha256`을 검증하고 passphrase를 환경변수로만 주입한다.

## 격리 복원 검증

1. 암호화 backup을 임시 보안 디렉터리에서 복호화·압축 해제한다. 원시 SQL은 artifact로 재업로드하지 않는다.
2. 새 격리 D1 데이터베이스를 만들고 dump를 import한다.
3. migration manifest의 table·trigger 목록, `PRAGMA foreign_key_check`, 핵심 행 수를 확인한다.
4. 복구 대상 Worker를 격리 DB에 연결해 `/healthz`, login, read-only search와 핵심 감사 이력을 검증한다.
5. 검증 결과, 누락 범위, 예상 중단 시간을 승인자에게 제출한다.

## 운영 복구

Cloudflare Time Travel 또는 검증된 backup 중 손실이 가장 적은 승인안을 사용한다. 운영 복구 직전 현재 상태도 별도
backup으로 보존한다. 복구 후 Worker version, migration 상태, health/login/search, 감사·문서 건수를 다시 확인한다.

원시 dump와 복호화 파일은 보존 정책에 따라 안전하게 파기하고, 최종 incident 기록에는 SHA, backup checksum,
승인자, 명령 결과, 검증 결과만 남긴다. 실제 복구 명령은 Cloudflare의 당시 공식 절차를 확인한 뒤 수행한다.
