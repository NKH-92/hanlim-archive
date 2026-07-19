# Route Catalog

> Phase 3 이후 실행 가능한 route descriptor와 권한 metadata의 최신 목록은
> [`generated/ROUTE_PERMISSION_CATALOG.md`](generated/ROUTE_PERMISSION_CATALOG.md)에서 자동 생성한다.
> 이 문서의 아래 내용은 Phase 0 동작 기준선과 dispatcher 우선순위를 설명한다.

기준일 2026-07-19, HEAD `aa076e44f96686994c089d51b977cef024f8c1a0`의 실제 dispatcher를
기록한다. 이 문서는 목표 설계가 아니라 현재 동작의 characterization이다.

## 공통 우선순위

1. `/images/*`, `/favicon.ico` asset passthrough
2. `GET /healthz`
3. 모든 POST의 same-origin 검사
4. `GET|POST /login`
5. `/signup` 404
6. session 조회, 미인증이면 `/login?returnUrl=...` 302
7. 인증 POST의 CSRF 검사
8. `/logout`
9. `must_change_password` 강제 redirect
10. 인증 dispatcher
11. 미매칭 404

따라서 미지원 POST도 신뢰하지 않은 Origin이면 404보다 403이 먼저이며, 인증 POST의 CSRF
오류도 최종 404보다 먼저다. 현재 명시적 405 응답은 없다.

## 공개·인증 경계

| pattern | method | 인증 | 결과/handler |
|---|---|---|---|
| `/images/*`, `/favicon.ico` | any | 공개 | `env.ASSETS.fetch` |
| `/healthz` | GET | 공개 | D1 `SELECT 1`, 200 또는 503 JSON |
| `/login` | GET | 공개 | 로그인 화면 |
| `/login` | POST | 공개 | 로그인 처리 |
| `/signup` | any | 공개 | 404 |
| 그 외 | any | 필요 | 미인증 302 로그인 redirect |
| `/logout` | POST | 필요+CSRF | 세션 cookie 제거 |
| `/logout` | 그 외 | 필요 | `/app` 302 |
| `/account/password` | GET | 필요 | 비밀번호 변경 화면 |
| `/account/password` | POST | 필요+CSRF | 비밀번호 변경 |

## 검색·조회

| pattern | method | 추가 권한 | handler/비고 |
|---|---|---|---|
| `/` | GET | 없음 | `/app` 302 |
| `/app` | GET | 없음 | 검색 홈/결과 |
| `/floor-plan` | GET | 없음 | 전체 문서고 도면 |
| `/qa` | GET | 없음 | 지원 정보 |
| `/api/search-suggestions` | GET | 없음 | 검색 제안 JSON |
| `/api/viewer/search` | GET | 없음 | 조회 검색 JSON |
| `/api/search-index` | GET | 없음 | 브라우저 검색 index |
| `/api/search-click` | POST | 없음 | 검색 클릭 기록 |
| `/documents` | GET | 없음 | 문서 browse 목록 |
| `/documents/:id` | GET | 없음 | 문서 상세 |
| `/sets` | GET | 없음 | 세트 목록 |
| `/sets/:id` | GET | 없음 | 세트 상세 |
| `/sets/:id/export`, `/sets/:id/export.csv` | GET | 없음 | 세트 CSV |

## 문서 command

| pattern | method | 권한 | handler/비고 |
|---|---|---|---|
| `/api/documents/duplicate` | GET | `can_manage_documents` | 번호·개정 중복 검사 |
| `/documents/export.csv` | GET | `can_manage_documents` | 문서 CSV |
| `/documents/import` | GET, POST | `can_manage_documents` | CSV 작업 생성 화면/처리 |
| `/documents/new` | GET | `can_manage_documents` | 등록 화면 |
| `/documents` | POST | `can_manage_documents` | 문서 생성 |
| `/documents/:id/edit` | GET, POST | `can_manage_documents` | 문서 수정 |
| `/documents/:id/revise` | GET | `can_manage_documents` | 새 개정 등록 화면 |
| `/documents/:id/move` | GET, POST | `can_move_documents` | 전용 위치 이동 |
| `/documents/:id/dispose` | POST | `can_manage_disposals` | 단건 폐기 |
| `/documents/:id/restore` | POST | Admin only | 폐기 해제 |
| `/documents/:id/delete-permanent` | POST | `can_manage_disposals` | 폐기 문서 영구삭제 |
| `/documents/disposal` | GET | `can_manage_disposals` | 폐기 workspace |
| `/documents/bulk-dispose` | POST | `can_manage_disposals` | 소량 일괄 폐기 |
| `/documents/disposal/process` | POST | `can_manage_disposals` | 선택 문서 캠페인 생성 |
| `/documents/dispose-filtered` | POST | `can_manage_disposals` | 필터 캠페인 초안 생성 |

`/documents/:id/:action`의 지원하지 않는 action/method는 handler에서 404를 확정한다.

## 폐기 캠페인과 CSV 작업

| pattern | method | 권한 | action |
|---|---|---|---|
| `/disposal-batches` | GET, POST | `can_manage_disposals` | 목록, 생성 |
| `/disposal-batches/new` | GET | `can_manage_disposals` | 생성 화면 |
| `/disposal-batches/:id` | GET | `can_manage_disposals` | 상세 |
| `/disposal-batches/:id/edit` | GET, POST | `can_manage_disposals` | 초안 수정 |
| `/disposal-batches/:id/freeze` | POST | `can_manage_disposals` | 대상 동결 |
| `/disposal-batches/:id/start` | POST | `can_manage_disposals` | 처리 시작 |
| `/disposal-batches/:id/process` | POST | `can_manage_disposals` | chunk 처리, JSON 가능 |
| `/disposal-batches/:id/cancel` | POST | `can_manage_disposals` | 취소 |
| `/disposal-batches/:id/export.csv` | GET | `can_manage_disposals` | 보고서 CSV |
| `/disposal-batches/:id/items/:itemId/exclude` | POST | `can_manage_disposals` | 대상 제외 |
| `/disposal-batches/:id/items/:itemId/include` | POST | `can_manage_disposals` | 대상 복원 |
| `/document-import-jobs` | GET, POST | `can_manage_documents` | 목록, 작업 생성 |
| `/document-import-jobs/:id` | GET | `can_manage_documents` | 작업 상세 |
| `/document-import-jobs/:id/process` | POST | `can_manage_documents` | 1행 처리, JSON 가능 |
| `/document-import-jobs/:id/cancel` | POST | `can_manage_documents` | 작업 취소 |
| `/document-import-jobs/:id/failures.csv` | GET | `can_manage_documents` | 실패 CSV |

## 세트·랙·기준정보

| pattern | method | 권한 | action |
|---|---|---|---|
| `/sets/new` | GET | `can_manage_sets` | 생성 화면 |
| `/sets` | POST | `can_manage_sets` | 생성 |
| `/sets/:id/edit` | GET, POST | `can_manage_sets` | 수정 |
| `/sets/:id/delete` | POST | `can_manage_sets` | 삭제 |
| `/sets/:id/add` | POST | `can_manage_sets` | 문서 추가 |
| `/sets/:id/remove` | POST | `can_manage_sets` | 문서 제외 |
| `/sets/:id/lock`, `/sets/:id/unlock` | POST | `can_manage_sets` | 잠금/해제 |
| `/racks` | GET, POST | `can_manage_masters` | 목록, 생성 |
| `/racks/new` | GET | `can_manage_masters` | 생성 화면 |
| `/racks/configure` | GET, POST | `can_manage_masters` | 구역별 구성 |
| `/racks/:id` | GET | `can_manage_masters` | 랙 상세 |
| `/racks/:id/edit` | GET, POST | `can_manage_masters` | 랙 수정 |
| `/categories` | GET, POST | `can_manage_masters` | 목록, 생성/수정 |
| `/categories/:id/edit`, `/categories/:id/delete` | POST | `can_manage_masters` | 수정, 비활성 |
| `/tags` | GET, POST | `can_manage_masters` | 목록, 생성/수정 |
| `/tags/:id/edit`, `/tags/:id/delete` | POST | `can_manage_masters` | 수정, 비활성 |

## 관리자·감사

| pattern | method | 권한 | handler/비고 |
|---|---|---|---|
| `/admin` | GET | 7개 권한 중 하나 | 권한별 dashboard 조각 |
| `/admin/settings` | GET | `can_manage_users` | 사용자 목록 |
| `/admin/users/:id/permissions` | GET, POST | `can_manage_users` | 권한 화면/저장 |
| `/admin/users/:id/approve` | POST | `can_manage_users` | 승인 |
| `/admin/users/:id/reject` | POST | `can_manage_users` | 반려 |
| `/admin/users/:id/disable` | POST | `can_manage_users` | 사용중지 |
| `/admin/users/:id/enable` | POST | `can_manage_users` | 다시 사용 |
| `/admin/search-report` | GET | `can_view_audit` | 검색 리포트 |
| `/admin/audit` | GET | `can_view_audit` | 전역 감사 |
| `/admin/movements` | GET | move 또는 audit | 위치 이동 이력 |
| `/admin/data-quality` | GET | `can_manage_documents` | 데이터 품질 작업목록 |

## 상태와 보안 계약

- 권한 없는 직접 URL은 403 HTML이다.
- 미매칭 및 지원하지 않는 action/method는 404 HTML이다.
- POST는 Origin과 CSRF를 모두 통과해야 한다.
- `must_change_password=1` 세션은 `/account/password` 이외 경로에서 변경 화면으로 302된다.
- session은 매 요청 `app_users`를 다시 읽으므로 disabled/revoked 사용자는 cookie 만료 전에도 무효다.
