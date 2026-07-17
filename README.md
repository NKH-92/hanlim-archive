# 한림 문서고 관리 시스템

Cloudflare Workers + D1 기반 문서고 관리 시스템입니다. 이 저장소의 실제 배포 대상은 `cloudflare-app`입니다.

## 구성

- Runtime: Cloudflare Workers / Database: Cloudflare D1 / Static assets: Workers Static Assets
- 진입점: `cloudflare-app/src/index.js` → 라우트 핸들러 `src/handlers/`
- 뷰 계층: `src/html.js`(배럴) → `src/views/` (페이지 템플릿·CSS·클라이언트 스크립트)
- 데이터 계층: `src/db.js`(배럴) → `src/data/` (D1 질의·변경)
- Migrations: `cloudflare-app/migrations` (append-only)

계층 규칙과 불변식은 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), 남은 개선 후보는 [docs/ROADMAP.md](./docs/ROADMAP.md)를 참고합니다.

## 주요 기능

- 등록된 사내 이메일 로그인, 최초 로그인 비밀번호 변경 강제
- 일반 사용자 문서 조회 및 검색
- 세분 권한에 따른 문서 등록·수정·이동·폐기·복구·영구 삭제
- 세분 권한에 따른 카테고리·태그·랙·보관 위치 관리
- 문서 세트 저장 및 위치 일괄 조회 (감사 준비문서 리스트)
- 문서 세트 변경 이력 (생성/수정/추가/제외/삭제 기록)
- 이메일·접속 IP별 로그인 시도 제한 (10분 내 5회 실패 시 10분 제한)
- CSV 내보내기 및 가져오기
- 도면 기반 문서고 위치 조회

## 문서고 물리 구조

- 현재 랙은 **1구역에만 총 13개**이며, 좌측부터 1번 랙입니다 (migration 0018).
  2·3구역은 증설 대비로 구조만 남겨 두었고 랙이 없는 구역은 도면에 표시하지 않습니다.
- 랙은 **단면 또는 양면**입니다. 13번 랙이 단면이면 `13`, 양면이면 면 단위로 `13-1` / `13-2`로 부릅니다.
  (내부 저장값은 A/B이며 화면 표기·CSV 입출력은 1/2를 씁니다. CSV 가져오기는 구표기 A/B도 허용합니다.)
- 랙 한 면은 **좌우 7열 × 상하 6선반 = 42칸**으로 고정입니다 (migration 0017).
  선반은 아래에서 위로 1~6을 셉니다. 열은 각 면의 통로 안쪽부터 세므로 좌측 면은 왼쪽이 1열,
  우측 면은 오른쪽이 1열입니다. 1구역 1번 단면랙은 우측 면과 같은 방향으로 오른쪽이 1열입니다.
- 1구역 도면의 위쪽은 벽면입니다. 도면에는 랙이 세로로 긴 막대로 그려지고, 서가 위치는 사용자가
  해당 면을 정면에서 바라보는 방향으로 표시됩니다.

## 로컬 실행

```powershell
cd .\cloudflare-app
npm install
Copy-Item .\.dev.vars.example .\.dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars`에는 최소 32자 이상의 `SESSION_SECRET`을 설정합니다.

## 검증

```powershell
cd .\cloudflare-app
npm run check
npm test
```

## 배포

```powershell
cd .\cloudflare-app
npm run db:migrate:remote
npm run deploy
```

`0027_initial_admin_and_forced_password_change.sql`이 최초 관리자 `nkh92@hanlim.com`을 등록합니다.
초기 비밀번호 `123456`으로 로그인하면 다른 기능보다 비밀번호 변경 화면이 우선되며, 8자 이상의 새 비밀번호로 바꾸기 전에는 시스템을 사용할 수 없습니다. 공개 가입 경로는 비활성화되어 있습니다.

자세한 절차는 [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md)를 참고합니다.
