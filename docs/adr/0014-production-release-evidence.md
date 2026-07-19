# ADR 0014: 승인 기반 Production Release와 Evidence

- 상태: 승인
- 날짜: 2026-07-19

## 결정

`main` 병합과 production 배포를 분리된 보호 경계로 취급한다. PR은 이름이 안정된
`required / verify` check를 통과하고, production job은 GitHub Environment reviewer 승인 후에만 실행한다.

운영 mutation 전에 현재 Worker version, migration/schema manifest, dependency audit, bundle report와 암호화
D1 backup을 보존한다. 이후 migration → Worker deploy → 인증 read-only smoke 순서로 실행한다. smoke가 실패하면
이전 Worker version으로 자동 rollback하되, D1 migration은 append-only expand/contract 정책으로 이전 Worker와
호환되게 설계한다. DB 복구는 일반 code revert가 아니라 별도 승인된 restore 절차다.

## 결과

- 한 Git SHA에 CI, backup, migration, deploy, smoke 증빙을 연결할 수 있다.
- backup 업로드 실패나 Environment 미승인 상태에서는 운영 migration이 시작되지 않는다.
- production secret은 GitHub Environment에서만 주입하고 저장소에는 이름과 최소 scope만 기록한다.
- branch protection과 required reviewer 설정은 GitHub UI 수동 작업이며 deployment guide가 이를 체크리스트로 남긴다.
