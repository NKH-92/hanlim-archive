# 개선 백로그

현재 실제로 남아 있는 후보만 기록한다. 완료·폐기된 구현 단계는 Git 이력으로 관리하며 구조와 불변식은 [ARCHITECTURE.md](./ARCHITECTURE.md)를 따른다.

## 호환 관찰 종료 후

다음 항목은 현재 기능이 아니라 직전 Worker·기존 URL과의 호환을 위한 경계다. 운영 관찰과 rollback window 종료를 승인한 뒤 각각 독립적으로 제거한다.

1. `search_index_state` generation mirror와 더 이상 사용하지 않는 물리 Search D1 resource를 제거한다.
2. `login_throttle_v2` 이전 schema용 `login_throttle` fallback을 제거하고 credential reset/cleanup 경로를 v2 기준으로 단순화한다.
3. 현재 410을 반환하는 `/api/search-index` compatibility route를 제거해 일반 404로 전환한다.
4. 과거 URL의 `includeDisposed` query alias를 제거하고 `status=active|disposed|all`만 지원한다.
5. 현재 HTTP route가 없는 내부 `permanentlyDeleteDocument` rollback surface를 제거한다.

각 항목은 제거 직전 source/runtime 참조 0, 직전 배포 Worker rollback 필요성, 실제 URL/client 사용 여부를 확인하고 migration이 필요한 경우 append-only contract release로 분리한다.

## 문서고 증설 확정 시

1. 고정 구역 설정을 `floor_plan_regions` 기반 동적 관리로 전환한다.
2. 구역당 랙 상한을 설정값으로 전환한다.
3. 도면 영역 편집 UI와 정적 도면 교체 절차를 추가한다.

## 검토 후 보류

| 아이디어 | 착수 조건 |
|---|---|
| 통계 dashboard | 감사 시나리오에서 현재 report로 부족하다는 운영 근거가 생길 때 |
| 문서 scan/PDF 보관 | 별도 object storage 비용·보존·권한 운영 방안이 승인될 때 |
| 이메일·메신저 알림 | 외부 서비스와 개인정보 처리 기준이 정해질 때 |
