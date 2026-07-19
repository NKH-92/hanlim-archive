# 개선 백로그

현재 실제로 남아 있는 후보만 기록한다. 완료·폐기된 구현 단계는 Git 이력으로 관리하며 구조와 불변식은 [ARCHITECTURE.md](./ARCHITECTURE.md)를 따른다.

## 보안 후속 PR

1. 기존 bootstrap salt/hash와 최초 비밀번호 변경 상태가 그대로인 legacy 계정만 비활성화하는 새 append-only migration을 추가한다. 이미 비밀번호를 변경한 관리자와 다른 계정은 건드리지 않는다.
2. 기본 비밀번호 없이 stdin 또는 환경변수로 password를 받아 salt/hash만 생성하는 관리자 provisioning 절차를 도입한다. 원격 실행은 명시적 선택과 대상 확인 없이는 허용하지 않는다.
3. clean DB 전체 migration replay, 기존 DB에 신규 migration 적용, legacy 계정만 비활성화되는 조건과 평문 미출력을 테스트한다.

이 작업은 기존 migration 수정 없이 별도 승인된 보안 PR에서 수행한다.

## 문서고 증설 확정 시

1. 고정 구역 설정을 `floor_plan_regions` 기반 동적 관리로 전환한다.
2. 구역당 랙 상한을 설정값으로 전환한다.
3. 도면 영역 편집 UI와 정적 도면 교체 절차를 추가한다.

## 검토 후 보류

| 아이디어 | 착수 조건 |
|---|---|
| 통계 dashboard | 감사 시나리오에서 현재 report로 부족하다는 운영 근거가 생길 때 |
| 문서 scan/PDF 보관 | R2 비용·보존·권한 운영 방안이 승인될 때 |
| 이메일·메신저 알림 | 외부 서비스와 개인정보 처리 기준이 정해질 때 |
