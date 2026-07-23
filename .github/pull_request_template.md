## 변경 내용

<!-- 변경한 기능·문서·운영 설정을 간결하게 설명합니다. -->

-

## 변경 사유

<!-- 해결하려는 문제와 기존 동작의 한계를 설명합니다. -->

-

## 영향

<!-- 사용자, 권한, 데이터, D1 사용량, 운영 절차에 미치는 영향을 작성합니다. -->

- 사용자·업무 영향:
- 권한·보안 영향:
- 데이터·migration 영향:

## 검증

<!-- 실제 실행한 명령과 결과를 작성합니다. -->

- [ ] `npm run verify`
- [ ] `npm run audit:dependencies` (dependency 또는 release 변경 시)
- [ ] `npm run deploy:dry` (Worker·배포 설정 변경 시)
- [ ] 필요한 수동 화면·운영 시나리오 확인

## 배포와 rollback

<!-- 배포 조건, migration 호환성, 실패 시 복구 방법을 작성합니다. -->

- 배포 조건:
- rollback 또는 복구:

## 확인 항목

- [ ] 실제 계정, 비밀번호, token, cookie, 운영 DB export를 포함하지 않았습니다.
- [ ] 기존 migration SQL과 checksum을 수정·삭제하지 않았습니다.
- [ ] 권한·CSP·CSRF·감사·D1 원자성 계약을 유지했습니다.
- [ ] 소스 변경에 맞춰 테스트, 생성 browser asset과 문서를 갱신했습니다.
- [ ] PR 범위와 무관한 파일 또는 임시 report·ZIP·log·patch를 포함하지 않았습니다.
