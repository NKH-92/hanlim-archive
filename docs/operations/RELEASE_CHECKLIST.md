# 운영 Release Checklist

## 병합 전

- [ ] PR이 한 가지 release 목적과 대상 SHA를 명시한다.
- [ ] `required / verify`와 CODEOWNERS 승인이 완료됐다.
- [ ] migration은 append-only이며 expand/contract 단계가 표시됐다.
- [ ] UI, 권한, route, D1 BatchPlan, 감사 불변식의 영향이 PR에 기록됐다.
- [ ] CI evidence의 dependency audit, migration manifest, bundle report를 확인했다.

## 승인과 배포

- [ ] production Environment reviewer가 대상 SHA와 변경 창을 승인했다.
- [ ] pre-deploy D1 backup artifact와 SHA-256 파일이 업로드됐다.
- [ ] migration apply 결과가 release evidence에 있다.
- [ ] Worker deploy 결과와 before/after version 목록이 있다.
- [ ] health, login, signup 404, 인증 read-only 검색 smoke가 통과했다.

## 완료 또는 실패

- [ ] 성공 시 production release artifact 이름과 Git SHA를 변경 기록에 연결했다.
- [ ] smoke 실패 시 자동 Worker rollback 결과를 확인했다.
- [ ] DB 복구가 필요하면 일반 revert를 중단하고 D1 restore runbook을 시작했다.
- [ ] secret, 원시 SQL dump, session cookie가 로그나 artifact에 평문으로 남지 않았다.
