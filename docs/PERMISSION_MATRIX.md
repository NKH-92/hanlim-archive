# Permission Matrix

기준일 2026-07-19의 `src/permissions.js`, server guard, handler 내부 판정을 기록한다.
화면 메뉴 노출은 편의 기능이며 이 표의 server guard가 권한 원본이다.

## 역할 판정

| 역할 | 판정 |
|---|---|
| `Admin` | 7개 세부 flag 값과 관계없이 모든 permission 허용 |
| `User` | DB에서 매 요청 읽은 해당 `can_*` 값이 true/1/`"1"`일 때만 허용 |
| 미인증·disabled·rejected | 업무 route 진입 불가 |

## Permission catalog

| key | 업무 의미 |
|---|---|
| `can_manage_documents` | 문서 등록·수정, CSV, 데이터 품질 |
| `can_move_documents` | 문서 위치 이동과 이동 이력 |
| `can_manage_disposals` | 문서 폐기, 캠페인, 영구삭제 |
| `can_manage_sets` | 문서 세트 변경·잠금 |
| `can_manage_masters` | 랙·대분류·태그 관리 |
| `can_manage_users` | 사용자 상태·권한 관리 |
| `can_view_audit` | 전역 감사·검색 리포트·문서 감사 이력 |

## Route family matrix

| route/기능 | 인증 사용자 | documents | move | disposal | sets | masters | users | audit | Admin 전용 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 검색 홈·API·도면·Q&A | ✓ | | | | | | | | |
| 문서 browse·상세 | ✓ | | | | | | | | |
| 문서 생성·수정·새 개정·CSV | | ✓ | | | | | | | |
| 문서 위치 이동 | | | ✓ | | | | | | |
| 위치 이동 이력 | | | ✓ | | | | | ✓ | |
| 단건/소량 폐기·폐기 캠페인 | | | | ✓ | | | | | |
| 폐기 해제 | | | | | | | | | ✓ |
| 폐기 문서 영구삭제 | | | | ✓ | | | | | |
| 세트 목록·상세·CSV | ✓ | | | | | | | | |
| 세트 생성·수정·멤버·잠금 | | | | | ✓ | | | | |
| 랙 목록·상세·구성 | | | | | | ✓ | | | |
| 대분류·태그 | | | | | | ✓ | | | |
| 사용자 목록·상태·권한 | | | | | | | ✓ | | |
| 전역 감사·검색 리포트 | | | | | | | | ✓ | |
| 문서 상세 감사 이력 | | | | | | | | ✓ | |
| 문서 상세 이동 이력 | | | ✓ | | | | | ✓ | |
| 데이터 품질 작업목록 | | ✓ | | | | | | | |
| `/admin` dashboard | 7개 중 하나 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |

열 이름 `documents`~`audit`은 각각 위 permission key의 짧은 표기다. 한 행에 두 권한이
표시된 경우 OR 조건이며, 복수 체크가 필요한 현재 route는 없다.

## 현재 preset

| preset | 포함 권한 |
|---|---|
| 조회 사용자 | 없음 |
| 문서고 담당자 | documents, move, sets |
| 폐기 담당자 | disposal |
| 운영 관리자 | masters, audit |
| 시스템 관리자 | 7개 전체 |
| 사용자 지정 | 입력 flag 그대로 |

## 세부 정책

- `/admin`은 management permission 중 하나라도 있어야 열리며, 내부 card/data는 각 권한에 따라 다르다.
- 문서 상세 자체는 모든 인증 사용자에게 열리지만 감사 이력은 audit, 이동 이력은 move 또는 audit일 때만 조회한다.
- 문서 폐기 해제는 `can_manage_disposals`가 아니라 현재 `Admin` 역할을 직접 요구한다.
- 랙 상세 `/racks/:id`도 현재는 `can_manage_masters`가 필요하다. 일반 사용자는 `/floor-plan`과
  `/app?q=...&sort=location`을 사용한다.
- POST form은 permission 외에도 trusted Origin과 현재 session CSRF token이 필요하다.
- 권한 변경은 `User`만 대상으로 하며 Admin flag를 편집해 Admin 권한을 축소하지 않는다.
- session의 role/permission/status는 매 요청 DB에서 재검증한다.

## 검증 근거

- `tests/permissions.test.js`: Admin 하위 호환, User flag, preset
- `tests/index.test.js`: 문서·폐기 직접 URL 403, root redirect
- `tests/html.test.js`: navigation/mobile tab 권한별 노출
- `tests/auth.test.js`: 매 요청 상태·권한 재조회
- `tests/workflowIntegration.test.js`: workflow route 계약
