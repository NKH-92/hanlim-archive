# 한림 문서고 관리 시스템

Cloudflare Workers + D1 기반 문서고 관리 시스템입니다. 이 저장소의 실제 배포 대상은 `cloudflare-app`입니다.

## 구성

- Runtime: Cloudflare Workers
- Database: Cloudflare D1
- Static assets: Workers Static Assets
- Main app: `cloudflare-app/src/index.js`
- UI template/style: `cloudflare-app/src/html.js`
- Migrations: `cloudflare-app/migrations`

## 주요 기능

- 로그인, 회원가입 요청, 관리자 승인
- 일반 사용자 문서 조회 및 검색
- 관리자 문서 등록, 수정, 이동, 폐기, 복구, 영구 삭제
- 관리자 카테고리, 태그, 랙, 보관 위치 관리
- 문서 세트 저장 및 위치 일괄 조회 (감사 준비문서 리스트)
- 문서 세트 변경 이력 (생성/수정/추가/제외/삭제 기록)
- 문서 반출·반납 기록, 검색 결과·세트·문서 상세에 반출 중 표시
- 로그인 시도 제한 (10분 내 5회 실패 시 10분 잠금)
- CSV 내보내기 및 가져오기
- 도면 기반 문서고 위치 조회

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

초기 관리자 계정이 필요한 새 D1 데이터베이스에서는 고정 비밀번호가 들어간 migration을 사용하지 않습니다. 대신 아래 명령으로 SQL을 생성한 뒤 운영자가 검토해서 D1에 실행합니다.

```powershell
node .\scripts\create-admin-sql.mjs <username> <display-name> <password>
```

자세한 절차는 [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md)를 참고합니다.
