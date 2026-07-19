# 한림 문서고 관리 시스템

Cloudflare Workers와 D1으로 운영하는 사내 문서 검색·위치확인 시스템입니다. 실제 배포 대상은 `cloudflare-app/`입니다.

## 핵심 기능

- 등록 계정 로그인과 권한별 접근 제어
- 문서 검색·등록·수정·위치 이동·폐기·복구
- 랙 도면과 열·선반 기반 위치 확인
- 문서 세트, CSV 가져오기·내보내기, 감사로그
- 중단 후 재개할 수 있는 폐기 캠페인과 CSV 작업

## 기술 구성과 디렉터리

| 위치 | 역할 |
|---|---|
| `cloudflare-app/src/` | 순수 JavaScript ESM Worker 런타임 |
| `cloudflare-app/public/` | 빌드된 정적 CSS·JavaScript와 이미지 |
| `cloudflare-app/migrations/` | append-only D1 schema 이력 |
| `cloudflare-app/tests/` | Node.js 계약·회귀 테스트 |
| `.github/workflows/` | CI, 운영 배포, 암호화 D1 백업 |
| `docs/` | 아키텍처, 디자인, 운영 runbook |

## 로컬 실행

Node.js 24를 사용합니다.

```powershell
cd .\cloudflare-app
npm ci
Copy-Item .\.dev.vars.example .\.dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars`의 `SESSION_SECRET`에는 최소 32자의 무작위 값을 사용합니다. 기본 계정·비밀번호나 실제 secret은 저장소와 문서에 기록하지 않습니다.

## 검증

```powershell
cd .\cloudflare-app
npm run check
npm test
npm run verify
```

`main` push는 GitHub Actions의 운영 D1 migration과 Worker 배포로 이어집니다. 기능 브랜치와 PR을 사용하고, 원격 migration이나 운영 배포는 [운영 절차](./docs/OPERATIONS.md)에 따른 승인된 workflow에서만 수행합니다.

## 문서

- [아키텍처 및 개발 규칙](./docs/ARCHITECTURE.md)
- [UI 디자인 규칙](./docs/DESIGN.md)
- [배포 및 운영 절차](./docs/OPERATIONS.md)
- [백업 및 복구](./docs/BACKUP_RESTORE.md)
- [권한 운영](./docs/PERMISSIONS.md)
- [폐기 캠페인 운영](./docs/DISPOSAL_WORKFLOW.md)
- [개선 백로그](./docs/ROADMAP.md)
