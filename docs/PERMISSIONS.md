# 권한 운영 가이드

Admin은 세부 flag와 관계없이 모든 권한을 가진다. 일반 User는 DB에서 매 요청 다시 읽은 `can_*` 권한만 사용할 수 있다. 미인증·disabled·rejected 사용자와 `security_review_required = 1`인 사용자는 업무 route에 진입할 수 없다. 메뉴 숨김은 편의 기능이며 모든 쓰기·관리 route는 서버에서 다시 검사한다.

## 권한 catalog

| 권한 | 허용 업무 |
|---|---|
| `can_manage_documents` | 문서 등록·수정, CSV 가져오기, 데이터 품질 수정, 엑셀 대장 추출·검증 |
| `can_move_documents` | 문서 위치 이동과 이동 이력 |
| `can_manage_disposals` | 폐기 캠페인, 폐기, 영구삭제 |
| `can_manage_sets` | 세트 생성·수정·잠금·문서 추가/제외 |
| `can_manage_masters` | 랙·대분류·태그 관리 |
| `can_manage_users` | 등록 계정 상태·권한 변경 |
| `can_view_audit` | 전역 감사, 검색 리포트, 문서 감사 이력 |
| `can_apply_document_snapshots` | 엑셀 전체 대장 최종 반영(기본 0, archive_manager에도 자동 부여하지 않음) |

## 주요 route 정책

| 기능 | 요구 조건 |
|---|---|
| 검색·문서 조회·도면·세트 조회 | 인증 사용자 |
| 문서 생성·수정·CSV·데이터 품질 | `can_manage_documents` |
| 엑셀 대장 추출·업로드·prepare | `can_manage_documents` |
| 엑셀 대장 최종 반영 | `can_manage_documents` + `can_apply_document_snapshots` (+ 위치/폐기 변경 시 각 권한, 폐기 해제는 Admin) |
| 위치 이동 | `can_move_documents` |
| 이동 이력 | `can_move_documents` 또는 `can_view_audit` |
| 폐기·캠페인·영구삭제 | `can_manage_disposals` |
| 폐기 해제 | Admin |
| 세트 변경·잠금 | `can_manage_sets` |
| 랙·대분류·태그 | `can_manage_masters` |
| 사용자 상태·권한 | `can_manage_users` |
| 사용자 비밀번호 초기화 | `Admin`만 가능(자기 계정·보안 검토 계정 제외) |
| 전역 감사·검색 리포트 | `can_view_audit` |
| `/admin` | 관리 권한 중 하나 이상, 내부 데이터는 개별 권한으로 제한 |

정확한 route descriptor 대응표는 `npm run docs:routes`로 생성되는 [route catalog](./generated/ROUTE_PERMISSION_CATALOG.md)를 사용한다. POST form은 permission 외에도 trusted Origin과 현재 session의 CSRF token이 필요하다.

## 권장 프로필

- 조회 사용자: 추가 권한 없음
- 문서고 담당자: 문서관리 + 위치이동 + 세트관리
- 폐기 담당자: 폐기관리
- 운영 관리자: 기준정보관리 + 감사조회
- 시스템 관리자: Admin

권한 변경은 전역 감사로그에 남긴다. session cookie는 DB의 `session_epoch`와 매 요청 대조하며 로그아웃·비밀번호 변경·사용중지·재활성화 때 epoch를 증가시킨다. 따라서 복사된 cookie도 다음 요청부터 거부된다. `security_review_required` 계정은 일반 승인 처리로 되살릴 수 없고 별도 보안 검토·credential 재발급 절차가 필요하다. 퇴사·업무변경 시 계정을 삭제하지 말고 먼저 사용중지해 과거 감사 snapshot을 보존한다. 분기마다 승인 사용자와 권한을 검토하고 최소권한을 유지한다.
