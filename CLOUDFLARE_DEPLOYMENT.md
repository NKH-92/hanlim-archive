# Cloudflare 배포 가이드

이 프로젝트의 운영 배포 대상은 Cloudflare Workers + D1입니다.

## 현재 배포 정보

- Worker: `hanlim-archive`
- D1 DB: `hanlim-archive`
- D1 database_id: `1262ca00-b431-490c-aad2-539d77d4f73f`
- workers.dev URL: `https://hanlim-archive.skarhkdgus7.workers.dev`

## 사전 준비

```powershell
cd .\cloudflare-app
npm install
```

로컬 실행에는 `.dev.vars`가 필요합니다.

```powershell
Copy-Item .\.dev.vars.example .\.dev.vars
```

`.dev.vars` 또는 Cloudflare secret에는 최소 32자 이상의 `SESSION_SECRET`을 설정합니다.

```powershell
npx wrangler secret put SESSION_SECRET
```

## 로컬 확인

```powershell
npm run db:migrate:local
npm run check
npm test
npm run dev
```

## 원격 D1 migration

```powershell
npm run db:migrate:remote
```

관리자 계정은 migration에 고정 비밀번호로 넣지 않습니다. 새 DB에서 최초 관리자가 필요하면 SQL을 생성해 운영자가 검토한 뒤 실행합니다.

```powershell
node .\scripts\create-admin-sql.mjs <username> <display-name> <password> > .\admin.sql
npx wrangler d1 execute hanlim-archive --remote --file .\admin.sql
Remove-Item .\admin.sql
```

기존 운영 DB에 이미 관리자가 있다면 이 절차는 다시 실행하지 않습니다.

## 배포

```powershell
npm run deploy
```

배포 후 확인합니다.

```powershell
Invoke-WebRequest https://hanlim-archive.skarhkdgus7.workers.dev/login -UseBasicParsing
```

## 운영 메모

- 일반 사용자는 문서 조회와 검색만 가능합니다.
- 문서 등록, 수정, 이동, 폐기, 복구, 영구 삭제는 관리자 전용입니다.
- 인증된 POST 요청은 세션 CSRF 토큰을 요구합니다.
- 외부 CDN 의존성은 남아 있으므로 보안 정책이 엄격해지면 font/icon self-hosting과 CSP 적용을 추가로 검토합니다.
